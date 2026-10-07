/**
 * @description: Verifies canonical Run projection into the external provenance contract.
 * @footnote-scope: test
 * @footnote-module: ExternalRunReviewAdapterTests
 * @footnote-risk: low - Uses bounded synthetic execution records only.
 * @footnote-ethics: high - Confirms canonical source attribution and private payload exclusion.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowRecord } from '@footnote/contracts/policy';
import { resolveProvenanceDecision } from '../src/services/responseMetadata/metadataDecisions.js';
import { reviewCanonicalRun } from '../src/services/externalRunReview.js';
import type { Run } from '../src/services/workflowCore/types.js';

const workflowRecord: WorkflowRecord = {
    runId: 'run-1',
    workflowId: 'message-reviewed',
    workflowName: 'message_reviewed',
    status: 'completed',
    terminationReason: 'goal_satisfied',
    stepCount: 1,
    maxSteps: 4,
    maxDurationMs: 1_000,
    results: [],
    steps: [],
};

const run: Run = {
    runId: 'run-1',
    workflowId: 'message-reviewed',
    startedAtMs: 100,
    finishedAtMs: 200,
    steps: [
        {
            stepId: 'generate',
            iteration: 1,
            status: 'succeeded',
            attempts: [
                {
                    attempt: 1,
                    status: 'succeeded',
                    startedAtMs: 100,
                    finishedAtMs: 200,
                },
            ],
        },
    ],
    results: {
        answer: {
            text: 'private answer text',
            provenance: 'Retrieved',
            citations: [
                {
                    title: 'Private answer citation',
                    url: 'https://example.com/answer',
                    snippet: 'private answer snippet',
                },
            ],
            retrieval: { requested: true, used: true },
        },
        evidence: {
            results: [
                {
                    outcome: 'executed',
                    executionContext: {
                        toolName: 'web_search',
                        status: 'executed',
                    },
                    evidence: { content: ['private evidence body'] },
                    sources: [
                        {
                            title: 'Private context citation',
                            url: 'https://example.com/context',
                            snippet: 'private context snippet',
                        },
                    ],
                },
            ],
            failures: [],
        },
    },
    usage: {
        stepCount: 1,
        totalTokens: 0,
        toolCalls: 0,
        deliberationCalls: 0,
        planCalls: 0,
        reviewCalls: 0,
    },
};

test('canonical Run review matches the existing provenance path without exporting Results', () => {
    const externalReview = reviewCanonicalRun({
        run,
        recordedSignals: {
            retrievalRequested: true,
            retrievalToolExecuted: true,
            trustGraphEvidenceAvailable: false,
            trustGraphEvidenceUsed: false,
        },
    });
    const currentDecision = resolveProvenanceDecision(
        {
            model: 'test-model',
            provenance: 'Retrieved',
            citations: [
                { title: 'Answer citation', url: 'https://example.com/answer' },
                {
                    title: 'Context citation',
                    url: 'https://example.com/context',
                },
            ],
        },
        {
            modelVersion: 'test-model',
            conversationSnapshot: '',
            workflow: workflowRecord,
            retrieval: {
                requested: true,
                used: true,
                contextUsed: true,
            },
            trustGraphEvidenceAvailable: false,
            trustGraphEvidenceUsed: false,
            executionContext: {
                tool: { toolName: 'web_search', status: 'executed' },
            },
        },
        2
    );

    assert.equal(externalReview.origin, 'footnote_observed');
    assert.equal(externalReview.provenance, currentDecision.provenance);
    assert.deepEqual(
        externalReview.assessment.signals,
        currentDecision.assessment.signals
    );
    assert.deepEqual(
        externalReview.assessment.conflicts,
        currentDecision.assessment.conflicts
    );
    assert.deepEqual(
        externalReview.assessment.limitations,
        currentDecision.assessment.limitations
    );
    const serialized = JSON.stringify(externalReview);
    for (const privateValue of [
        'private answer text',
        'private evidence body',
        'private answer snippet',
        'private context snippet',
    ]) {
        assert.equal(serialized.includes(privateValue), false);
    }
});

test('canonical Run review keeps unavailable provenance inputs missing', () => {
    const review = reviewCanonicalRun({
        run: {
            ...run,
            steps: [],
            results: { answer: { text: 'private answer' } },
        },
        recordedSignals: { trustGraphEvidenceUsed: true },
    });

    assert.equal(review.origin, 'footnote_observed');
    assert.ok(review.missingSignals.includes('citationCount'));
    assert.ok(review.missingSignals.includes('retrievalRequested'));
    assert.ok(review.missingSignals.includes('retrievalUsed'));
    assert.ok(review.missingSignals.includes('retrievalToolExecuted'));
    assert.ok(review.missingSignals.includes('trustGraphEvidenceAvailable'));
    assert.ok(review.missingSignals.includes('assistantDeclaredSpeculative'));
    assert.deepEqual(review.assessment.signals, {
        workflowEvidence: true,
        trustGraphEvidenceUsed: true,
    });
});

test('canonical Run review preserves explicit empty and false provenance facts', () => {
    const review = reviewCanonicalRun({
        run: {
            ...run,
            results: { answer: { citations: [] } },
        },
        recordedSignals: {
            retrievalRequested: false,
            retrievalUsed: false,
            retrievalToolExecuted: false,
        },
    });

    assert.deepEqual(review.reportedSignals, {
        citationCount: 0,
        retrievalRequested: false,
        retrievalUsed: false,
        retrievalToolExecuted: false,
        workflowEvidence: true,
    });
});

test('canonical Run review preserves generation non-use when no aggregate evidence exists', () => {
    const review = reviewCanonicalRun({
        run: {
            ...run,
            results: {
                answer: {
                    citations: [],
                    retrieval: { requested: false, used: false },
                },
            },
        },
    });

    assert.deepEqual(review.reportedSignals, {
        citationCount: 0,
        retrievalRequested: false,
        retrievalUsed: false,
        workflowEvidence: true,
    });
});

test('canonical Run review matches aggregate retrieval use when generation says false but citations exist', () => {
    const review = reviewCanonicalRun({
        run: {
            ...run,
            results: {
                answer: {
                    provenance: 'Inferred',
                    citations: [
                        {
                            title: 'Answer citation',
                            url: 'https://example.com',
                        },
                    ],
                    retrieval: { requested: false, used: false },
                },
            },
        },
        recordedSignals: {
            retrievalToolExecuted: false,
            trustGraphEvidenceAvailable: false,
            trustGraphEvidenceUsed: false,
        },
    });
    const currentDecision = resolveProvenanceDecision(
        {
            model: 'test-model',
            provenance: 'Inferred',
            citations: [
                { title: 'Answer citation', url: 'https://example.com' },
            ],
        },
        {
            modelVersion: 'test-model',
            conversationSnapshot: '',
            workflow: workflowRecord,
            retrieval: { requested: false, used: true },
            trustGraphEvidenceAvailable: false,
            trustGraphEvidenceUsed: false,
        },
        1
    );

    assert.equal(review.reportedSignals.retrievalUsed, true);
    assert.equal(review.provenance, currentDecision.provenance);
    assert.deepEqual(
        review.assessment.signals,
        currentDecision.assessment.signals
    );
    assert.deepEqual(
        review.assessment.conflicts,
        currentDecision.assessment.conflicts
    );
    assert.deepEqual(
        review.assessment.limitations,
        currentDecision.assessment.limitations
    );
});

test('canonical Run review preserves positive answer citations when total citation count is incomplete', () => {
    const answerCitation = {
        title: 'Answer citation',
        url: 'https://example.com/answer',
    };
    const review = reviewCanonicalRun({
        run: {
            ...run,
            steps: [
                ...run.steps,
                {
                    stepId: 'retrieve',
                    iteration: 1,
                    status: 'failed',
                    attempts: [
                        {
                            attempt: 1,
                            status: 'failed',
                            startedAtMs: 100,
                            finishedAtMs: 120,
                            errorCode: 'tool_execution_error',
                        },
                    ],
                },
            ],
            results: {
                answer: {
                    provenance: 'Inferred',
                    citations: [answerCitation],
                    retrieval: { requested: false, used: false },
                    toolExecution: {
                        toolName: 'web_search',
                        status: 'skipped',
                    },
                },
            },
        },
        recordedSignals: {
            trustGraphEvidenceAvailable: false,
            trustGraphEvidenceUsed: false,
        },
    });
    const currentDecision = resolveProvenanceDecision(
        {
            model: 'test-model',
            provenance: 'Inferred',
            citations: [answerCitation],
        },
        {
            modelVersion: 'test-model',
            conversationSnapshot: '',
            workflow: workflowRecord,
            retrieval: { requested: false, used: true },
            trustGraphEvidenceAvailable: false,
            trustGraphEvidenceUsed: false,
            executionContext: {
                tool: { toolName: 'web_search', status: 'skipped' },
            },
        },
        1
    );

    assert.equal(review.reportedSignals.citationCount, undefined);
    assert.ok(review.missingSignals.includes('citationCount'));
    assert.equal(review.reportedSignals.retrievalUsed, true);
    assert.equal(review.reportedSignals.retrievalRequested, false);
    assert.equal(review.provenance, currentDecision.provenance);
});

test('canonical Run review derives requested retrieval from recorded context results', () => {
    const review = reviewCanonicalRun({
        run: {
            ...run,
            steps: [
                ...run.steps,
                {
                    stepId: 'retrieve',
                    iteration: 1,
                    status: 'succeeded',
                    attempts: [
                        {
                            attempt: 1,
                            status: 'succeeded',
                            startedAtMs: 100,
                            finishedAtMs: 120,
                        },
                    ],
                },
            ],
            results: {
                answer: {
                    provenance: 'Inferred',
                    citations: [],
                    retrieval: { requested: false, used: false },
                },
                evidence: {
                    results: [{ outcome: 'skipped', sources: [] }],
                    failures: [],
                },
            },
        },
        recordedSignals: {
            retrievalRequested: false,
            retrievalToolExecuted: false,
            trustGraphEvidenceAvailable: false,
            trustGraphEvidenceUsed: false,
        },
    });
    const currentDecision = resolveProvenanceDecision(
        {
            model: 'test-model',
            provenance: 'Inferred',
            citations: [],
        },
        {
            modelVersion: 'test-model',
            conversationSnapshot: '',
            workflow: workflowRecord,
            retrieval: { requested: true, used: false },
            trustGraphEvidenceAvailable: false,
            trustGraphEvidenceUsed: false,
        },
        0
    );

    assert.equal(review.reportedSignals.retrievalRequested, true);
    assert.equal(review.provenance, currentDecision.provenance);
    assert.deepEqual(
        review.assessment.signals,
        currentDecision.assessment.signals
    );
    assert.deepEqual(
        review.assessment.conflicts,
        currentDecision.assessment.conflicts
    );
    assert.deepEqual(
        review.assessment.limitations,
        currentDecision.assessment.limitations
    );
});
