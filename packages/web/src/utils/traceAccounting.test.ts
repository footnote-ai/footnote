/**
 * @description: Verifies trace accounting aggregation and incomplete-cost labeling.
 * @footnote-scope: test
 * @footnote-module: TraceAccountingTests
 * @footnote-risk: low - Tests cover read-only usage and cost formatting inputs.
 * @footnote-ethics: medium - Coverage checks prevent incomplete spend from appearing complete.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowRecord } from '@footnote/contracts/policy';
import { summarizeTraceAccounting } from './traceAccounting.js';

const createWorkflow = (): WorkflowRecord => ({
    workflowId: 'wf_trace_accounting',
    workflowName: 'message_reviewed',
    status: 'completed',
    terminationReason: 'goal_satisfied',
    stepCount: 2,
    maxSteps: 8,
    maxDurationMs: 70000,
    steps: [
        {
            stepId: 'step_1',
            attempt: 1,
            stepKind: 'plan',
            startedAt: '2026-01-01T00:00:00.000Z',
            finishedAt: '2026-01-01T00:00:01.000Z',
            durationMs: 1000,
            outcome: {
                status: 'executed',
                summary: 'Planned response.',
            },
        },
        {
            stepId: 'step_2',
            parentStepId: 'step_1',
            attempt: 1,
            stepKind: 'generate',
            startedAt: '2026-01-01T00:00:01.000Z',
            finishedAt: '2026-01-01T00:00:02.000Z',
            durationMs: 1000,
            model: 'gpt-5-mini',
            usage: {
                promptTokens: 100,
                completionTokens: 20,
                totalTokens: 120,
            },
            cost: {
                inputCostUsd: 0.001,
                outputCostUsd: 0.002,
                totalCostUsd: 0.003,
            },
            outcome: {
                status: 'executed',
                summary: 'Generated response.',
            },
        },
    ],
});

test('summarizeTraceAccounting labels missing planner cost as partial', () => {
    const summary = summarizeTraceAccounting(createWorkflow());

    assert.deepEqual(summary, {
        usage: {
            promptTokens: 100,
            completionTokens: 20,
            totalTokens: 120,
        },
        recordedCost: {
            inputCostUsd: 0.001,
            outputCostUsd: 0.002,
            totalCostUsd: 0.003,
        },
        usageStepCount: 1,
        costStepCount: 1,
        modelStepCount: 2,
        costCoverage: 'partial',
    });
});

test('summarizeTraceAccounting reports complete coverage when every model step has cost', () => {
    const workflow = createWorkflow();
    const plannerStep = workflow.steps[0];
    if (!plannerStep) {
        throw new Error('Expected planner step fixture.');
    }
    plannerStep.usage = {
        promptTokens: 30,
        completionTokens: 10,
        totalTokens: 40,
    };
    plannerStep.cost = {
        inputCostUsd: 0.0003,
        outputCostUsd: 0.0002,
        totalCostUsd: 0.0005,
    };

    const summary = summarizeTraceAccounting(workflow);

    assert.equal(summary?.usage.totalTokens, 160);
    assert.equal(summary?.recordedCost.totalCostUsd, 0.0035);
    assert.equal(summary?.costStepCount, 2);
    assert.equal(summary?.modelStepCount, 2);
    assert.equal(summary?.costCoverage, 'complete');
});

test('summarizeTraceAccounting sums non-model cost without counting model coverage', () => {
    const workflow = createWorkflow();
    workflow.steps.push({
        stepId: 'step_3',
        parentStepId: 'step_1',
        attempt: 1,
        stepKind: 'tool',
        startedAt: '2026-01-01T00:00:02.000Z',
        finishedAt: '2026-01-01T00:00:03.000Z',
        durationMs: 1000,
        cost: {
            inputCostUsd: 0.004,
            outputCostUsd: 0.005,
            totalCostUsd: 0.009,
        },
        outcome: {
            status: 'executed',
            summary: 'Executed a billed tool.',
        },
    });

    const summary = summarizeTraceAccounting(workflow);

    assert.equal(summary?.recordedCost.inputCostUsd, 0.005);
    assert.equal(summary?.recordedCost.outputCostUsd, 0.007);
    assert.equal(summary?.recordedCost.totalCostUsd, 0.012);
    assert.equal(summary?.costStepCount, 1);
    assert.equal(summary?.modelStepCount, 2);
    assert.equal(summary?.costCoverage, 'partial');
});

test('summarizeTraceAccounting returns null without workflow metadata', () => {
    assert.equal(summarizeTraceAccounting(undefined), null);
});
