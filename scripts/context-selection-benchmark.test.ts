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
