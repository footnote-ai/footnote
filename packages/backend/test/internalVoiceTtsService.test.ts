/**
 * @description: Verifies backend TTS selection precedence and fail-open profile fallback.
 * @footnote-scope: test
 * @footnote-module: InternalVoiceTtsServiceTests
 * @footnote-risk: medium - TTS selection errors can break speech or misstate effective settings.
 * @footnote-ethics: medium - Tests ensure explicit settings are distinguished from operator defaults.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type {
    TextToSpeechRequest,
    TextToSpeechRuntime,
} from '@footnote/agent-runtime';
import { createInternalVoiceTtsService } from '../src/services/internalVoiceTts.js';

const profile = {
    id: 'winter',
    displayName: 'Winter',
    mentionAliases: [],
    promptOverlay: {
        source: 'none' as const,
        text: null,
        path: null,
        length: 0,
    },
    speechPresentation: {
        ttsModel: 'gpt-4o-mini-tts',
        ttsVoice: 'alloy',
        ttsDelivery: 'dry and direct',
    },
};

const createRuntime = (
    supportsModel: (model: string) => boolean,
    capture: (request: TextToSpeechRequest) => void,
    supportsVoice: (voice: string) => boolean = () => true,
    supportsDelivery: (model: string) => boolean = () => true
): TextToSpeechRuntime => ({
    kind: 'test-tts',
    provider: 'openai',
    supportsModel,
    supportsVoice,
    supportsDelivery,
    async synthesize(request) {
        capture(request);
        return {
            audioBase64: 'YQ==',
            outputFormat: request.outputFormat,
            mimeType: 'audio/mpeg',
            model: request.options.model,
            voice: request.options.voice,
            usage: {
                billingUnit: 'characters',
                inputQuantity: request.text.length,
                inputCharacters: request.text.length,
            },
            costs: {
                input: 0,
                output: 0,
                total: 0,
                completeness: 'complete',
                incompleteReasons: [],
            },
            generationTimeMs: 1,
        };
    },
});

test('TTS applies the shared profile/request precedence and returns effective metadata', async () => {
    let captured: TextToSpeechRequest | undefined;
    const service = createInternalVoiceTtsService({
        ttsRuntime: createRuntime(
            () => true,
            (request) => (captured = request)
        ),
        profile,
        recordUsage: () => undefined,
    });

    const response = await service.runTtsTask({
        task: 'synthesize',
        text: 'Short test.',
        outputFormat: 'mp3',
        options: { voice: 'echo' },
    });

    assert.equal(captured?.options.model, 'gpt-4o-mini-tts');
    assert.equal(captured?.options.voice, 'echo');
    assert.equal(captured?.options.styleNote, 'dry and direct');
    assert.deepEqual(response.result.speechSelection?.selectionSource, {
        model: 'operator_profile',
        voice: 'request_or_session',
        delivery: 'operator_profile',
    });
});

test('TTS synthesizes the submitted text and records backend usage and cost', async () => {
    let captured: TextToSpeechRequest | undefined;
    let recordedUsage: Record<string, unknown> | undefined;
    const service = createInternalVoiceTtsService({
        ttsRuntime: createRuntime(
            () => true,
            (request) => (captured = request)
        ),
        profile,
        recordUsage: (record) => {
            recordedUsage = record as unknown as Record<string, unknown>;
        },
    });

    const exactText = 'Delivered answer, with punctuation.';
    const response = await service.runTtsTask({
        task: 'synthesize',
        text: exactText,
        outputFormat: 'mp3',
    });

    assert.equal(captured?.text, exactText);
    assert.equal(response.result.speechSelection?.voice, 'alloy');
    assert.equal(response.result.usage.inputCharacters, exactText.length);
    assert.equal(response.result.costs.completeness, 'complete');
    assert.equal(recordedUsage?.feature, 'tts');
    assert.equal(recordedUsage?.totalCostUsd, 0);
    assert.equal(recordedUsage?.costCompleteness, 'complete');
});

test('unsupported profile model falls back without dropping an explicit voice', async () => {
    let captured: TextToSpeechRequest | undefined;
    const profileWithInvalidModel = {
        ...profile,
        speechPresentation: {
            ...profile.speechPresentation,
            ttsModel: 'unsupported-model',
        },
    };
    const service = createInternalVoiceTtsService({
        ttsRuntime: createRuntime(
            (model) => model === 'gpt-4o-mini-tts',
            (request) => (captured = request)
        ),
        profile: profileWithInvalidModel,
        recordUsage: () => undefined,
    });

    const response = await service.runTtsTask({
        task: 'synthesize',
        text: 'Short test.',
        outputFormat: 'mp3',
        options: { voice: 'alloy' },
    });

    assert.equal(captured?.options.model, 'gpt-4o-mini-tts');
    assert.equal(captured?.options.voice, 'alloy');
    assert.equal(
        response.result.speechSelection?.fallbackReason,
        'Configured profile model is unsupported; using deployment fallback for that setting.'
    );
    assert.equal(
        response.result.speechSelection?.selectionSource.voice,
        'request_or_session'
    );
    assert.equal(
        response.result.speechSelection?.selectionSource.model,
        'deployment_fallback'
    );
});

test('TTS metadata does not claim delivery was applied to legacy TTS models', async () => {
    const service = createInternalVoiceTtsService({
        ttsRuntime: createRuntime(
            (model) => model === 'tts-1',
            () => undefined,
            () => true,
            (model) => model !== 'tts-1'
        ),
        profile: {
            ...profile,
            speechPresentation: {
                ttsModel: 'tts-1',
                ttsVoice: 'echo',
                ttsDelivery: 'measured and clear',
            },
        },
        recordUsage: () => undefined,
    });

    const response = await service.runTtsTask({
        task: 'synthesize',
        text: 'Short test.',
        outputFormat: 'mp3',
    });

    assert.equal(response.result.speechSelection?.model, 'tts-1');
    assert.equal(response.result.speechSelection?.delivery, null);
    assert.match(
        response.result.speechSelection?.fallbackReason ?? '',
        /does not support delivery instructions/
    );
});
