/**
 * @description: Verifies field-level trace display projection and explicit partial-state reporting.
 * @footnote-scope: test
 * @footnote-module: TraceDisplayProjectionTests
 * @footnote-risk: low - Tests synthetic read projections only.
 * @footnote-ethics: medium - Prevents malformed provenance from being presented as complete.
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { projectTraceMetadataForDisplay } from '../src/storage/traces/traceDisplayProjection.js';

const baseTrace = {
    responseId: 'trace_partial_583',
    provenance: 'Retrieved',
    safetyTier: 'Low',
    tradeoffCount: 1,
    chainHash: 'hash',
    licenseContext: 'MIT',
    modelVersion: 'gpt-5.6-luna',
    staleAfter: new Date().toISOString(),
    citations: [
        { title: 'valid', url: 'https://example.com/valid' },
        { title: 'invalid', url: 'not-a-url' },
    ],
    provenanceAssessment: { methodId: 'not-valid' },
    trace_target: { tightness: 3, rationale: 'bad' },
    trace_final: { tightness: 4, attribution: 2 },
    trace_final_reason_code: 'runtime_posture_adjustment',
    secretPrompt: 'must not be returned',
};

test('trace display projection keeps valid fields and names unavailable fields', () => {
    const projected = projectTraceMetadataForDisplay(
        baseTrace,
        baseTrace.responseId
    );

    assert.ok(projected);
    assert.equal(projected.displayIntegrity.status, 'partial');
    assert.deepEqual(projected.citations, [baseTrace.citations[0]]);
    assert.deepEqual(projected.trace_target, { tightness: 3 });
    assert.deepEqual(projected.trace_final, { tightness: 4, attribution: 2 });
    assert.equal(projected.provenanceAssessment, undefined);
    assert.equal('secretPrompt' in projected, false);
    assert.ok(
        projected.displayIntegrity.unavailableFields.includes('citations[1]')
    );
    assert.ok(
        projected.displayIntegrity.unavailableFields.includes(
            'provenanceAssessment'
        )
    );
    assert.ok(
        projected.displayIntegrity.unavailableFields.includes(
            'trace_target.rationale'
        )
    );
});

test('trace display projection marks a fully valid record complete', () => {
    const projected = projectTraceMetadataForDisplay(
        {
            ...baseTrace,
            citations: [baseTrace.citations[0]],
            provenanceAssessment: undefined,
            trace_target: { tightness: 3 },
            trace_final: { tightness: 3 },
            trace_final_reason_code: undefined,
        },
        baseTrace.responseId
    );

    assert.ok(projected);
    assert.deepEqual(projected.displayIntegrity, {
        status: 'complete',
        unavailableFields: [],
    });
});

test('public trace display allowlists workflow receipts while omitting operator detail', () => {
    const projected = projectTraceMetadataForDisplay(
        {
            ...baseTrace,
            provenanceAssessment: undefined,
            trace_target: {},
            trace_final: {},
            workflow: {
                workflowId: 'workflow-1',
                workflowName: 'chat_orchestration',
                status: 'completed',
                terminationReason: 'goal_satisfied',
                startedAt: '2026-10-04T00:00:00.000Z',
                finishedAt: '2026-10-04T00:00:00.025Z',
                durationMs: 25,
                stepCount: 1,
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
                limitStop: {
                    stoppedByLimit: false,
                    terminationReason: 'goal_satisfied',
                },
                userMemory: { includedItemCount: 1 },
                results: [
                    {
                        resultId: 'private-result',
                        name: 'answer',
                        status: 'produced',
                        producedByStepId: 'step-1',
                        producedByAttempt: 1,
                    },
                ],
                steps: [
                    {
                        stepId: 'step-1',
                        attempt: 1,
                        stepKind: 'generate',
                        startedAt: new Date().toISOString(),
                        finishedAt: new Date().toISOString(),
                        durationMs: 0,
                        model: 'model-public-summary',
                        usage: { promptTokens: 12, completionTokens: 4 },
                        cost: {
                            inputCostUsd: 0.01,
                            outputCostUsd: 0.02,
                            totalCostUsd: 0.03,
                        },
                        inputRefs: [{ name: 'private-input' }],
                        resultRefs: [{ name: 'private-result' }],
                        attempts: [
                            {
                                attempt: 1,
                                status: 'succeeded',
                                startedAt: new Date().toISOString(),
                                finishedAt: new Date().toISOString(),
                                durationMs: 0,
                                trustGraphTargets: [
                                    {
                                        targetId: 'private-target',
                                        flow: 'private-flow',
                                        collection: 'private-collection',
                                        outcome: 'executed',
                                        measurements: {
                                            provenance: 'footnote_measured',
                                            requestDurationMs: 12,
                                            returnedSourceCount: 2,
                                            retainedSourceCount: 1,
                                        },
                                    },
                                ],
                            },
                        ],
                        outcome: {
                            status: 'executed',
                            summary: 'Generated a response.',
                            artifacts: ['private artifact body'],
                            signals: {
                                action: 'message',
                                routingChainAttemptCount: 1,
                                routingChainAttemptsJson: '[]',
                                privateSignal: 'private signal value',
                            },
                            recommendations: ['Keep the answer concise.'],
                        },
                    },
                ],
            },
        },
        baseTrace.responseId
    );

    assert.ok(projected?.workflow);
    assert.equal(projected.workflow.startedAt, '2026-10-04T00:00:00.000Z');
    assert.equal(projected.workflow.finishedAt, '2026-10-04T00:00:00.025Z');
    assert.equal(projected.workflow.durationMs, 25);
    assert.equal('results' in projected.workflow, false);
    assert.equal('attempts' in projected.workflow.steps[0]!, false);
    assert.equal(
        JSON.stringify(projected.workflow).includes('private-target'),
        false
    );
    assert.equal(
        JSON.stringify(projected.workflow).includes('private-flow'),
        false
    );
    assert.equal('inputRefs' in projected.workflow.steps[0]!, false);
    assert.equal('resultRefs' in projected.workflow.steps[0]!, false);
    assert.equal(projected.workflow.results, undefined);
    assert.equal(projected.workflow.userMemory?.includedItemCount, 1);
    assert.equal(
        projected.workflow.effectiveLimits?.[0]?.key,
        'maxWorkflowSteps'
    );
    assert.deepEqual(projected.workflow.steps[0]?.usage, {
        promptTokens: 12,
        completionTokens: 4,
    });
    assert.deepEqual(projected.workflow.steps[0]?.outcome.signals, {
        action: 'message',
        routingChainAttemptCount: 1,
        routingChainAttemptsJson: '[]',
    });
    assert.equal(
        'privateSignal' in (projected.workflow.steps[0]?.outcome.signals ?? {}),
        false
    );
    assert.deepEqual(projected.workflow.steps[0]?.outcome.artifacts, [
        '[redacted:21 chars]',
    ]);
});

test('public trace display omits malformed workflow with unknown fields', () => {
    const projected = projectTraceMetadataForDisplay(
        {
            ...baseTrace,
            provenanceAssessment: undefined,
            trace_target: {},
            trace_final: {},
            workflow: {
                workflowId: 'workflow-1',
                workflowName: 'chat_orchestration',
                status: 'completed',
                terminationReason: 'goal_satisfied',
                stepCount: 1,
                maxSteps: 4,
                maxDurationMs: 10_000,
                privateWorkflowField: 'private workflow value',
                steps: [
                    {
                        stepId: 'step-1',
                        attempt: 1,
                        stepKind: 'generate',
                        startedAt: new Date().toISOString(),
                        finishedAt: new Date().toISOString(),
                        durationMs: 0,
                        privateStepField: 'private step value',
                        outcome: {
                            status: 'executed',
                            summary: 'Generated a response.',
                            privateOutcomeField: 'private outcome value',
                        },
                    },
                ],
            },
        },
        baseTrace.responseId
    );

    assert.ok(projected);
    assert.equal(projected.workflow, undefined);
    assert.ok(
        projected.displayIntegrity.unavailableFields.includes('workflow')
    );
});
