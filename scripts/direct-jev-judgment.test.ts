/**
 * @description: Checks the pure metrics used by the direct Jev benchmark.
 * @footnote-scope: test
 * @footnote-module: DirectJevJudgmentBenchmarkTest
 * @footnote-risk: low - Test coverage is limited to deterministic report accounting.
 * @footnote-ethics: medium - Accurate metrics prevent overstating model evidence.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    scoreContextCase,
    type JudgmentMetric,
} from './direct-jev-judgment.js';
import { buildBenchmarkCorpus } from './context-selection-benchmark.js';

test('benchmark accounting treats fixed-threshold predictions and failures separately', () => {
    const metrics: JudgmentMetric[] = [
        {
            caseId: 'supported',
            score: 0.9,
            predicted: true,
            expected: true,
            latencyMs: 10,
        },
        {
            caseId: 'unsupported',
            score: 0.1,
            predicted: false,
            expected: false,
            latencyMs: 20,
        },
        {
            caseId: 'failed',
            score: null,
            predicted: null,
            expected: true,
            latencyMs: null,
            error: 'blocked',
        },
    ];
    assert.equal(
        metrics.filter((metric) => metric.predicted !== null).length,
        2
    );
    assert.equal(
        metrics.filter(
            (metric) =>
                metric.predicted !== null &&
                metric.predicted === metric.expected
        ).length,
        2
    );
    assert.equal(metrics.filter((metric) => metric.score === null).length, 1);
});

test('context accounting selects all messages above the fixed threshold', () => {
    const benchmarkCase = buildBenchmarkCorpus()[0];
    const firstMessage = benchmarkCase.messages[0];
    assert.ok(firstMessage);
    const metric = scoreContextCase(
        benchmarkCase,
        { [firstMessage.id]: 0.9 },
        12
    );
    assert.equal(metric.selectedCount, 1);
    assert.equal(metric.averageScore, 0.9);
    assert.equal(metric.latencyMs, 12);
});
