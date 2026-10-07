/**
 * @description: Verifies the public workflow view preserves recorded status, order, and privacy boundaries.
 * @footnote-scope: test
 * @footnote-module: TraceWorkflowDetailsTests
 * @footnote-risk: low - Covers public rendering of workflow facts only.
 * @footnote-ethics: high - Prevents missing lineage or private attempt details from being misrepresented.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorkflowRecord } from '@footnote/contracts/policy';
import TraceWorkflowDetails from './TraceWorkflowDetails.js';

const createWorkflow = (): WorkflowRecord => ({
    runId: 'run-public',
    runStatus: 'completed',
    workflowId: 'workflow-public',
    workflowName: 'reviewed_chat',
    status: 'completed',
    terminationReason: 'goal_satisfied',
    durationMs: 24,
    stepCount: 2,
    maxSteps: 4,
    maxDurationMs: 10_000,
    effectiveLimits: [
        {
            key: 'maxWorkflowSteps',
            state: 'enforced',
            value: 4,
            stoppedRun: false,
        },
    ],
    results: [
        {
            resultId: 'result-answer',
            name: 'answer',
            status: 'produced',
            producedByStepId: 'step-generate',
            producedByAttempt: 2,
        },
    ],
    steps: [
        {
            stepId: 'step-plan',
            attempt: 1,
            stepKind: 'plan',
            startedAt: '2026-10-01T00:00:00.000Z',
            finishedAt: '2026-10-01T00:00:00.010Z',
            durationMs: 10,
            inputRefs: [],
            resultRefs: [{ name: 'plan' }],
            attempts: [],
            outcome: {
                status: 'executed',
                summary: 'Used a recorded fallback plan.',
                signals: { contractType: 'fallback' },
                artifacts: ['private plan body'],
            },
        },
        {
            stepId: 'step-generate',
            parentStepId: 'step-plan',
            attempt: 1,
            stepKind: 'generate',
            startedAt: '2026-10-01T00:00:00.010Z',
            finishedAt: '2026-10-01T00:00:00.024Z',
            durationMs: 14,
            model: 'answer-model',
            usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
            cost: {
                inputCostUsd: 0.001,
                outputCostUsd: 0.002,
                totalCostUsd: 0.003,
            },
            inputRefs: [{ name: 'question', resultId: 'result-question' }],
            resultRefs: [{ name: 'answer', resultId: 'result-answer' }],
            attempts: [
                {
                    attempt: 1,
                    status: 'failed',
                    startedAt: '2026-10-01T00:00:00.010Z',
                    finishedAt: '2026-10-01T00:00:00.015Z',
                    durationMs: 5,
                    requestedProvider: 'provider-a',
                    requestedModel: 'model-a',
                    actualProvider: 'provider-a',
                    actualModel: 'model-a',
                    reasonCode: 'temporary_failure',
                    settings: { requested: { prompt: 'private prompt' } },
                },
                {
                    attempt: 2,
                    status: 'succeeded',
                    startedAt: '2026-10-01T00:00:00.016Z',
                    finishedAt: '2026-10-01T00:00:00.024Z',
                    durationMs: 8,
                    requestedProvider: 'provider-b',
                    requestedModel: 'model-b',
                    actualProvider: 'provider-b',
                    actualModel: 'model-b',
                },
            ],
            outcome: {
                status: 'executed',
                summary: 'Generated the delivered answer.',
                artifacts: ['private answer artifact body'],
            },
        },
    ],
});

const renderWorkflow = (workflow: WorkflowRecord | null): string =>
    renderToStaticMarkup(createElement(TraceWorkflowDetails, { workflow }));

test('workflow page orders Steps and keeps Attempt history subordinate', () => {
    const html = renderWorkflow(createWorkflow());

    assert.ok(html.indexOf('Planning') < html.indexOf('Answer generation'));
    assert.match(html, /fallback plan/u);
    assert.match(html, /Declared results:[\s\S]*plan/u);
    assert.match(html, /Inputs:[\s\S]*question/u);
    assert.match(html, /2 Attempts · retry history/u);
    assert.match(html, /Attempt 2 \(retry\): Succeeded/u);
    assert.match(html, /Completed/u);
    assert.match(html, /24ms/u);
    assert.match(html, /answer: produced by Step step-generate, Attempt 2/u);
});

test('fallback plan keeps its Step status and explains a recorded fallback Attempt', () => {
    const workflow = createWorkflow();
    const html = renderWorkflow({
        ...workflow,
        steps: workflow.steps.map((step) =>
            step.stepKind === 'plan'
                ? {
                      ...step,
                      outcome: { ...step.outcome, status: 'failed' },
                      attempts: [
                          {
                              attempt: 1,
                              status: 'succeeded',
                              startedAt: '2026-10-01T00:00:00.000Z',
                              finishedAt: '2026-10-01T00:00:00.010Z',
                              durationMs: 10,
                              reasonCode: 'search_rerouted_to_fallback_profile',
                          },
                      ],
                  }
                : step
        ),
    });

    assert.match(html, /Planning <span>— Failed · fallback plan<\/span>/u);
    assert.match(html, /Attempt 1: Succeeded/u);
    assert.match(html, /A fallback search profile was used\./u);
    assert.doesNotMatch(html, /search_rerouted_to_fallback_profile/u);
});

test('workflow page distinguishes explicit degraded, limited, failed, and rejected outcomes', () => {
    const workflow = createWorkflow();

    for (const status of [
        'degraded',
        'limited',
        'failed',
        'rejected',
    ] as const) {
        const html = renderWorkflow({ ...workflow, runStatus: status });
        assert.ok(html.includes(status[0]?.toUpperCase() + status.slice(1)));
    }
});

test('workflow page treats missing legacy lineage as unavailable, not inferred', () => {
    const html = renderWorkflow(null);

    assert.match(html, /Detailed workflow steps are not recorded/u);
    assert.match(html, /Older or direct runs may have no workflow record/u);
    assert.doesNotMatch(html, /Answer generation/u);
});

test('workflow page labels missing limits and Attempts as unavailable', () => {
    const workflow = createWorkflow();
    const html = renderWorkflow({
        ...workflow,
        effectiveLimits: undefined,
        steps: workflow.steps.map((step) => ({
            ...step,
            attempts: undefined,
        })),
    });

    assert.match(html, /Recorded limits[\s\S]*Unavailable \(not recorded\)/u);
    assert.match(html, /Attempt details are unavailable \(not recorded\)/u);
});

test('workflow page does not render private attempt settings or artifact bodies', () => {
    const html = renderWorkflow(createWorkflow());

    assert.doesNotMatch(html, /private prompt/u);
    assert.doesNotMatch(html, /private plan body/u);
    assert.doesNotMatch(html, /private answer artifact body/u);
});
