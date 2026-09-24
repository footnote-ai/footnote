/**
 * @description: Tests offline hybrid selection rules without provider calls.
 * @footnote-scope: test
 * @footnote-module: ContextSelectionHybridTests
 * @footnote-risk: low - Tests protect candidate composition and label isolation.
 * @footnote-ethics: low - Tests use synthetic messages and frozen score-shaped data.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBenchmarkCorpus } from './context-selection-benchmark.js';
import {
    buildHybridSelection,
    expandStructuralClosure,
} from './context-selection-hybrid.js';
import type { HostedSelectionRecord } from './context-selection-hosted.js';

const semanticRecord = (
    caseId: string,
    messageIds: string[]
): HostedSelectionRecord => ({
    schemaVersion: 1,
    caseId,
    category: 'reply_ancestry',
    selection: {
        method: 'hosted_zero_shot',
        status: 'completed',
        messageIds,
        candidateCount: 40,
        retrievalDepth: 40,
        branchExpansions: 0,
        latencyMs: 10,
    },
    backend: {
        provider: 'openrouter',
        requestedModel: 'test',
        returnedModel: 'test',
        taskFormulation: 'pairwise_batch_zero_shot',
        scoreKind: 'model_reported_confidence',
        budget: 15,
        confidenceFloor: 0.5,
    },
    candidates: messageIds.map((messageId, rank) => ({
        messageId,
        label: 'necessary',
        confidence: 1,
        selected: true,
        rank: rank + 1,
    })),
    usage: null,
    latencyMs: 10,
    costUsd: null,
    responseContent: null,
    error: null,
});

test('semantic prune intersects frozen scores with BM25 graph candidates', () => {
    const entry = buildBenchmarkCorpus().find(
        (candidate) => candidate.id === 'context-selection-005'
    );
    assert.ok(entry);
    const selection = buildHybridSelection(
        entry,
        semanticRecord(entry.id, ['case-5-message-5', 'case-5-message-0']),
        'bm25_graph_semantic_prune'
    );
    assert.equal(selection.method, 'bm25_graph_semantic_prune');
    assert.deepEqual(selection.messageIds, ['case-5-message-5']);
});

test('structural closure is bounded, deduplicated, and label-independent', () => {
    const entry = buildBenchmarkCorpus().find(
        (candidate) => candidate.id === 'context-selection-005'
    );
    assert.ok(entry);
    const selected = expandStructuralClosure(entry, ['case-5-message-39'], 3);
    assert.equal(new Set(selected).size, selected.length);
    assert.ok(selected.length <= 3);

    const relabeled = {
        ...entry,
        necessaryMessageIds: ['not-used'],
        usefulMessageIds: ['not-used'],
        distractingMessageIds: ['not-used'],
    };
    assert.deepEqual(
        expandStructuralClosure(relabeled, ['case-5-message-39'], 3),
        selected
    );
});

test('empty semantic selection stays empty for prune and closure', () => {
    const entry = buildBenchmarkCorpus()[0]!;
    const semantic = semanticRecord(entry.id, []);
    assert.deepEqual(
        buildHybridSelection(entry, semantic, 'bm25_graph_semantic_prune')
            .messageIds,
        []
    );
    assert.deepEqual(
        buildHybridSelection(entry, semantic, 'semantic_structural_closure')
            .messageIds,
        []
    );
});
