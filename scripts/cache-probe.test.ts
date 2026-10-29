/**
 * @description: Verifies the live cache probe cannot exceed its approved allowance.
 * @footnote-scope: test
 * @footnote-module: CacheProbeBudgetTests
 * @footnote-risk: high - Guard regressions can make real paid requests unbounded.
 * @footnote-ethics: high - Unknown rates must stop rather than guess spend.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    reserveCacheProbeRequest,
    dispatchCacheProbeRequest,
} from './lib/cache-probe-budget.js';
import {
    assertCacheProbeCheckpointMatches,
    readCacheProbeCommit,
    resolveCacheProbeGit,
} from './lib/cache-probe-git.js';
import path from 'node:path';
import {
    cacheProbeSchedule,
    prepareCacheProbeWire,
    summarizeCacheProbe,
    assertCacheProbeCanResume,
    type CacheProbeSample,
} from './lib/cache-probe-comparison.js';

test('comparison pairs cold, exact and four changed suffix requests, alternating the first arm', () => {
    assert.deepEqual(cacheProbeSchedule(), [
        { pair: 0, arm: 'automatic' },
        { pair: 0, arm: 'deliberate' },
        { pair: 1, arm: 'deliberate' },
        { pair: 1, arm: 'automatic' },
        { pair: 2, arm: 'automatic' },
        { pair: 2, arm: 'deliberate' },
        { pair: 3, arm: 'deliberate' },
        { pair: 3, arm: 'automatic' },
        { pair: 4, arm: 'automatic' },
        { pair: 4, arm: 'deliberate' },
        { pair: 5, arm: 'deliberate' },
        { pair: 5, arm: 'automatic' },
    ]);
});

test('automatic wire removes controls while matching the deliberate material and early isolated prefix', () => {
    const body = (marker: string) =>
        JSON.stringify({
            model: 'gpt-5.6-luna',
            store: false,
            max_output_tokens: 64,
            prompt_cache_key: 'private-key',
            prompt_cache_options: { mode: 'explicit', ttl: '30m' },
            input: [
                {
                    role: 'developer',
                    content: [
                        {
                            type: 'input_text',
                            text: marker + '\ntrusted rules',
                        },
                    ],
                },
                {
                    role: 'developer',
                    content: [
                        {
                            type: 'input_text',
                            text: 'trusted persona',
                            prompt_cache_breakpoint: {
                                mode: 'explicit',
                                ttl: '30m',
                            },
                        },
                    ],
                },
                {
                    role: 'user',
                    content: [
                        { type: 'input_text', text: 'changing question' },
                    ],
                },
            ],
        });
    const automatic = prepareCacheProbeWire(
        body('marker-a'),
        'automatic',
        'marker-a'
    );
    const deliberate = prepareCacheProbeWire(
        body('marker-b'),
        'deliberate',
        'marker-b'
    );
    assert.equal(automatic.equivalenceDigest, deliberate.equivalenceDigest);
    assert.notEqual(automatic.prefixDigest, deliberate.prefixDigest);
    assert.equal(automatic.body.includes('prompt_cache'), false);
    assert.equal(deliberate.body, body('marker-b'));
    assert.throws(
        () => prepareCacheProbeWire(body('wrong'), 'automatic', 'marker-a'),
        /isolation/
    );
    assert.throws(
        () =>
            prepareCacheProbeWire(
                body('marker-a').replace('"store":false', '"store":true'),
                'automatic',
                'marker-a'
            ),
        /storage/
    );
});

const completeSamples = (): CacheProbeSample[] =>
    cacheProbeSchedule().map((cell) => ({
        ...cell,
        status: 'measured',
        model: 'gpt-5.6-luna',
        durationMs: 100,
        wireCalls: 1,
        outputValid: true,
        rawReceiptVerified: true,
        wire: {
            digest: 'digest',
            equivalenceDigest: 'pair-' + cell.pair,
            prefixDigest: cell.arm,
            controls: cell.arm === 'automatic' ? 'automatic' : 'explicit_30m',
        },
        usage: {
            promptTokens: 2000,
            completionTokens: 2,
            cachedInputTokens: cell.pair === 0 ? 0 : 1200,
            cacheWriteTokens: cell.pair === 0 ? 1200 : 0,
        },
        estimate: {
            costCompleteness: 'complete',
            inputCostUsd: cell.arm === 'automatic' ? 0.002 : 0.001,
            outputCostUsd: cell.arm === 'automatic' ? 0 : 1,
            totalCostUsd: 1,
            cacheSavingsUsd: 123,
        },
    }));

test('comparison includes cold costs, separates output noise and ignores theoretical savings', () => {
    const positive = summarizeCacheProbe(completeSamples(), 12);
    assert.equal(positive.outcome, 'positive');
    assert.ok(
        Math.abs((positive.incrementalInputSavingsUsd ?? NaN) - 0.006) < 1e-12
    );
    assert.ok((positive.actualTotalCostDifferenceUsd ?? 0) < 0);
    const negative = completeSamples();
    for (const sample of negative)
        if (sample.arm === 'deliberate') sample.estimate!.inputCostUsd = 0.003;
    assert.equal(summarizeCacheProbe(negative, 12).outcome, 'no_improvement');
    const coldLoss = completeSamples();
    coldLoss.find(
        (sample) => sample.arm === 'deliberate' && sample.pair === 0
    )!.estimate!.inputCostUsd = 0.1;
    assert.equal(summarizeCacheProbe(coldLoss, 12).outcome, 'no_improvement');
});

test('missing usage, retries, mismatched pairs, unknown models and cold hits are inconclusive', () => {
    const changes: Array<(samples: CacheProbeSample[]) => void> = [
        (samples) => {
            delete samples[0]!.usage!.cacheWriteTokens;
        },
        (samples) => {
            samples[0]!.wireCalls = 2;
        },
        (samples) => {
            samples[1]!.wire!.equivalenceDigest = 'different';
        },
        (samples) => {
            samples[0]!.usage!.cachedInputTokens = 1;
        },
        (samples) => {
            samples[0]!.model = 'unknown';
        },
        (samples) => {
            samples[0]!.model = 'gpt-5.6-luna-2026-07-09';
        },
        (samples) => {
            samples[0]!.rawReceiptVerified = false;
        },
        (samples) => {
            samples[0]!.estimate!.costCompleteness = 'partial';
        },
        (samples) => {
            samples[0]!.outputValid = false;
        },
    ];
    for (const change of changes) {
        const samples = completeSamples();
        change(samples);
        assert.equal(summarizeCacheProbe(samples, 12).outcome, 'inconclusive');
    }
    assert.equal(
        summarizeCacheProbe(completeSamples(), 13).outcome,
        'inconclusive'
    );
});

test('only an unspent checkpoint can resume; interruption cannot reset its allowance', () => {
    const checkpoint = {
        experimentId: '44cf86b6-2860-4a66-8a63-44c26173d6e5',
        limits: {
            maxCalls: 16,
            maxEstimatedUsd: 0.15,
            maxRequestBytes: 12000,
            maxOutputTokens: 64,
        },
        budget: { calls: 0, reservedUsd: 0 },
        samples: [],
        wireRequests: [],
    };
    assert.doesNotThrow(() => assertCacheProbeCanResume(checkpoint));
    assert.throws(
        () =>
            assertCacheProbeCanResume({
                ...checkpoint,
                budget: { calls: 1, reservedUsd: 0.001 },
            }),
        /immutable/
    );
    assert.throws(() =>
        assertCacheProbeCanResume({ ...checkpoint, wireRequests: [{}] })
    );
    assert.throws(
        () =>
            assertCacheProbeCanResume({
                ...checkpoint,
                limits: { maxCalls: 60, maxEstimatedUsd: 2 },
            }),
        /limits/
    );
});

test('a reservation is durable before network dispatch and persistence failure or exhaustion prevents dispatch', async () => {
    const budget = { calls: 0, reservedUsd: 0 };
    const body = JSON.stringify({ max_output_tokens: 64, input: 'synthetic' });
    const pricing = { inputPerToken: 0.0000002, outputPerToken: 0.0000012 };
    let persisted = 0;
    let sent = 0;
    const send = async () => {
        assert.ok(persisted > 0);
        sent += 1;
        return new Response('{}');
    };
    await assert.rejects(
        dispatchCacheProbeRequest(
            budget,
            body,
            pricing,
            () => {
                throw new Error('disk unavailable');
            },
            send
        ),
        /disk unavailable/
    );
    assert.equal(sent, 0);
    assert.equal(budget.calls, 1);
    const persist = () => {
        persisted = budget.calls;
    };
    await dispatchCacheProbeRequest(budget, body, pricing, persist, send);
    assert.equal(persisted, 2);
    assert.equal(sent, 1);
    budget.calls = 16;
    await assert.rejects(
        dispatchCacheProbeRequest(budget, body, pricing, persist, send),
        /exhausted/
    );
    assert.equal(sent, 1);
});

test('cache probe counts retries, stops before the next disallowed call, and rejects unknown rates', () => {
    const pricing = { inputPerToken: 0.000001, outputPerToken: 0.000001 };
    const body = JSON.stringify({
        max_output_tokens: 32,
        input: 'synthetic fixture',
    });
    const budget = { calls: 0, reservedUsd: 0 };
    for (let index = 0; index < 16; index += 1)
        reserveCacheProbeRequest(budget, body, pricing);
    assert.equal(budget.calls, 16);
    assert.throws(
        () => reserveCacheProbeRequest(budget, body, pricing),
        /budget exhausted/
    );
    assert.equal(budget.calls, 16);
    const nearLimit = { calls: 1, reservedUsd: 0.14999 };
    assert.throws(
        () => reserveCacheProbeRequest(nearLimit, body, pricing),
        /budget exhausted/
    );
    assert.equal(nearLimit.calls, 1);
    assert.throws(
        () =>
            reserveCacheProbeRequest({ calls: 0, reservedUsd: 0 }, body, {
                ...pricing,
                inputPerToken: NaN,
            }),
        /known pricing/
    );
    assert.throws(
        () =>
            reserveCacheProbeRequest(
                { calls: 0, reservedUsd: 0 },
                '{}',
                pricing
            ),
        /bounded output/
    );
});

test('cache probe Git preflight checks only supported absolute paths', () => {
    const checked: string[] = [];
    assert.equal(
        resolveCacheProbeGit('win32', (candidate) => {
            checked.push(candidate);
            return candidate.includes('(x86)');
        }),
        String.raw`C:\Program Files (x86)\Git\cmd\git.exe`
    );
    assert.deepEqual(checked, [
        String.raw`C:\Program Files\Git\cmd\git.exe`,
        String.raw`C:\Program Files (x86)\Git\cmd\git.exe`,
    ]);
    assert.throws(
        () => resolveCacheProbeGit('win32', () => false),
        /requires Git in a supported install path/
    );
});

test('cache probe reports a failed revision lookup before starting the probe', () => {
    assert.throws(
        () =>
            readCacheProbeCommit(
                process.execPath,
                path.join('missing', 'repo')
            ),
        /could not read the current Git revision/
    );
});

test('cache probe refuses to resume checkpoints from another source revision', () => {
    const checkpoint = { commit: 'commit-a', reportSourceDigest: 'digest-a' };
    assert.doesNotThrow(() =>
        assertCacheProbeCheckpointMatches(checkpoint, 'commit-a', 'digest-a')
    );
    assert.throws(
        () =>
            assertCacheProbeCheckpointMatches(
                checkpoint,
                'commit-b',
                'digest-a'
            ),
        /different source revision/
    );
    assert.throws(
        () =>
            assertCacheProbeCheckpointMatches(
                checkpoint,
                'commit-a',
                'digest-b'
            ),
        /different source revision/
    );
});
