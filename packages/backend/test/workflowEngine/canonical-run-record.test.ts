/**
 * @description: Verifies the bounded canonical Run projection and evaluator seam.
 * @footnote-scope: test
 * @footnote-module: CanonicalRunRecordTests
 * @footnote-risk: medium - Projection drift can hide execution lineage or sensitive payloads.
 * @footnote-ethics: high - Canonical records must expose governance facts without retaining private content.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowRecord } from '@footnote/contracts/policy';
import { addEvaluatorStepToWorkflowLineage } from '../../src/services/workflowCore/reviewedChatWorkflow.js';

const workflow = (): WorkflowRecord => ({
    runId: 'run-1',
    workflowId: 'workflow-1',
    workflowName: 'test-workflow',
    status: 'completed',
    terminationReason: 'goal_satisfied',
    stepCount: 0,
    maxSteps: 4,
    maxDurationMs: 1_000,
    results: [],
    steps: [],
});

test('projects evaluator findings as evidence in the canonical workflow record', () => {
    const projected = addEvaluatorStepToWorkflowLineage({
        workflow: workflow(),
        evaluator: {
            status: 'executed',
            startedAtMs: 100,
            finishedAtMs: 125,
            durationMs: 25,
            outcome: {
                authorityLevel: 'observe',
                mode: 'observe_only',
                provenance: 'Inferred',
                safetyDecision: {
                    action: 'allow',
                    safetyTier: 'Low',
                    ruleId: null,
                },
            },
        },
    });

    const evaluatorStep = projected.steps[0];
    assert.equal(evaluatorStep?.stepKind, 'evaluator');
    assert.equal(evaluatorStep?.attempts?.[0]?.status, 'succeeded');
    assert.equal(evaluatorStep?.durationMs, 25);
    assert.deepEqual(evaluatorStep?.resultRefs, [
        { resultId: 'run-1:evaluator_finding', name: 'evaluator_finding' },
    ]);
    assert.deepEqual(projected.results, [
        {
            resultId: 'run-1:evaluator_finding',
            name: 'evaluator_finding',
            status: 'produced',
            producedByStepId: 'step_evaluator',
            producedByAttempt: 1,
        },
    ]);
    assert.equal(JSON.stringify(projected).includes('raw'), false);
});

test('keeps evaluator failure fail-open and marks its result unavailable', () => {
    const projected = addEvaluatorStepToWorkflowLineage({
        workflow: workflow(),
        evaluator: {
            status: 'failed',
            reasonCode: 'evaluator_runtime_error',
            startedAtMs: 100,
            finishedAtMs: 110,
            durationMs: 10,
        },
    });

    assert.equal(projected.status, 'completed');
    assert.equal(projected.steps[0]?.outcome.status, 'failed');
    assert.equal(projected.results?.[0]?.status, 'unavailable');
    assert.equal(
        projected.steps[0]?.attempts?.[0]?.reasonCode,
        'evaluator_runtime_error'
    );
});
