/**
 * @description: Defines the paired cache experiment and its text-free economic result.
 * @footnote-scope: test
 * @footnote-module: CacheProbeComparison
 * @footnote-risk: high - Confounded requests or incomplete usage can falsely establish savings.
 * @footnote-ethics: high - Negative and inconclusive evidence must remain visible.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { GenerationUsage } from '../../packages/agent-runtime/src/index.js';
import type { BackendTextCostEstimate } from '../../packages/backend/src/services/llmCostRecorder.js';
import {
    cacheProbeLimits,
    type CacheProbeBudget,
} from './cache-probe-budget.js';

export type CacheProbeArm = 'automatic' | 'deliberate';
export type CacheProbeCell = { pair: number; arm: CacheProbeArm };
export type CacheProbeWire = {
    digest: string;
    equivalenceDigest: string;
    prefixDigest: string;
    controls: 'automatic' | 'explicit_30m';
};
export type CacheProbeSample = CacheProbeCell & {
    status: 'measured' | 'failed';
    model?: string;
    usage?: GenerationUsage;
    estimate?: BackendTextCostEstimate;
    durationMs: number;
    wireCalls: number;
    outputValid: boolean;
    rawReceiptVerified: boolean;
    wire?: CacheProbeWire;
};

export const cacheProbeSchedule = (): CacheProbeCell[] =>
    Array.from({ length: 6 }, (_, pair) =>
        (pair % 2 === 0
            ? (['automatic', 'deliberate'] as const)
            : (['deliberate', 'automatic'] as const)
        ).map((arm) => ({ pair, arm }))
    ).flat();

/** Uses identical adapter serialization; only the automatic arm removes cache controls. */
export const prepareCacheProbeWire = (
    serialized: string,
    arm: CacheProbeArm,
    marker: string
): CacheProbeWire & { body: string } => {
    const body = JSON.parse(serialized) as Record<string, unknown>;
    assert.equal(body.model, 'gpt-5.6-luna', 'Unexpected probe model.');
    assert.equal(body.store, false, 'Probe requires storage disabled.');
    assert.equal(body.max_output_tokens, 64, 'Probe requires bounded output.');
    assert.ok(
        !body.tools && !body.stream && !body.previous_response_id,
        'Unexpected probe workload.'
    );
    const input = body.input as Array<{
        content:
            | string
            | Array<{ text?: string; prompt_cache_breakpoint?: unknown }>;
    }>;
    assert.ok(
        Array.isArray(input) &&
            (typeof input[0]?.content === 'string'
                ? input[0].content
                : input[0]?.content?.[0]?.text
            )?.startsWith(marker + '\n'),
        'Missing early arm isolation.'
    );
    const breakpoints = serialized.match(/"prompt_cache_breakpoint"/g) ?? [];
    assert.equal(
        breakpoints.length,
        1,
        'Expected exactly one stable-prefix breakpoint.'
    );
    assert.deepEqual(body.prompt_cache_options, {
        mode: 'explicit',
        ttl: '30m',
    });
    assert.equal(typeof body.prompt_cache_key, 'string');
    assert.deepEqual(
        Array.isArray(input[1]?.content)
            ? input[1].content.at(-1)?.prompt_cache_breakpoint
            : undefined,
        { mode: 'explicit', ttl: '30m' },
        'Expected the breakpoint after both trusted layers.'
    );
    const withoutControls = JSON.stringify(
        body,
        (key: string, value: unknown) =>
            key.startsWith('prompt_cache_') ? undefined : value
    );
    const hash = (value: string): string =>
        createHash('sha256').update(value).digest('hex');
    return {
        body: arm === 'automatic' ? withoutControls : serialized,
        controls: arm === 'automatic' ? 'automatic' : 'explicit_30m',
        digest: hash(arm === 'automatic' ? withoutControls : serialized),
        equivalenceDigest: hash(withoutControls.replaceAll(marker, '<arm>')),
        prefixDigest: hash(JSON.stringify(input.slice(0, 2))),
    };
};

/** Paid or uncertain checkpoints are terminal: never replay an interrupted sequence. */
export const assertCacheProbeCanResume = (
    value: unknown
): { experimentId: string } => {
    assert.ok(value !== null && typeof value === 'object');
    const checkpoint = value as {
        experimentId?: unknown;
        limits?: unknown;
        budget?: CacheProbeBudget;
        samples?: unknown[];
        wireRequests?: unknown[];
    };
    assert.ok(
        typeof checkpoint.experimentId === 'string' &&
            /^[a-f0-9-]{36}$/.test(checkpoint.experimentId),
        'Invalid experiment identity.'
    );
    assert.deepEqual(
        checkpoint.limits,
        cacheProbeLimits,
        'Experiment limits changed.'
    );
    assert.deepEqual(
        checkpoint.budget,
        { calls: 0, reservedUsd: 0 },
        'Paid or interrupted experiment is immutable; do not replay it.'
    );
    assert.deepEqual(checkpoint.samples, []);
    assert.deepEqual(checkpoint.wireRequests, []);
    return { experimentId: checkpoint.experimentId };
};

