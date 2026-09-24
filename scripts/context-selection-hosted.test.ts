/**
 * @description: Verifies the benchmark-only hosted selector boundary with synthetic responses.
 * @footnote-scope: test
 * @footnote-module: ContextSelectionHostedTests
 * @footnote-risk: low - Tests do not contact a hosted provider.
 * @footnote-ethics: low - Fixtures are synthetic and remain inside mocked requests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBenchmarkCorpus } from './context-selection-benchmark.js';
import { runOpenRouterSelection } from './context-selection-hosted.js';

test('maps hosted zero-shot labels into a bounded SelectionResult', async () => {
    const entry = buildBenchmarkCorpus()[0];
    assert.ok(entry);
    const first = entry.messages[0];
    const second = entry.messages[1];
    const third = entry.messages[2];
    assert.ok(first && second && third);
    const requestBodies: Array<Record<string, unknown>> = [];

    const result = await runOpenRouterSelection(entry, {
        apiKey: 'test-key',
        model: 'test/model',
        budget: 2,
        fetchImpl: async (_input, init) => {
            requestBodies.push(
                JSON.parse(String(init?.body)) as Record<string, unknown>
            );
            return new Response(
                JSON.stringify({
                    model: 'test/model@revision',
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    candidates: entry.messages.map(
                                        (candidate, index) => ({
                                            id: candidate.id,
                                            label:
                                                index === 0
                                                    ? 'necessary'
                                                    : index === 2
                                                      ? 'useful'
                                                      : 'irrelevant',
                                            confidence:
                                                index === 1 ? 0.99 : 0.8,
                                        })
                                    ),
                                }),
                            },
                        },
                    ],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 20,
                        total_tokens: 30,
                        cost: 0.0001,
                    },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
        },
    });

    assert.deepEqual(result.selection.messageIds, [first.id, third.id]);
    assert.equal(result.selection.status, 'completed');
    assert.equal(result.backend.returnedModel, 'test/model@revision');
    assert.equal(result.usage?.totalTokens, 30);
    assert.equal(result.costUsd, 0.0001);
    const requestBody = requestBodies[0];
    assert.ok(requestBody);
    assert.equal(requestBody.model, 'test/model');
    assert.match(
        JSON.stringify(requestBody?.messages),
        /context-selection-001/u
    );
});

test('keeps provider failures separate from unavailable selection', async () => {
    const entry = buildBenchmarkCorpus()[0];
    assert.ok(entry);
    const result = await runOpenRouterSelection(entry, {
        apiKey: 'test-key',
        model: 'test/model',
        fetchImpl: async () =>
            new Response(
                JSON.stringify({ error: { message: 'rate limited' } }),
                {
                    status: 429,
                }
            ),
    });

    assert.equal(result.selection.status, 'unavailable');
    assert.equal(result.selection.messageIds.length, 0);
    assert.equal(result.error?.category, 'http');
    assert.match(result.error?.message ?? '', /rate limited/u);
});
