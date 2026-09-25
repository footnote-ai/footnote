/**
 * @description: Verifies the direct Jev transport, failure taxonomy, and replay path.
 * @footnote-scope: test
 * @footnote-module: DirectJevAdapterTests
 * @footnote-risk: low - Tests only observe transport and response parsing behavior.
 * @footnote-ethics: high - Mock state contains no private transcript content or credentials.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createReplayFetch,
    JevRequestError,
    systemOne,
    type SystemOneResponse,
} from './direct-jev-adapter.js';

test('posts a typed noul request and parses probabilities and usage', async () => {
    let requestUrl = '';
    let requestBody = '';
    const response: SystemOneResponse = {
        model: 'jev-1.13.0',
        answers: { support: { type: 'noul', noul: 0.82 } },
        usage: { input_tokens: 12, output_tokens: 1 },
    };
    const result = await systemOne(
        {
            state: { claim: 'claim', evidence: 'evidence' },
            questions: {
                support: {
                    type: 'noul',
                    instructions: 'Does evidence support the claim?',
                },
            },
        },
        {
            apiKey: 'mock-key',
            baseUrl: 'https://mock.typesafe.test/',
            fetch: async (input, init) => {
                requestUrl = input;
                requestBody = String(init?.body);
                return new Response(JSON.stringify(response), { status: 200 });
            },
        }
    );

    assert.equal(requestUrl, 'https://mock.typesafe.test/v1/systemone');
    assert.match(requestBody, /"model":"jev-latest"/);
    assert.equal(result.answers.support?.noul, 0.82);
    assert.equal(result.usage.input_tokens, 12);
});

test('missing credentials fail before transport and replay remains usable', async () => {
    await assert.rejects(
        () =>
            systemOne({
                state: 'fixture',
                questions: { support: { type: 'noul' } },
            }),
        (error: unknown) =>
            error instanceof JevRequestError && error.kind === 'missing_api_key'
    );
    const replay = await systemOne(
        { state: 'fixture', questions: { support: { type: 'noul' } } },
        {
            apiKey: 'replay-only',
            fetch: createReplayFetch({
                model: 'replay:fixture',
                answers: { support: { type: 'noul', noul: 0.5 } },
                usage: { input_tokens: 0, output_tokens: 0 },
            }),
        }
    );
    assert.equal(replay.model, 'replay:fixture');
});

test('non-success HTTP responses retain status without exposing credentials', async () => {
    await assert.rejects(
        () =>
            systemOne(
                { state: 'fixture', questions: { support: { type: 'noul' } } },
                {
                    apiKey: 'secret-that-must-not-appear',
                    fetch: async () => new Response('unauthorized', { status: 401 }),
                }
            ),
        (error: unknown) =>
            error instanceof JevRequestError &&
            error.kind === 'http' &&
            error.status === 401 &&
            !error.message.includes('secret-that-must-not-appear')
    );
});