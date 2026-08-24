/**
 * @description: Verifies framework-independent trace display redaction behavior.
 * @footnote-scope: test
 * @footnote-module: TraceDisplayTests
 * @footnote-risk: low - Tests cover a read-only trace transformation.
 * @footnote-ethics: medium - Redaction tests prevent artifact disclosure while preserving outcome context.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type {
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
                    signals: {
                        assessmentSkipped: true,
                    },
                    artifacts: ['private draft', 'x'],
                },
            },
        ],
    };

    const sanitized = sanitizeWorkflowForDisplay(workflow);

    assert.deepEqual(sanitized?.steps[0]?.outcome, {
        status: 'executed',
        summary: 'Generated response before assessment.',
        signals: {
            assessmentSkipped: true,
        },
        artifacts: ['[redacted:13 chars]', '[redacted:1 chars]'],
    });
    assert.equal(sanitized?.terminationReason, 'budget_exhausted_tokens');
});

test('sanitizePresentationForDisplay preserves text-free rewrite provenance', () => {
    const presentation: PresentationMetadata = {
        step: 'presentation',
        outcome: 'finalized',
        attempted: true,
        reasonCode: 'finalized',
        personaId: 'myuri',
        draftProfileId: 'ollama-cloud-style',
        draftRequestedProvider: 'openrouter',
        draftRequestedModel: 'thedrummer/cydonia-24b-v4.1',
        draftObservedProvider: 'parasail',
        draftObservedModel: 'style-model',
        auditProfileId: 'ollama-cloud-validator',
        auditProvider: 'ollama',
        auditModel: 'validator-model',
        upstreamInferenceProvider: 'parasail',
        upstreamResolvedModel: 'thedrummer/cydonia-24b-v4.1',
        upstreamRoutingAttempt: 1,
        upstreamRoutingAttemptCount: 1,
        backendEstimatedCostUsd: 0.001,
        upstreamReportedCostUsd: 0.002,
        durationMs: 12,
        auditOutcome: 'clear',
        draftAttemptCount: 1,
        finalizerAttemptCount: 1,
        auditAttemptCount: 1,
        draftHmacId: 'a'.repeat(64),
        finalHmacId: 'b'.repeat(64),
        styledDraftRetentionRatio: 0.12,
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
        sanitizePresentationForDisplay({
            ...presentation,
            outcome: 42,
        }),
        null
    );
});

test('getPresentationTraceSummary explains missing drafts and mechanical fallback', () => {
    const base: PresentationMetadata = {
        step: 'presentation',
        outcome: 'fallback',
        attempted: true,
        reasonCode: 'draft_timeout',
        personaId: 'winter',
        auditOutcome: 'not_attempted',
        draftAttemptCount: 1,
        finalizerAttemptCount: 0,
        auditAttemptCount: 0,
        expressionStrength: 'strong',
        expressionSource: 'persona_default',
    };

    assert.match(getPresentationTraceSummary(base), /No draft was returned/u);
    assert.match(
        getPresentationTraceSummary({
            ...base,
            reasonCode: 'mechanical_preservation_failed',
            draftObservedModel: 'style-model',
        }),
        /preservation checks rejected/u
    );
});
