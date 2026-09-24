/**
 * @description: Verifies context benchmark projection and chat replay records without provider calls.
 * @footnote-scope: test
 * @footnote-module: ContextSelectionChatReplayTests
 * @footnote-risk: low - Replay utility tests do not change production request handling.
 * @footnote-ethics: medium - Tests use synthetic messages and never send them to a provider.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildBenchmarkCorpus,
    type SelectionResult,
} from './context-selection-benchmark.js';
import {
    buildContextReplayRequest,
    projectSelectedMessages,
    replayContextSelection,
    serializeReplayRecords,
} from './context-selection-chat-replay.js';

const completedSelection = (
    messageIds: string[],
    method: SelectionResult['method'] = 'bm25'
): SelectionResult => ({
    method,
    status: 'completed',
    messageIds,
    candidateCount: 40,
    retrievalDepth: 40,
    branchExpansions: 0,
    latencyMs: 1,
});

test('projects selected messages in source order with author metadata', () => {
    const entry = buildBenchmarkCorpus()[0];
    assert.ok(entry);

    const selection = completedSelection([
        entry.messages[5]?.id ?? '',
        entry.messages[2]?.id ?? '',
    ]);
    const messages = projectSelectedMessages(entry, selection);

    assert.deepEqual(
        messages.map((message) => message.messageId),
        [entry.messages[2]?.id, entry.messages[5]?.id]
    );
    assert.equal(messages[0]?.authorId, entry.messages[2]?.authorId);
    assert.equal(messages[0]?.authorName, entry.messages[2]?.authorId);
    assert.equal(messages[0]?.role, 'user');
});

test('builds a valid request while preserving trigger and selected message IDs', () => {
    const entry = buildBenchmarkCorpus()[0];
    assert.ok(entry);
    const selection = completedSelection([entry.messages[0]?.id ?? '']);

    const request = buildContextReplayRequest(entry, selection, {
        surface: 'discord',
        modeId: 'grounded',
        triggerKind: 'direct',
        triggerMessageId: 'synthetic-trigger-1',
    });

    assert.deepEqual(request.trigger, {
        kind: 'direct',
        messageId: 'synthetic-trigger-1',
    });
    assert.equal(request.latestUserInput, entry.latestUserInput);
    assert.deepEqual(
        request.conversation.map((message) => message.messageId),
        [entry.messages[0]?.id]
    );
});

test('returns a not-run record for an unavailable selector without calling chat', async () => {
    const entry = buildBenchmarkCorpus()[0];
    assert.ok(entry);
    let called = false;
    const record = await replayContextSelection({
        entry,
        selection: {
            ...completedSelection([], 'openjev'),
            status: 'unavailable',
            reason: 'OpenJEV unavailable in this environment.',
        },
        baseUrl: 'http://localhost:3000',
        agentToken: 'test-token',
        sendRequest: async () => {
            called = true;
            throw new Error('must not call chat');
        },
    });

    assert.equal(called, false);
    assert.equal(record.chat.status, 'not_run');
    assert.equal(record.chat.error, 'OpenJEV unavailable in this environment.');
    assert.equal(record.request.selectedMessageCount, 0);
});

test('returns a not-run record for a completed selector with no messages', async () => {
    const entry = buildBenchmarkCorpus()[0];
    assert.ok(entry);
    let called = false;
    const record = await replayContextSelection({
        entry,
        selection: completedSelection([]),
        baseUrl: 'http://localhost:3000',
        agentToken: 'test-token',
        sendRequest: async () => {
            called = true;
            throw new Error('must not call chat');
        },
    });

    assert.equal(called, false);
    assert.equal(record.chat.status, 'not_run');
    assert.match(record.chat.error ?? '', /no context messages were selected/u);
});

test('records response metadata and links it to the selector output', async () => {
    const entry = buildBenchmarkCorpus().find(
        (candidate) => candidate.category === 'immediate_predecessor'
    );
    assert.ok(entry);
    const selection = completedSelection([entry.messages[0]?.id ?? '']);
    const record = await replayContextSelection({
        entry,
        selection,
        baseUrl: 'http://localhost:3000',
        agentToken: 'test-token',
        sendRequest: async (options) => {
            assert.equal(options.request.conversation.length, 1);
            return {
                status: 200,
                ok: true,
                durationMs: 12,
                rawBody: JSON.stringify({
                    action: 'message',
                    message: 'The staging database URL is missing.',
                    modality: 'text',
                    metadata: {
                        responseId: 'replay-response-1',
                        provenance: 'Inferred',
                        safetyTier: 'Low',
                        tradeoffCount: 0,
                        chainHash: 'hash',
                        licenseContext: 'test',
                        modelVersion: 'test-model',
                        staleAfter: '2099-01-01T00:00:00.000Z',
                        citations: [],
                        trace_target: {},
                        trace_final: {},
                        execution: [
                            {
                                kind: 'generation',
                                status: 'executed',
                                provider: 'test-provider',
                                model: 'test-model',
                                effectiveProfileId: 'test-profile',
                                usage: {
                                    promptTokens: 10,
                                    completionTokens: 4,
                                    totalTokens: 14,
                                },
                                upstreamAttribution: {
                                    upstreamReportedCostUsd: 0.001,
                                },
                            },
                        ],
                    },
                }),
                body: {
                    action: 'message',
                    message: 'The staging database URL is missing.',
                    modality: 'text',
                    metadata: {
                        responseId: 'replay-response-1',
                        provenance: 'Inferred',
                        safetyTier: 'Low',
                        tradeoffCount: 0,
                        chainHash: 'hash',
                        licenseContext: 'test',
                        modelVersion: 'test-model',
                        staleAfter: '2099-01-01T00:00:00.000Z',
                        citations: [],
                        trace_target: {},
                        trace_final: {},
                        execution: [
                            {
                                kind: 'generation',
                                status: 'executed',
                                provider: 'test-provider',
                                model: 'test-model',
                                effectiveProfileId: 'test-profile',
                                usage: {
                                    promptTokens: 10,
                                    completionTokens: 4,
                                    totalTokens: 14,
                                },
                                upstreamAttribution: {
                                    upstreamReportedCostUsd: 0.001,
                                },
                            },
                        ],
                    },
                },
            };
        },
    });

    assert.equal(record.selector.method, 'bm25');
    assert.deepEqual(record.request.selectedMessageIds, [
        entry.messages[0]?.id,
    ]);
    assert.equal(record.chat.responseId, 'replay-response-1');
    assert.equal(record.chat.provider, 'test-provider');
    assert.equal(record.chat.model, 'test-model');
    assert.equal(record.chat.profileId, 'test-profile');
    assert.equal(record.chat.totalTokens, 14);
    assert.equal(record.chat.costUsd, 0.001);
    assert.equal(record.chat.failureCategory, null);
    assert.equal(record.downstream?.answerCorrect, true);
    assert.equal(record.downstream?.distractorOverlapDetected, false);
});

test('records transport failures without losing selector linkage', async () => {
    const entry = buildBenchmarkCorpus()[0];
    assert.ok(entry);
    const selection = completedSelection([entry.messages[0]?.id ?? '']);
    const record = await replayContextSelection({
        entry,
        selection,
        baseUrl: 'http://localhost:3000',
        agentToken: 'test-token',
        sendRequest: async () => {
            throw new Error('connection refused');
        },
    });

    assert.equal(record.chat.status, 'failed');
    assert.equal(record.chat.failureCategory, 'transport');
    assert.equal(record.chat.error, 'connection refused');
    assert.equal(record.selector.method, 'bm25');
    assert.deepEqual(record.request.selectedMessageIds, [
        entry.messages[0]?.id,
    ]);
});

test('serializes replay records as deterministic JSONL', () => {
    const entry = buildBenchmarkCorpus()[0];
    assert.ok(entry);
    const selection = completedSelection([entry.messages[0]?.id ?? '']);
    const record = {
        schemaVersion: 1 as const,
        caseId: entry.id,
        category: entry.category,
        selector: {
            method: selection.method,
            status: selection.status,
            selectedMessageIds: selection.messageIds,
            selectedCount: 1,
            candidateCount: selection.candidateCount,
            retrievalDepth: selection.retrievalDepth,
            branchExpansionCount: selection.branchExpansions,
            expansionDepth: null,
            latencyMs: selection.latencyMs,
            reason: null,
            necessaryRecall: null,
            usefulContextPrecision: null,
            distractingContextRate: null,
            historicalDistanceRecovery: null,
        },
        request: {
            surface: 'discord' as const,
            triggerKind: 'direct' as const,
            triggerMessageId: entry.triggerMessageId ?? null,
            selectedMessageIds: selection.messageIds,
            selectedMessageCount: 1,
            estimatedContextUnits: 1,
        },
        chat: {
            status: 'not_run' as const,
            httpStatus: null,
            httpOk: null,
            durationMs: null,
            responseId: null,
            responseSchemaValid: null,
            action: null,
            responseText: null,
            provider: null,
            model: null,
            profileId: null,
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
            costUsd: null,
            execution: null,
            workflow: null,
            responseBody: null,
            failureCategory: null,
            error: null,
        },
        downstream: null,
    };

    assert.equal(
        serializeReplayRecords([record]),
        `${JSON.stringify(record)}\n`
    );
    assert.equal(serializeReplayRecords([]), '');
});
