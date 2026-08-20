/**
 * @description: Covers the OpenAI-backed embedding runtime adapter.
 * @footnote-scope: test
 * @footnote-module: OpenAiEmbeddingRuntimeTests
 * @footnote-risk: medium - Missing tests could let provider mapping or failure observability drift silently.
 * @footnote-ethics: medium - Embedding failures must stay observable so the backend can decide fail-open behavior.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createOpenAiEmbeddingRuntime,
    type EmbeddingRequest,
    type OpenAiEmbeddingRuntimeClient,
    type OpenAiEmbeddingRuntimeLogger,
} from '../src/index.js';

const createRequest = (
    overrides: Partial<EmbeddingRequest> = {}
): EmbeddingRequest => ({
    texts: ['Footnote is a transparency-first assistant.'],
    model: 'text-embedding-3-small',
    provider: 'openai',
    ...overrides,
});

const createClient = (
    response: {
        data: Array<{ embedding: number[] }>;
    },
    fail = false
): OpenAiEmbeddingRuntimeClient => ({
    createEmbeddings: async (request) => {
        if (fail) {
            throw new Error('upstream embedding failure');
        }
        assert.ok(request.input);
        assert.equal(request.model, 'text-embedding-3-small');
        return response;
    },
});

test('embeds texts through the OpenAI-compatible client and keeps provider facts observable', async () => {
    const runtime = createOpenAiEmbeddingRuntime({
        apiKey: 'test-key',
        client: createClient({
            data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
    });

    const result = await runtime.embed(createRequest());
    assert.equal(result.status, 'success');
    if (result.status !== 'success') return;
    assert.deepEqual(result.embeddings, [[0.1, 0.2, 0.3]]);
    assert.equal(result.model, 'text-embedding-3-small');
    assert.equal(result.provider, 'openai');
    assert.equal(result.texts.length, 1);
});

test('runtime exposes upstream failure as an observable error result', async () => {
    const logger: OpenAiEmbeddingRuntimeLogger = {
        warn: (message) => {
            assert.match(message, /Embedding request failed/);
        },
    };
    const runtime = createOpenAiEmbeddingRuntime({
        apiKey: 'test-key',
        client: createClient({ data: [] }, true),
        logger,
    });

    const result = await runtime.embed(createRequest());
    assert.equal(result.status, 'error');
    if (result.status === 'error') {
        assert.match(result.reason, /Embedding request failed/);
    }
});

test('runtime requires either apiKey or an injected client', () => {
    assert.throws(() => {
        createOpenAiEmbeddingRuntime({});
    }, /requires either apiKey or client/);
});

test('runtime rejects empty text lists as caller errors', async () => {
    const runtime = createOpenAiEmbeddingRuntime({
        apiKey: 'test-key',
        client: createClient({ data: [] }),
    });
    const result = await runtime.embed(createRequest({ texts: [] }));
    assert.equal(result.status, 'error');
});
