/**
 * @description: Covers memory limits and reader cleanup for the trusted image stream client.
 * @footnote-scope: test
 * @footnote-module: InternalImageApiTests
 * @footnote-risk: medium - Missing limits can let a trusted image response exhaust a bot process.
 * @footnote-ethics: medium - Bounded transport keeps image delivery available without weakening backend authority.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TextEncoder } from 'node:util';
import { ReadableStream } from 'node:stream/web';

import type { PostInternalImageGenerateRequest } from '@footnote/contracts/web';
import type { ApiRequester } from '../src/client.js';
import { createInternalImageApi } from '../src/internalImage.js';

const createImageRequest = (): PostInternalImageGenerateRequest => ({
    task: 'generate',
    prompt: 'draw a reflective skyline',
    textModel: 'gpt-5-mini',
    imageModel: 'gpt-image-1-mini',
    size: '1024x1024',
    quality: 'medium',
    background: 'auto',
    style: 'vivid',
    allowPromptAdjustment: true,
    outputFormat: 'png',
    outputCompression: 100,
    user: {
        username: 'Jordan',
        nickname: 'Jordan',
        guildName: 'Footnote Lab',
    },
});

const createFinalResultEvent = (base64: string) => ({
    type: 'result' as const,
    task: 'generate' as const,
    result: {
        responseId: 'resp_123',
        textModel: 'gpt-5-mini',
        imageModel: 'gpt-image-1-mini',
        revisedPrompt: null,
        finalStyle: 'vivid',
        annotations: {
            title: null,
            description: null,
            note: null,
            adjustedPrompt: null,
        },
        finalImageBase64: base64,
        outputFormat: 'png',
        outputCompression: 100,
        usage: {
            inputTokens: 42,
            outputTokens: 18,
            totalTokens: 60,
            imageCount: 1,
        },
        costs: {
            text: 0.000046,
            image: 0.011,
            total: 0.011046,
            perImage: 0.011,
        },
        generationTimeMs: 2100,
    },
});

const createApi = (fetchImpl: typeof fetch) =>
    createInternalImageApi(
        (async () => {
            throw new Error('requestJson should not be used for streaming');
        }) as ApiRequester,
        {
            baseUrl: 'http://backend.test',
            fetchImpl,
        }
    );

test('stream client releases the reader after it receives a terminal result', async () => {
    const encoder = new TextEncoder();
    let cancelReason: unknown;
    const fetchImpl: typeof fetch = async () =>
        new Response(
            new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(
                        encoder.encode(
                            `${JSON.stringify(createFinalResultEvent('aGVsbG8='))}\n`
                        )
                    );
                },
                cancel(reason) {
                    cancelReason = reason;
                },
            }) as unknown as ConstructorParameters<typeof Response>[0],
            { status: 200 }
        );

    const response =
        await createApi(fetchImpl).runImageTaskStreamViaApi(
            createImageRequest()
        );

    assert.equal(response.result.responseId, 'resp_123');
    assert.equal(
        cancelReason,
        'Internal image stream closed before completion'
    );
});

test('stream client rejects an oversized partial preview and cancels its reader', async () => {
    const encoder = new TextEncoder();
    let cancelReason: unknown;
    const oversizedPreview = Buffer.alloc(4 * 1024 * 1024 + 1).toString(
        'base64'
    );
    const fetchImpl: typeof fetch = async () =>
        new Response(
            new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(
                        encoder.encode(
                            `${JSON.stringify({
                                type: 'partial_image',
                                index: 0,
                                base64: oversizedPreview,
                            })}\n`
                        )
                    );
                },
                cancel(reason) {
                    cancelReason = reason;
                },
            }) as unknown as ConstructorParameters<typeof Response>[0],
            { status: 200 }
        );

    await assert.rejects(
        () =>
            createApi(fetchImpl).runImageTaskStreamViaApi(createImageRequest()),
        /partial preview exceeded the decoded byte safety limit/
    );
    assert.equal(
        cancelReason,
        'Internal image stream closed before completion'
    );
});
