/**
 * @description: Verifies framework-independent trace display redaction and presentation-flow wording.
 * @footnote-scope: test
 * @footnote-module: TraceDisplayTests
 * @footnote-risk: low - Tests cover read-only trace transformations and compatibility rendering.
 * @footnote-ethics: medium - Display tests prevent authority and provenance claims from drifting.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type {
    LegacyPresentationMetadata,
    PresentationMetadata,
    WorkflowRecord,
} from '@footnote/contracts/policy';
import {
    getPresentationTraceSummary,
    sanitizePresentationForDisplay,
    sanitizeWorkflowForDisplay,
} from './traceDisplay.js';

test('sanitizeWorkflowForDisplay redacts artifacts and preserves outcome fields', () => {
    const workflow: WorkflowRecord = {
        workflowId: 'wf_trace_display',
        workflowName: 'message_reviewed',
        status: 'degraded',
        terminationReason: 'budget_exhausted_tokens',
        stepCount: 1,
        maxSteps: 8,
        maxDurationMs: 70000,
        steps: [
            {
                stepId: 'step_1',
                attempt: 1,
                stepKind: 'generate',
                startedAt: '2026-01-01T00:00:00.000Z',
                finishedAt: '2026-01-01T00:00:01.000Z',
                durationMs: 1000,
                outcome: {
                    status: 'executed',
                    summary: 'Generated response before assessment.',
                    signals: { assessmentSkipped: true },
                    artifacts: ['private draft', 'x'],
                },
            },
        ],
    };

    const sanitized = sanitizeWorkflowForDisplay(workflow);

    assert.deepEqual(sanitized?.steps[0]?.outcome, {
        status: 'executed',
        summary: 'Generated response before assessment.',
        signals: { assessmentSkipped: true },
        artifacts: ['[redacted:13 chars]', '[redacted:1 chars]'],
    });
    assert.equal(sanitized?.terminationReason, 'budget_exhausted_tokens');
});

test('sanitizes current candidate-flow presentation metadata', () => {
    const presentation: PresentationMetadata = {
        step: 'presentation',
        flow: 'candidate_review',
        outcome: 'candidate_generated',
        attempted: true,
        reasonCode: 'candidate_generated',
        personaId: 'myuri',
        draftProfileId: 'ollama-cloud-style',
        draftRequestedProvider: 'openrouter',
        draftRequestedModel: 'thedrummer/cydonia-24b-v4.1',
        draftObservedProvider: 'parasail',
        draftObservedModel: 'style-model',
        upstreamInferenceProvider: 'parasail',
        upstreamResolvedModel: 'thedrummer/cydonia-24b-v4.1',
        upstreamRoutingAttempt: 1,
        upstreamRoutingAttemptCount: 1,
        backendEstimatedCostUsd: 0.001,
        upstreamReportedCostUsd: 0.002,
        durationMs: 12,
        draftAttemptCount: 1,
        draftHmacId: 'a'.repeat(64),
        caution: 2,
        expressionStrength: 'balanced',
        expressionSource: 'persona_default',
    };

    assert.deepEqual(
        sanitizePresentationForDisplay(presentation),
        presentation
    );
    assert.equal(sanitizePresentationForDisplay(undefined), null);
    assert.equal(
        sanitizePresentationForDisplay({ ...presentation, outcome: 42 }),
        null
    );
    assert.match(
        getPresentationTraceSummary(presentation),
        /authoritative generation and review selected the answer/u
    );
});

test('renders historical finalizer/audit receipts without relabeling them as candidate flow', () => {
    const legacy: LegacyPresentationMetadata = {
        step: 'presentation',
        flow: 'legacy_finalizer_audit',
        outcome: 'finalized',
        attempted: true,
        reasonCode: 'finalized',
        personaId: 'myuri',
        auditOutcome: 'clear',
        draftAttemptCount: 1,
        finalizerAttemptCount: 1,
        auditAttemptCount: 1,
        expressionStrength: 'balanced',
        expressionSource: 'persona_default',
    };

    assert.deepEqual(sanitizePresentationForDisplay(legacy), legacy);
    assert.match(
        getPresentationTraceSummary(legacy),
        /Presentation finalized successfully/u
    );
});

test('explains candidate timeout and mechanical admission unavailability', () => {
    const base: PresentationMetadata = {
        step: 'presentation',
        flow: 'candidate_review',
        outcome: 'candidate_unavailable',
        attempted: true,
        reasonCode: 'draft_timeout',
        personaId: 'winter',
        draftAttemptCount: 1,
        expressionStrength: 'strong',
        expressionSource: 'persona_default',
    };

    assert.match(getPresentationTraceSummary(base), /candidate timed out/u);
    assert.match(
        getPresentationTraceSummary({
            ...base,
            reasonCode: 'candidate_not_admissible',
        }),
        /not usable as prose/u
    );
    assert.match(
        getPresentationTraceSummary({
            ...base,
            attempted: false,
            reasonCode: 'budget_skipped',
        }),
        /remaining workflow budget/u
    );
});
