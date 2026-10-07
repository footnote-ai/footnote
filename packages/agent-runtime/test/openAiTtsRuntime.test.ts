/**
 * @description: Verifies the OpenAI TTS request boundary and billable-unit metadata.
 * @footnote-scope: test
 * @footnote-module: OpenAiTtsRuntimeTests
 * @footnote-risk: medium - Request drift or billing-unit mistakes can affect speech and reported spend.
 * @footnote-ethics: medium - Speech settings and accounting must remain inspectable without retaining content.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAiTtsRuntime } from '../src/openAiTtsRuntime.js';

test('TTS sends configured speech options and reports character billing units', async () => {
    let capturedRequest: Record<string, unknown> | undefined;
    const runtime = createOpenAiTtsRuntime({
        client: {
            createSpeech: async (request) => {
                capturedRequest = request;
                return {
                    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
                };
            },
        },
    });

    const result = await runtime.synthesize({
        text: 'Hello there.',
        options: {
            model: 'tts-1',
            voice: 'alloy',
            styleNote: 'Measured and clear.',
        },
        outputFormat: 'wav',
    });

    assert.deepEqual(capturedRequest, {
        model: 'tts-1',
        voice: 'alloy',
        input: 'Hello there.',
        response_format: 'wav',
    });
    assert.deepEqual(result.usage, {
        billingUnit: 'characters',
        inputQuantity: 12,
        inputCharacters: 12,
    });
    assert.equal(result.model, 'tts-1');
    assert.equal(result.voice, 'alloy');
    assert.equal(result.outputFormat, 'wav');
    assert.equal(result.costs.completeness, 'complete');
    assert.equal(result.costs.input, 0.00018);
    assert.equal(runtime.supportsDelivery('tts-1'), false);
});

test('mini TTS marks its token billing quantity as estimated', async () => {
    let capturedRequest: Record<string, unknown> | undefined;
    const runtime = createOpenAiTtsRuntime({
        client: {
            createSpeech: async (request) => {
                capturedRequest = request;
                return {
                    arrayBuffer: async () => new Uint8Array([1]).buffer,
                };
            },
        },
    });

    const result = await runtime.synthesize({
        text: 'Hello.',
        options: { model: 'gpt-4o-mini-tts', voice: 'echo' },
        outputFormat: 'mp3',
    });

    assert.equal(result.usage.billingUnit, 'estimated_tokens');
    assert.equal(result.usage.inputQuantity, result.usage.inputTokens);
    assert.equal(result.usage.inputCharacters, 6);
    assert.equal(result.costs.completeness, 'partial');
    assert.deepEqual(result.costs.incompleteReasons, [
        'estimated_tts_token_quantity',
        'provider_usage_unavailable',
    ]);
    assert.equal(typeof capturedRequest?.instructions, 'string');
    assert.equal(runtime.supportsDelivery('gpt-4o-mini-tts'), true);
});

test('legacy TTS keeps Unicode character cost estimates explicitly partial', async () => {
    const runtime = createOpenAiTtsRuntime({
        client: {
            createSpeech: async () => ({
                arrayBuffer: async () => new Uint8Array([1]).buffer,
            }),
        },
    });

    const result = await runtime.synthesize({
        text: 'Hi 👋',
        options: { model: 'tts-1', voice: 'echo' },
        outputFormat: 'mp3',
    });

    assert.equal(result.usage.inputCharacters, 4);
    assert.equal(result.costs.completeness, 'partial');
    assert.deepEqual(result.costs.incompleteReasons, [
        'estimated_tts_character_quantity',
    ]);
});
