/**
 * @description: Verifies the replayable context-selection benchmark's corpus and
 * deterministic baselines without invoking external models.
 * @footnote-scope: test
 * @footnote-module: ContextSelectionBenchmarkTests
 * @footnote-risk: low - Benchmark regression tests only affect evaluation tooling.
 * @footnote-ethics: medium - Fixtures must remain synthetic and avoid private transcript retention.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildBenchmarkCorpus,
    runBenchmark,
    selectContext,
    type ContextSelectionMethod,
} from './context-selection-benchmark.js';

test('builds the documented 100-case synthetic corpus', () => {
    const corpus = buildBenchmarkCorpus();

    assert.equal(corpus.length, 100);
    assert.ok(corpus.every((entry) => entry.messages.length >= 24));
    assert.ok(
        corpus.every((entry) =>
            entry.necessaryMessageIds.every((messageId) =>
                entry.messages.some((message) => message.id === messageId)
            )
        )
    );
});

test('current-window baseline retains the final 24 non-system candidates', () => {
    const [entry] = buildBenchmarkCorpus();
    assert.ok(entry);

    const result = selectContext('current_window', entry);

    assert.equal(result.status, 'completed');
    assert.equal(result.messageIds.length, 24);
    assert.deepEqual(
        result.messageIds,
        entry.messages.slice(-24).map((message) => message.id)
    );
});

test('deterministic reply expansion adds the reply ancestry without remote judgment', () => {
    const entry = buildBenchmarkCorpus().find(
        (candidate) => candidate.category === 'reply_ancestry'
    );
    assert.ok(entry);

    const result = selectContext('recency_reply_expansion', entry);

    assert.equal(result.status, 'completed');
    assert.ok(
        entry.necessaryMessageIds.some((messageId) =>
            result.messageIds.includes(messageId)
        )
    );
    assert.ok(result.branchExpansions > 0);
});

test('BM25 reply expansion combines lexical seeds with deterministic ancestry', () => {
    const entry = buildBenchmarkCorpus().find(
        (candidate) => candidate.category === 'reply_ancestry'
    );
    assert.ok(entry);

    const result = selectContext('bm25_reply_expansion', entry);

    assert.equal(result.status, 'completed');
    assert.ok(result.messageIds.length >= 24);
    assert.ok(result.branchExpansions > 0);
    assert.ok(
        entry.necessaryMessageIds.every((messageId) =>
            result.messageIds.includes(messageId)
        )
    );
});

test('same-author continuation recovers the preceding message in a continuation chain', () => {
    const entry = buildBenchmarkCorpus().find(
        (candidate) => candidate.category === 'same_author_continuation'
    );
    assert.ok(entry);

    const result = selectContext('recency_author_continuation', entry);

    assert.equal(result.status, 'completed');
    assert.ok(result.branchExpansions > 0);
    assert.ok(result.messageIds.includes(entry.necessaryMessageIds[0] ?? ''));
});

test('lexical graph expansion remains bounded and includes reply ancestry', () => {
    const entry = buildBenchmarkCorpus().find(
        (candidate) => candidate.category === 'reply_ancestry'
    );
    assert.ok(entry);

    const result = selectContext('bm25_graph_expansion', entry);

    assert.equal(result.status, 'completed');
    assert.ok(result.messageIds.length <= 24);
    assert.ok(result.branchExpansions > 0);
    assert.ok(result.messageIds.includes(entry.necessaryMessageIds[0] ?? ''));
});

test('report includes per-category metrics for every completed baseline', () => {
    const report = runBenchmark();

    assert.equal(
        report.categoryMetrics.length,
        Object.keys(report.benchmark.categoryCounts).length * 9
    );
    assert.ok(
        report.categoryMetrics.some(
            (metric) =>
                metric.category === 'same_author_continuation' &&
                metric.method === 'recency_author_continuation'
        )
    );
});

test('unavailable model methods fail open without selecting context', () => {
    const [entry] = buildBenchmarkCorpus();
    assert.ok(entry);

    const unavailableMethods: ContextSelectionMethod[] = [
        'existing_cross_encoder',
        'openjev',
    ];
    for (const method of unavailableMethods) {
        const result = selectContext(method, entry);
        assert.equal(result.status, 'unavailable');
        assert.deepEqual(result.messageIds, []);
        assert.equal(result.branchExpansions, 0);
    }
});
