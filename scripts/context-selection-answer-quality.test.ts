/**
 * @description: Verifies the bounded downstream context-support evaluation.
 * @footnote-scope: test
 * @footnote-module: ContextSelectionAnswerQualityTests
 * @footnote-risk: low - Evaluation regression tests do not affect runtime behavior.
 * @footnote-ethics: medium - The evaluation must remain synthetic and must not retain private transcript content.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildAnswerQualitySubset,
    runAnswerQualityEvaluation,
} from './context-selection-answer-quality.js';

test('uses one representative synthetic case from every corpus category', () => {
    const subset = buildAnswerQualitySubset();

    assert.equal(subset.length, 14);
    assert.equal(new Set(subset.map((entry) => entry.category)).size, 14);
});

test('reports bounded context-support outcomes without inventing generation results', () => {
    const report = runAnswerQualityEvaluation();

    assert.equal(report.benchmark.subsetCaseCount, 14);
    assert.deepEqual(
        report.methods.map((metric) => metric.method),
        ['current_window', 'bm25', 'bm25_graph_expansion']
    );
    assert.ok(
        report.cases.every((metric) => metric.generationStatus === 'not_run')
    );
    assert.ok(
        report.methods.every((metric) => metric.generationP95LatencyMs === null)
    );
});
