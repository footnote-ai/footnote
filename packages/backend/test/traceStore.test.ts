/**
 * @description: Validates SQLite trace storage round trips metadata correctly.
 * @footnote-scope: test
 * @footnote-module: TraceStoreTests
 * @footnote-risk: low - Tests cover trace persistence without affecting production.
 * @footnote-ethics: low - Uses synthetic metadata only.
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import type { ResponseMetadata } from '@footnote/contracts/policy';
import type { ResponseCandidate } from '@footnote/contracts/web';
import { ResponseMetadataSchema } from '@footnote/contracts/web';
import { SqliteTraceStore } from '../src/storage/traces/sqliteTraceStore.js';

test('TraceStore round trips metadata with citation URLs', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-store-'));
    const dbPath = path.join(tempRoot, 'provenance.db');
    const store = new SqliteTraceStore({ dbPath });

    const metadata: ResponseMetadata = {
        responseId: 'response_123',
        provenance: 'Retrieved',
        safetyTier: 'Low',
        tradeoffCount: 2,
        chainHash: 'abc123',
        licenseContext: 'MIT',
        modelVersion: 'gpt-4.1-mini',
        staleAfter: new Date().toISOString(),
        citations: [
            {
                title: 'Example Source',
                url: 'https://example.com/article',
                snippet: 'Example snippet',
            },
            {
                title: 'String URL source',
                url: 'https://example.com/string',
            },
        ],
        trace_target: {},
        trace_final: {},
    };

    try {
        await store.upsert(metadata);

        const retrieved = await store.retrieve(metadata.responseId);
        assert.ok(retrieved, 'retrieve should return stored metadata');
        assert.equal(retrieved.responseId, metadata.responseId);
        assert.equal(retrieved.chainHash, metadata.chainHash);
        assert.equal(
            retrieved.citations[0].url,
            metadata.citations[0].url,
            'citation URL should round-trip as a string'
        );
        assert.equal(
            retrieved.citations[1].url,
            'https://example.com/string',
            'string citation should normalize to canonical URL string'
        );

        await store.delete(metadata.responseId);
        const deleted = await store.retrieve(metadata.responseId);
        assert.equal(deleted, null, 'deleted trace should not be retrievable');
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('TraceStore preserves cached usage in execution, workflow, and display traces', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-cache-'));
    const responseId = 'cached_usage_trace_123';
    const store = new SqliteTraceStore({
        dbPath: path.join(tempRoot, 'provenance.db'),
    });
    const now = new Date().toISOString();
    const metadata: ResponseMetadata = {
        responseId,
        provenance: 'Inferred',
        safetyTier: 'Low',
        tradeoffCount: 0,
        chainHash: 'cached_usage_hash',
        licenseContext: 'MIT',
        modelVersion: 'gpt-5-mini',
        staleAfter: new Date(Date.now() + 60000).toISOString(),
        citations: [],
        execution: [
            {
                kind: 'generation',
                status: 'executed',
                model: 'gpt-5-mini',
                usage: {
                    promptTokens: 100,
                    cachedInputTokens: 80,
                    cacheWriteTokens: 10,
                    completionTokens: 20,
                    reasoningTokens: 5,
                    totalTokens: 120,
                },
            },
        ],
        workflow: {
            workflowId: 'workflow_cached_usage_123',
            workflowName: 'message_reviewed',
            status: 'completed',
            terminationReason: 'goal_satisfied',
            stepCount: 1,
            maxSteps: 4,
            maxDurationMs: 15000,
            steps: [
                {
                    stepId: 'step_1',
                    attempt: 1,
                    stepKind: 'generate',
                    startedAt: now,
                    finishedAt: now,
                    durationMs: 1,
                    model: 'gpt-5-mini',
                    usage: {
                        promptTokens: 100,
                        cachedInputTokens: 80,
                        cacheWriteTokens: 10,
                        completionTokens: 20,
                        reasoningTokens: 5,
                        totalTokens: 120,
                    },
                    outcome: {
                        status: 'executed',
                        summary: 'Generated a response.',
                    },
                },
            ],
        },
        trace_target: {},
        trace_final: {},
    };

    try {
        await store.upsert(metadata);

        const retrieved = await store.retrieve(responseId);
        assert.ok(retrieved);
        const retrievedGeneration = retrieved.execution?.[0];
        if (retrievedGeneration?.kind !== 'generation') {
            assert.fail('expected a generation execution event');
        }
        assert.deepEqual(retrievedGeneration.usage, {
            promptTokens: 100,
            cachedInputTokens: 80,
            cacheWriteTokens: 10,
            completionTokens: 20,
            reasoningTokens: 5,
            totalTokens: 120,
        });
        assert.ok(metadata.workflow);
        assert.deepEqual(
            retrieved.workflow?.steps[0]?.usage,
            metadata.workflow.steps[0]?.usage
        );

        const display = await store.retrieveForDisplay(responseId);
        assert.ok(display);
        assert.equal(display.displayIntegrity.status, 'complete');
        const displayedGeneration = display.execution?.[0];
        if (displayedGeneration?.kind !== 'generation') {
            assert.fail('expected a displayed generation execution event');
        }
        assert.deepEqual(displayedGeneration.usage, {
            promptTokens: 100,
            cachedInputTokens: 80,
            cacheWriteTokens: 10,
            completionTokens: 20,
            reasoningTokens: 5,
            totalTokens: 120,
        });
        assert.deepEqual(
            display.workflow?.steps[0]?.usage,
            metadata.workflow.steps[0]?.usage
        );
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('TraceStore keeps source-backed TrustGraph metadata as a real trace', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-store-'));
    const responseId = 'trustgraph_trace_123';
    const store = new SqliteTraceStore({
        dbPath: path.join(tempRoot, 'provenance.db'),
    });
    const metadata: ResponseMetadata = {
        responseId,
        provenance: 'Retrieved',
        safetyTier: 'Low',
        tradeoffCount: 0,
        chainHash: 'trustgraph_chain_hash',
        licenseContext: 'MIT',
        modelVersion: 'gpt-5.3-flash',
        staleAfter: new Date(Date.now() + 60_000).toISOString(),
        citations: [
            {
                title: 'Product documentation source',
                url: 'https://example.com/product-docs',
                snippet: 'Source-backed product note',
            },
        ],
        trace_target: {},
        trace_final: {},
        trustGraph: {
            adapterStatus: 'success',
            scopeValidation: {
                ok: true,
                normalizedScope: { userId: '[redacted]' },
            },
            terminalAuthority: 'backend_execution_contract',
            failOpenBehavior: 'local_behavior',
            verificationRequired: true,
            advisoryEvidenceItemCount: 1,
            droppedEvidenceCount: 0,
            droppedEvidenceIds: [],
            provenanceReasonCodes: [],
            sufficiencyView: {
                coverageValue: 1,
                coverageEvaluationUnit: 'source',
                conflictSignals: [],
            },
            evidenceView: {
                sourceRefs: ['https://example.com/product-docs'],
                provenancePathRefs: ['target:product-docs'],
                traceRefs: ['trustgraph://trace/product-docs'],
            },
            provenanceJoin: {
                externalEvidenceBundleId: 'bundle_product_docs_123',
                externalTraceRefs: ['trustgraph://trace/product-docs'],
                adapterVersion: 'trustgraph-graph-rag-v1',
                consumedGovernedFieldPaths: ['items[].sourceRef'],
                consumedByConsumers: ['P_EVID'],
                droppedEvidenceIds: [],
                reasonCodes: [],
            },
        },
    };

    try {
        assert.equal(ResponseMetadataSchema.safeParse(metadata).success, true);
        await store.upsert(metadata);
        const retrieved = await store.retrieve(responseId);

        assert.ok(retrieved);
        assert.equal(retrieved.modelVersion, 'gpt-5.3-flash');
        assert.equal(retrieved.trustGraph?.adapterStatus, 'success');
        assert.deepEqual(retrieved.trustGraph?.evidenceView.sourceRefs, [
            'https://example.com/product-docs',
        ]);
        assert.equal(retrieved.citations[0]?.url, metadata.citations[0]?.url);
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('TraceStore round trips a presentation receipt', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-store-'));
    const dbPath = path.join(tempRoot, 'provenance.db');
    const store = new SqliteTraceStore({ dbPath });
    const responseId = 'presentation_trace_123';

    const metadata: ResponseMetadata = {
        responseId,
        provenance: 'Inferred',
        safetyTier: 'Low',
        tradeoffCount: 1,
        chainHash: 'presentation_chain_hash',
        licenseContext: 'MIT + HL3',
        modelVersion: 'gpt-5-mini',
        staleAfter: new Date(Date.now() + 60000).toISOString(),
        citations: [],
        trace_target: {},
        trace_final: {},
        presentation: {
            step: 'presentation',
            flow: 'candidate_review',
            outcome: 'candidate_generated',
            attempted: true,
            reasonCode: 'candidate_generated',
            personaId: 'myuri',
            draftRequestedProvider: 'openai',
            draftRequestedModel: 'gpt-5-mini',
            draftObservedProvider: 'openai',
            draftObservedModel: 'gpt-5-mini',
            draftAttemptCount: 1,
            expressionStrength: 'balanced',
            expressionSource: 'persona_default',
        },
    };

    try {
        await store.upsert(metadata);

        const retrieved = await store.retrieve(responseId);
        assert.ok(retrieved, 'presentation flow trace should be retrievable');
        assert.equal(retrieved.presentation?.flow, 'candidate_review');
        assert.equal(retrieved.presentation?.outcome, 'candidate_generated');
        assert.equal(retrieved.presentation?.draftObservedProvider, 'openai');
        assert.equal(retrieved.presentation?.draftObservedModel, 'gpt-5-mini');
        assert.equal(retrieved.presentation?.expressionStrength, 'balanced');
        assert.equal(
            retrieved.presentation?.expressionSource,
            'persona_default'
        );
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('TraceStore retrieves legacy presentation receipts after compatibility repair', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-store-'));
    const dbPath = path.join(tempRoot, 'provenance.db');
    const initializedStore = new SqliteTraceStore({ dbPath });
    initializedStore.close();

    const responseId = 'legacy_presentation_trace_123';
    const legacyMetadata = {
        responseId,
        provenance: 'Inferred',
        safetyTier: 'Low',
        tradeoffCount: 1,
        chainHash: 'legacy_presentation_chain_hash',
        licenseContext: 'MIT + HL3',
        modelVersion: 'gpt-5-mini',
        staleAfter: new Date(Date.now() + 60000).toISOString(),
        citations: [],
        trace_target: {},
        trace_final: {},
        presentation: {
            step: 'presentation',
            outcome: 'finalized',
            attempted: true,
            reasonCode: 'finalized',
            personaId: 'winter',
            auditOutcome: 'clear',
            draftAttemptCount: 1,
            finalizerAttemptCount: 1,
            auditAttemptCount: 1,
            intensity: 'restrained',
            traceConstrained: true,
            draftModel: 'requested-but-not-observed',
        },
    };
    const legacyDatabase = new Database(dbPath);
    const now = new Date().toISOString();
    legacyDatabase
        .prepare(
            `INSERT INTO provenance_traces
                (response_id, metadata_json, stale_after, created_at, updated_at)
             VALUES (@response_id, @metadata_json, @stale_after, @created_at, @updated_at)`
        )
        .run({
            response_id: responseId,
            metadata_json: JSON.stringify(legacyMetadata),
            stale_after: legacyMetadata.staleAfter,
            created_at: now,
            updated_at: now,
        });
    legacyDatabase.close();

    const store = new SqliteTraceStore({ dbPath });
    try {
        const retrieved = await store.retrieve(responseId);
        assert.ok(retrieved, 'legacy presentation trace should be retrievable');
        assert.equal(retrieved.presentation?.flow, 'legacy_finalizer_audit');
        assert.equal(retrieved.presentation?.expressionStrength, 'subtle');
        assert.equal(
            retrieved.presentation?.expressionSource,
            'persona_default'
        );
        assert.equal(
            retrieved.presentation?.draftObservedModel,
            undefined,
            'legacy draftModel must not be treated as observed'
        );
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('TraceStore persists ordered candidate links with the trace and cascades deletion', async () => {
    const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'trace-candidates-')
    );
    const store = new SqliteTraceStore({
        dbPath: path.join(tempRoot, 'provenance.db'),
    });
    const responseId = 'response_candidates_123';
    const candidates: ResponseCandidate[] = [
        {
            id: 'candidate_draft',
            workflowStepId: 'step_1',
            sequence: 0,
            stage: 'presentation_draft',
            state: 'superseded',
            text: 'Draft response.',
        },
        {
            id: 'candidate_final',
            parentCandidateId: 'candidate_draft',
            workflowStepId: 'step_1',
            sequence: 1,
            stage: 'presentation_finalization',
            state: 'selected',
            text: 'Final response.',
        },
    ];

    try {
        await store.upsert(
            {
                responseId,
                provenance: 'Inferred',
                safetyTier: 'Low',
                tradeoffCount: 1,
                chainHash: 'candidate_chain_hash',
                licenseContext: 'MIT + HL3',
                modelVersion: 'gpt-5-mini',
                staleAfter: new Date(Date.now() + 60000).toISOString(),
                citations: [],
                trace_target: {},
                trace_final: {},
            },
            candidates
        );

        assert.deepEqual(
            await store.retrieveResponseCandidates(responseId),
            candidates
        );
        await store.delete(responseId);
        assert.deepEqual(
            await store.retrieveResponseCandidates(responseId),
            []
        );
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('TraceStore returns no candidate history for older traces', async () => {
    const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'trace-no-candidates-')
    );
    const store = new SqliteTraceStore({
        dbPath: path.join(tempRoot, 'provenance.db'),
    });
    const responseId = 'old_trace_123';
    try {
        await store.upsert({
            responseId,
            provenance: 'Inferred',
            safetyTier: 'Low',
            tradeoffCount: 1,
            chainHash: 'old_chain_hash',
            licenseContext: 'MIT + HL3',
            modelVersion: 'gpt-5-mini',
            staleAfter: new Date(Date.now() + 60000).toISOString(),
            citations: [],
            trace_target: {},
            trace_final: {},
        });
        assert.deepEqual(
            await store.retrieveResponseCandidates(responseId),
            []
        );
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('TraceStore round trips trace-card SVG assets', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-card-'));
    const dbPath = path.join(tempRoot, 'provenance.db');
    const store = new SqliteTraceStore({ dbPath });
    const responseId = 'response_trace_card_123';
    const initialSvg = '<svg><title>initial</title></svg>';
    const updatedSvg = '<svg><title>updated</title></svg>';

    try {
        const beforeInsert = await store.getTraceCardSvg(responseId);
        assert.equal(
            beforeInsert,
            null,
            'missing trace-card should return null'
        );

        // A trace-card row references provenance_traces(response_id), so seed the
        // parent trace first before inserting the card asset.
        await store.upsert({
            responseId,
            provenance: 'Retrieved',
            safetyTier: 'Low',
            tradeoffCount: 1,
            chainHash: 'trace_card_chain_hash',
            licenseContext: 'MIT + HL3',
            modelVersion: 'gpt-5-mini',
            staleAfter: new Date(Date.now() + 60000).toISOString(),
            citations: [],
            trace_target: {},
            trace_final: {},
        });

        await store.upsertTraceCardSvg(responseId, initialSvg);
        const storedInitial = await store.getTraceCardSvg(responseId);
        assert.equal(storedInitial, initialSvg);

        await store.upsertTraceCardSvg(responseId, updatedSvg);
        const storedUpdated = await store.getTraceCardSvg(responseId);
        assert.equal(
            storedUpdated,
            updatedSvg,
            'upsert should replace existing SVG'
        );
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('TraceStore delete removes both trace metadata and trace-card SVG', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-delete-'));
    const dbPath = path.join(tempRoot, 'provenance.db');
    const store = new SqliteTraceStore({ dbPath });
    const responseId = 'delete_trace_card_123';

    try {
        await store.upsert({
            responseId,
            provenance: 'Retrieved',
            safetyTier: 'Low',
            tradeoffCount: 1,
            chainHash: 'chain_hash',
            licenseContext: 'MIT + HL3',
            modelVersion: 'gpt-5-mini',
            staleAfter: new Date(Date.now() + 60000).toISOString(),
            citations: [],
            trace_target: {},
            trace_final: {},
        });
        await store.upsertTraceCardSvg(responseId, '<svg>trace-card</svg>');

        await store.delete(responseId);

        const trace = await store.retrieve(responseId);
        const traceCardSvg = await store.getTraceCardSvg(responseId);
        assert.equal(trace, null, 'trace metadata should be deleted');
        assert.equal(traceCardSvg, null, 'trace-card SVG should be deleted');
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('TraceStore retrieve repairs missing assess TRACE alignment fail-open', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-repair-'));
    const dbPath = path.join(tempRoot, 'provenance.db');
    const store = new SqliteTraceStore({ dbPath });
    const responseId = 'trace_repair_alignment_123';

    const metadata: ResponseMetadata = {
        responseId,
        provenance: 'Inferred',
        safetyTier: 'Low',
        tradeoffCount: 1,
        chainHash: 'repair_hash',
        licenseContext: 'MIT + HL3',
        modelVersion: 'gpt-5-mini',
        staleAfter: new Date(Date.now() + 60000).toISOString(),
        citations: [],
        trace_target: {},
        trace_final: {},
        workflow: {
            workflowId: 'wf_repair_123',
            workflowName: 'message_reviewed',
            status: 'completed',
            terminationReason: 'goal_satisfied',
            stepCount: 1,
            maxSteps: 4,
            maxDurationMs: 15000,
            steps: [
                {
                    stepId: 'step_1',
                    attempt: 1,
                    stepKind: 'assess',
                    startedAt: new Date().toISOString(),
                    finishedAt: new Date().toISOString(),
                    durationMs: 1,
                    outcome: {
                        status: 'executed',
                        summary: 'Assess completed.',
                        signals: {
                            reviewDecision: 'finalize',
                            reviewReason: 'Ready.',
                        },
                    },
                },
            ],
        },
    };

    try {
        await store.upsert(metadata);
        const repaired = await store.retrieve(responseId);
        assert.ok(repaired, 'trace should be retrievable with compatibility');
        const assessStep = repaired.workflow?.steps.find(
            (step) => step.stepKind === 'assess'
        );
        assert.ok(assessStep);
        assert.equal(assessStep.outcome.signals?.traceAlignment, 'aligned');
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});
