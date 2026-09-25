/**
 * @description: Checks Jev request parsing, fail-open behavior, and the bounded
 * synthetic benchmark path without contacting a hosted provider.
 * @footnote-scope: test
 * @footnote-module: JevContextBenchmarkTests
 * @footnote-risk: low - Test-only coverage for benchmark evaluation tooling.
 * @footnote-ethics: medium - Tests preserve the synthetic-fixture-only boundary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildBenchmarkCorpus,
    type ContextBenchmarkCase,
} from './context-selection-benchmark.js';
import {
    callJev,
    runJevBenchmark,
    type JevClientOptions,
} from './jev-context-benchmark.js';

const fakeClient = (): JevClientOptions => ({
    apiKey: 'test-key',
    provider: 'openrouter',
    model: 'typesafe/jev-1.13',
    timeoutMs: 1000,
    fetchImplementation: async (_input, init) => {
        const payload = JSON.parse(String(init?.body)) as {
            questions: Record<string, { type: string }>;
        };
        const answers = Object.fromEntries(
            Object.entries(payload.questions).map(([name, question]) =>
                question.type === 'noul'
                    ? [
                          name,
                          {
                              type: 'noul',
                              noul: name === 'supported' ? 0.9 : 0.6,
                          },
                      ]
                    : [
                          name,
                          {
                              type: 'score',
                              score: 2,
                              confidence: 0.8,
                              probabilities: { '0': 0.05, '1': 0.15, '2': 0.8 },
                          },
                      ]
            )
        );
        return new Response(
            JSON.stringify({
                model: 'typesafe/jev-1.13-20260917',
                answers,
                usage: { input_tokens: 100, output_tokens: 10, cost: 0.0001 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
        );
    },
});

test('parses a typed Jev response without exposing request credentials', async () => {
    let sentAuthorization = '';
    const client = fakeClient();
    client.fetchImplementation = async (_input, init) => {
        sentAuthorization = String(
            new Headers(init?.headers).get('authorization')
        );
        return new Response(
            JSON.stringify({
                model: 'typesafe/jev-1.13-20260917',
                answers: { supported: { type: 'noul', noul: 0.75 } },
                usage: { input_tokens: 12, output_tokens: 2 },
            }),
            { status: 200 }
        );
    };

    const result = await callJev(
        'claim',
        {
            supported: {
                type: 'noul',
                instructions: 'Is it supported?',
                criteria: { true: 'yes', false: 'no' },
            },
        },
        client
    );

    assert.equal(result.response.answers.supported?.type, 'noul');
    assert.equal(result.response.usage.input_tokens, 12);
    assert.equal(sentAuthorization, 'Bearer test-key');
});

test('runs the bounded synthetic benchmark through an injected transport', async () => {
    const corpus: ContextBenchmarkCase[] = buildBenchmarkCorpus().slice(0, 2);
    const report = await runJevBenchmark({
        corpus,
        client: fakeClient(),
        concurrency: 1,
    });

    assert.equal(report.benchmark.status, 'completed');
    assert.equal(report.contextCases.length, 6);
    assert.equal(report.thresholds.length, 3);
    assert.equal(report.claimEvidence.fixtureCount, 6);
    assert.equal(report.claimEvidence.records.length, 6);
});

test('does not call a provider when credentials are unavailable', async () => {
    const report = await runJevBenchmark({
        corpus: buildBenchmarkCorpus().slice(0, 1),
        client: null,
    });

    assert.equal(report.benchmark.status, 'blocked');
    assert.equal(report.contextCases.length, 0);
    assert.equal(report.claimEvidence.records.length, 0);
});
