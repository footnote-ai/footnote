/**
 * @description: Verifies the OpenRouter Decisions API request, response, errors, and replay path.
 * @footnote-scope: test
 * @footnote-module: DirectJevAdapterTests
 * @footnote-risk: low - Tests only observe transport and response parsing behavior.
 * @footnote-ethics: high - Mock state contains no private transcript content or credentials.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createReplayFetch,
    decisions,
    JevRequestError,
    JEV_MODEL,
    OPENROUTER_DECISIONS_URL,
    type DecisionsResponse,
} from './direct-jev-adapter.js';

test('posts typed noul questions to OpenRouter and preserves probabilities and usage', async () => {
    let requestUrl = '';
    let requestBody = '';
    const response: DecisionsResponse = {
        id: 'gen-dec-test',
        model: 'typesafe/jev-1.13-20260917',
        provider: 'TypeSafe',
        answers: { support: { type: 'noul', noul: 0.82 } },
        usage: { input_tokens: 12, output_tokens: 1, cost: 0.000000504 },
    };
    const result = await decisions(
        {
            state: { claim: 'claim', evidence: 'evidence' },
            questions: { support: { type: 'noul', instructions: 'Does evidence support the claim?' } },
        },
        {
            apiKey: 'mock-key',
            fetch: async (input, init) => {
                requestUrl = input;
                requestBody = String(init?.body);
                assert.equal(init?.method, 'POST');
                assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer mock-key');
                return new Response(JSON.stringify(response), { status: 200 });
            },
        }
    );

    assert.equal(requestUrl, OPENROUTER_DECISIONS_URL);
    assert.match(requestBody, /"model":"typesafe\/jev-1\.13"/);
    assert.equal(result.answers.support?.noul, 0.82);
    assert.equal(result.provider, 'TypeSafe');
    assert.equal(result.usage.cost, 0.000000504);
});

test('missing credentials fail before transport and replay remains usable', async () => {
    await assert.rejects(
        () => decisions({ state: 'fixture', questions: { support: { type: 'noul' } } }),
        (error: unknown) => error instanceof JevRequestError && error.kind === 'missing_api_key'
    );
    const replay = await decisions(
        { state: 'fixture', questions: { support: { type: 'noul' } } },
        {
            apiKey: 'replay-only',
            model: JEV_MODEL,
            fetch: createReplayFetch({
                model: 'replay:fixture',
                answers: { support: { type: 'noul', noul: 0.5 } },
                usage: { input_tokens: 0, output_tokens: 0, cost: 0 },
            }),
        }
    );
    assert.equal(replay.model, 'replay:fixture');
});

test('HTTP errors retain status without exposing credentials; cancellation is classified', async () => {
    await assert.rejects(
        () => decisions(
            { state: 'fixture', questions: { support: { type: 'noul' } } },
            {
                apiKey: 'secret-that-must-not-appear',
                fetch: async () => new Response('unauthorized', { status: 401 }),
            }
        ),
        (error: unknown) => error instanceof JevRequestError &&
            error.kind === 'http' && error.status === 401 &&
            !error.message.includes('secret-that-must-not-appear')
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
        () => decisions(
            { state: 'fixture', questions: { support: { type: 'noul' } } },
            { apiKey: 'mock-key', signal: controller.signal, fetch: async (_url, init) => {
                assert.equal(init?.signal?.aborted, true);
                throw new DOMException('Aborted', 'AbortError');
            } }
        ),
        (error: unknown) => error instanceof JevRequestError && error.kind === 'aborted'
    );
});

test('missing named answers fail instead of scoring as zero', async () => {
    await assert.rejects(
        () => decisions(
            { state: 'fixture', questions: { support: { type: 'noul' } } },
            {
                apiKey: 'mock-key',
                fetch: async () => new Response(JSON.stringify({
                    model: 'typesafe/jev-1.13-20260917',
                    answers: {},
                    usage: { input_tokens: 1, output_tokens: 0 },
                }), { status: 200 }),
            }
        ),
        (error: unknown) => error instanceof JevRequestError &&
            error.kind === 'invalid_response'
    );
});
