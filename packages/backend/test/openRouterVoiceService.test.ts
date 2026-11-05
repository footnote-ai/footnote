/**
 * @description: Verifies the OpenRouter audio request boundary without paid provider calls.
 * @footnote-scope: test
 * @footnote-module: OpenRouterVoiceServiceTests
 * @footnote-risk: medium - Incorrect audio encoding or response checks break Standard voice calls.
 * @footnote-ethics: high - These checks keep audio and transcript content out of logs and canonical storage.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenRouterVoiceService } from '../src/services/openRouterVoice.js';

test('transcription sends mono 24 kHz PCM as WAV and returns only bounded text and reported usage', async () => {
    let request:
        { url: string; authorization: string | null; body: string } | undefined;
    const service = createOpenRouterVoiceService({
        apiKey: 'test-key',
        baseUrl: 'https://openrouter.test/api/v1////',
        fetchFn: async (url, init) => {
            request = {
                url: String(url),
                authorization: new Headers(init?.headers).get('authorization'),
                body: String(init?.body),
            };
            return new Response(
                JSON.stringify({
                    text: '  hello there  ',
                    usage: {
                        seconds: 0.4,
                        input_tokens: 12,
                        output_tokens: 2,
                        total_tokens: 14,
                        cost: 0.0001,
                    },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
        },
    });

    const result = await service.transcribe(Buffer.from([1, 0, 2, 0]));

    assert.equal(
        request?.url,
        'https://openrouter.test/api/v1/audio/transcriptions'
    );
    assert.equal(request?.authorization, 'Bearer test-key');
    const body = JSON.parse(String(request?.body)) as {
        model: string;
        input_audio: { data: string; format: string };
    };
    assert.equal(body.model, 'openai/whisper-1');
    assert.equal(body.input_audio.format, 'wav');
    const wav = Buffer.from(body.input_audio.data, 'base64');
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 24_000);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.toString('hex', 44), '01000200');
    assert.deepEqual(result, {
        text: 'hello there',
        usage: {
            seconds: 0.4,
            inputTokens: 12,
            outputTokens: 2,
            totalTokens: 14,
            costUsd: 0.0001,
        },
    });
});

test('OpenRouter MAI PCM preserves bounded signed 16-bit little-endian audio', async () => {
    let request:
        { url: string; authorization: string | null; body: string } | undefined;
    const service = createOpenRouterVoiceService({
        apiKey: 'test-key',
        baseUrl: 'https://openrouter.test/api/v1',
        fetchFn: async (url, init) => {
            request = {
                url: String(url),
                authorization: new Headers(init?.headers).get('authorization'),
                body: String(init?.body),
            };
            return new Response(Buffer.from([0x00, 0x80, 0xff, 0x7f]), {
                status: 200,
                headers: {
                    'Content-Type': 'audio/pcm',
                    'X-Generation-Id': 'gen-test',
                },
            });
        },
    });

    const result = await service.synthesize('approved answer', {
        model: 'microsoft/mai-voice-2.1-flash',
        voice: 'en-US-Harper:MAI-Voice-2.1-Flash',
    });

    assert.equal(request?.url, 'https://openrouter.test/api/v1/audio/speech');
    assert.deepEqual(JSON.parse(String(request?.body)), {
        model: 'microsoft/mai-voice-2.1-flash',
        input: 'approved answer',
        voice: 'en-US-Harper:MAI-Voice-2.1-Flash',
        response_format: 'pcm',
    });
    assert.deepEqual(result.audio, Buffer.from([0x00, 0x80, 0xff, 0x7f]));
    assert.equal(result.audio.readInt16LE(0), -32768);
    assert.equal(result.audio.readInt16LE(2), 32767);
    assert.equal(result.generationId, 'gen-test');

    const invalid = createOpenRouterVoiceService({
        apiKey: 'test-key',
        baseUrl: 'https://openrouter.test/api/v1',
        fetchFn: async () =>
            new Response('{"error":"private response text"}', {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
    });
    await assert.rejects(
        invalid.synthesize('approved answer', {
            model: 'microsoft/mai-voice-2.1-flash',
            voice: 'en-US-Harper:MAI-Voice-2.1-Flash',
        }),
        (error: unknown) =>
            error instanceof Error &&
            error.message.includes('audio/pcm') &&
            !error.message.includes('private response text')
    );
});

test('PCM speech rejects incomplete signed 16-bit samples', async () => {
    const service = createOpenRouterVoiceService({
        apiKey: 'test-key',
        baseUrl: 'https://openrouter.test/api/v1',
        fetchFn: async () =>
            new Response(Buffer.from([0, 0, 1]), {
                status: 200,
                headers: { 'Content-Type': 'audio/pcm' },
            }),
    });

    await assert.rejects(
        service.synthesize('approved answer', {
            model: 'microsoft/mai-voice-2.1-flash',
            voice: 'en-US-Harper:MAI-Voice-2.1-Flash',
            responseFormat: 'pcm',
        }),
        /out of bounds/
    );
});

test('speech can request PCM with ZDR routing', async () => {
    let body: Record<string, unknown> | undefined;
    const service = createOpenRouterVoiceService({
        apiKey: 'test-key',
        baseUrl: 'https://openrouter.test/api/v1',
        fetchFn: async (_url, init) => {
            body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return new Response(Buffer.from([1, 0, 2, 0]), {
                status: 200,
                headers: {
                    'Content-Type': 'audio/pcm',
                    'X-Generation-Id': 'gen-pcm-test',
                },
            });
        },
    });

    const result = await service.synthesize(
        'approved synthetic answer',
        {
            model: 'microsoft/mai-voice-2.1-flash',
            voice: 'en-US-Harper:MAI-Voice-2.1-Flash',
            responseFormat: 'pcm',
            zdr: true,
        },
        AbortSignal.timeout(1_000)
    );

    assert.equal(body?.response_format, 'pcm');
    assert.deepEqual(body?.provider, { zdr: true });
    assert.equal(result.generationId, 'gen-pcm-test');
    assert.deepEqual(result.audio, Buffer.from([1, 0, 2, 0]));
});

test('speech synthesis forwards caller cancellation to the provider request', async () => {
    let requestSignal: AbortSignal | null | undefined;
    const service = createOpenRouterVoiceService({
        apiKey: 'test-key',
        baseUrl: 'https://openrouter.test/api/v1',
        fetchFn: async (_url, init) => {
            requestSignal = init?.signal;
            return await new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener(
                    'abort',
                    () => reject(new Error('request cancelled')),
                    { once: true }
                );
            });
        },
    });
    const controller = new AbortController();
    const pending = service.synthesize(
        'approved synthetic answer',
        { model: 'google/gemini-3.8-flash-lite-tts', voice: 'Kore' },
        controller.signal
    );
    controller.abort();

    await assert.rejects(pending, /request cancelled/);
    assert.equal(requestSignal, controller.signal);
});

test('speech synthesis cancels non-success response bodies before stopping', async () => {
    let cancelled = false;
    const body = new globalThis.ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
        },
        cancel() {
            cancelled = true;
        },
    });
    const service = createOpenRouterVoiceService({
        apiKey: 'test-key',
        baseUrl: 'https://openrouter.test/api/v1',
        fetchFn: async () =>
            new Response(body, {
                status: 429,
                headers: { 'Content-Type': 'text/plain' },
            }),
    });

    await assert.rejects(
        service.synthesize('approved synthetic answer', {
            model: 'google/gemini-3.8-flash-lite-tts',
            voice: 'Kore',
        }),
        /HTTP 429/
    );
    assert.equal(cancelled, true);
});

test('speech response cancels its stream as soon as the byte limit is exceeded', async () => {
    let cancelled = false;
    let chunkIndex = 0;
    const body = new globalThis.ReadableStream<Uint8Array>({
        pull(controller) {
            controller.enqueue(
                new Uint8Array(chunkIndex++ === 0 ? 10 * 1024 * 1024 : 1)
            );
        },
        cancel() {
            cancelled = true;
        },
    });
    const service = createOpenRouterVoiceService({
        apiKey: 'test-key',
        baseUrl: 'https://openrouter.test/api/v1',
        fetchFn: async () =>
            new Response(body, {
                status: 200,
                headers: { 'Content-Type': 'audio/pcm' },
            }),
    });

    await assert.rejects(
        service.synthesize('approved answer', {
            model: 'x-ai/grok-voice-tts-1.0',
            voice: 'eve',
        }),
        /out of bounds/
    );
    assert.equal(cancelled, true);
});

test('transcription rejects empty, malformed, and overlong transcripts', async () => {
    for (const body of [
        'not json',
        JSON.stringify({ text: '  ' }),
        JSON.stringify({ text: 'x'.repeat(8193) }),
    ]) {
        const service = createOpenRouterVoiceService({
            apiKey: 'test-key',
            baseUrl: 'https://openrouter.test/api/v1',
            fetchFn: async () =>
                new Response(body, {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
        });
        await assert.rejects(service.transcribe(Buffer.from([1, 0])));
    }
});
