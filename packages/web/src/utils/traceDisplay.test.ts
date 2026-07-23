/**
 * @description: Verifies framework-independent trace display redaction behavior.
 * @footnote-scope: test
 * @footnote-module: TraceDisplayTests
 * @footnote-risk: low - Tests cover a read-only trace transformation.
 * @footnote-ethics: medium - Redaction tests prevent artifact disclosure while preserving outcome context.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowRecord } from '@footnote/contracts/policy';
import { sanitizeWorkflowForDisplay } from './traceDisplay.js';

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