/** Measures the full six-call input cost, independently of theoretical uncached savings. */
export const summarizeCacheProbe = (
    samples: CacheProbeSample[],
    wireCalls: number
) => {
    const issues: string[] = [];
    const schedule = cacheProbeSchedule();
    if (new Set(samples.map((sample) => sample.model)).size !== 1)
        issues.push('inconsistent_returned_model');
    if (
        samples.length !== 12 ||
        samples.some(
            (sample, index) =>
                sample.arm !== schedule[index]?.arm ||
                sample.pair !== schedule[index]?.pair
        )
    )
        issues.push('incomplete_or_unexpected_schedule');
    if (
        wireCalls !== samples.length ||
        samples.some((sample) => sample.wireCalls !== 1)
    )
        issues.push('retry_or_unaccounted_wire_request');
    const count = (value: number | undefined): boolean =>
        Number.isSafeInteger(value) && value! >= 0;
    if (
        samples.some((sample) => {
            const usage = sample.usage;
            return (
                sample.status !== 'measured' ||
                !sample.outputValid ||
                !sample.rawReceiptVerified ||
                !/^gpt-5\.6-luna(?:-\d{4}-?\d{2}-?\d{2})?$/.test(
                    sample.model ?? ''
                ) ||
                !usage ||
                !count(usage.promptTokens) ||
                !count(usage.completionTokens) ||
                !count(usage.cachedInputTokens) ||
                !count(usage.cacheWriteTokens) ||
                usage.cachedInputTokens! + usage.cacheWriteTokens! >
                    usage.promptTokens! ||
                sample.estimate?.costCompleteness !== 'complete' ||
                !Number.isFinite(sample.estimate.inputCostUsd) ||
                !Number.isFinite(sample.estimate.outputCostUsd)
            );
        })
    )
        issues.push('incomplete_usage_cost_attribution_or_output');
    for (let pair = 0; pair < 6; pair += 1) {
        const matched = samples.filter((sample) => sample.pair === pair);
        if (
            matched.length !== 2 ||
            !matched[0]?.wire ||
            !matched[1]?.wire ||
            matched[0].wire.equivalenceDigest !==
                matched[1].wire.equivalenceDigest ||
            matched[0].wire.prefixDigest === matched[1].wire.prefixDigest ||
            matched[0].usage?.promptTokens !== matched[1].usage?.promptTokens
        )
            issues.push('unmatched_pair');
    }
    for (const arm of ['automatic', 'deliberate'] as const) {
        const cells = samples.filter((sample) => sample.arm === arm);
        if (
            cells.some(
                (sample) =>
                    sample.wire?.prefixDigest !==
                        cells[0]?.wire?.prefixDigest ||
                    sample.wire?.controls !==
                        (arm === 'automatic' ? 'automatic' : 'explicit_30m')
            )
        )
            issues.push('unstable_prefix_or_wrong_controls');
        if ((cells[0]?.usage?.cachedInputTokens ?? 0) > 0)
            issues.push('unexpected_cold_cache_read');
    }
    if (
        (samples.find(
            (sample) => sample.arm === 'deliberate' && sample.pair === 0
        )?.usage?.cacheWriteTokens ?? 0) < 1024
    )
        issues.push('prefix_eligibility_unverified');
    if (issues.length > 0)
        return {
            outcome: 'inconclusive' as const,
            issues: [...new Set(issues)],
        };
    const totals = (arm: CacheProbeArm) =>
        samples
            .filter((sample) => sample.arm === arm)
            .reduce(
                (sum, sample) => ({
                    inputCostUsd:
                        sum.inputCostUsd + sample.estimate!.inputCostUsd,
                    outputCostUsd:
                        sum.outputCostUsd + sample.estimate!.outputCostUsd,
                    inputTokens: sum.inputTokens + sample.usage!.promptTokens!,
                    outputTokens:
                        sum.outputTokens + sample.usage!.completionTokens!,
                    cacheReadTokens:
                        sum.cacheReadTokens + sample.usage!.cachedInputTokens!,
                    cacheWriteTokens:
                        sum.cacheWriteTokens + sample.usage!.cacheWriteTokens!,
                }),
                {
                    inputCostUsd: 0,
                    outputCostUsd: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                }
            );
    const automatic = totals('automatic');
    const deliberate = totals('deliberate');
    const incrementalInputSavingsUsd =
        automatic.inputCostUsd - deliberate.inputCostUsd;
    return {
        outcome:
            incrementalInputSavingsUsd > 1e-12
                ? ('positive' as const)
                : ('no_improvement' as const),
        issues: [],
        automatic,
        deliberate,
        incrementalInputSavingsUsd,
        incrementalInputSavingsFraction:
            automatic.inputCostUsd > 0
                ? incrementalInputSavingsUsd / automatic.inputCostUsd
                : undefined,
        actualTotalCostDifferenceUsd:
            incrementalInputSavingsUsd +
            automatic.outputCostUsd -
            deliberate.outputCostUsd,
        equalOutputTotalCostDifferenceUsd: incrementalInputSavingsUsd,
    };
};
