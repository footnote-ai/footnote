/**
 * @description: Verifies shared TTS and Realtime speech-selection precedence and metadata.
 * @footnote-scope: test
 * @footnote-module: SpeechPresentationTests
 * @footnote-risk: medium - Precedence drift can select the wrong speech implementation.
 * @footnote-ethics: medium - Selection metadata must distinguish explicit and operator choices.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSpeechSelection } from '../src/services/speechPresentation.js';

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
        ttsVoice: 'echo',
        ttsDelivery: 'dry and understated',
    },
};

test('explicit TTS selection wins and records per-setting sources', () => {
    assert.deepEqual(
        resolveSpeechSelection({
            profile,
            provider: 'openai',
            modality: 'tts',
            request: { voice: 'alloy' },
            fallback: { model: 'fallback-model', voice: 'fallback-voice' },
        }),
        {
            profileId: 'winter',
            modality: 'tts',
            provider: 'openai',
            model: 'gpt-4o-mini-tts',
            voice: 'alloy',
            delivery: 'dry and understated',
            requestedVoice: 'alloy',
            selectionSource: {
                model: 'operator_profile',
                voice: 'request_or_session',
                delivery: 'operator_profile',
            },
            fallbackReason: null,
        }
    );
});

test('deployment fallback is retained when no profile override exists', () => {
    const selection = resolveSpeechSelection({
        profile: { ...profile, speechPresentation: {} },
        provider: 'openai',
        modality: 'realtime',
        fallback: { model: 'gpt-realtime-mini', voice: 'echo' },
    });

    assert.equal(selection.model, 'gpt-realtime-mini');
    assert.equal(selection.selectionSource.model, 'deployment_fallback');
    assert.equal(selection.delivery, null);
});
