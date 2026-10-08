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
        {
            title: 'valid',
            url: 'https://example.com/valid',
            snippet: 'retrieved body must stay private',
        },
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
    assert.deepEqual(projected.citations, [
        { title: 'valid', url: 'https://example.com/valid' },
    ]);
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
            execution: [
                {
                    kind: 'tool',
                    status: 'failed',
                    toolName: 'private operator tool',
                    reasonCode: 'tool_timeout',
                },
            ],
            trace_target: {},
            trace_final: {},
            workflow: {
                workflowId: 'workflow-1',
                workflowName: 'chat_orchestration',
                sessionCorrelationId: 'private-session-correlation',
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
                        resultId: 'result-1',
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
                        reasonCode: 'generation_runtime_error',
                        usage: { promptTokens: 12, completionTokens: 4 },
                        cost: {
                            inputCostUsd: 0.01,
                            outputCostUsd: 0.02,
                            totalCostUsd: 0.03,
                        },
                        inputRefs: [{ name: 'question', resultId: 'input-1' }],
                        resultRefs: [{ name: 'answer', resultId: 'result-1' }],
                        attempts: [
                            {
                                attempt: 1,
                                status: 'failed',
                                startedAt: new Date().toISOString(),
                                finishedAt: new Date().toISOString(),
                                durationMs: 0,
                                requestedProvider: 'requested-provider',
                                requestedModel: 'requested-model',
                                actualProvider: 'actual-provider',
                                actualModel: 'actual-model',
                                reasonCode: 'provider_timeout',
                                settings: {
                                    requested: {
                                        privatePrompt: 'private prompt setting',
                                    },
                                },
                                usage: { promptTokens: 12 },
                                cost: {
                                    inputCostUsd: 0.01,
                                    outputCostUsd: 0,
                                    totalCostUsd: 0.01,
                                },
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
                                contractType: 'fallback',
                                routingChainAttemptCount: 1,
                                routingChainAttemptsJson: '[]',
                                privateSignal: 'private signal value',
                            },
                            recommendations: ['private recommendation body'],
                        },
                    },
                ],
            },
            imageGeneration: { prompts: { original: 'private image prompt' } },
        },
        baseTrace.responseId
    );

    assert.ok(projected?.workflow);
    assert.equal(projected.workflow.sessionCorrelationId, undefined);
    assert.equal(projected.workflow.startedAt, '2026-10-04T00:00:00.000Z');
    assert.equal(projected.workflow.finishedAt, '2026-10-04T00:00:00.025Z');
    assert.equal(projected.workflow.durationMs, 25);
    assert.deepEqual(projected.workflow.results, [
        {
            resultId: 'result-1',
            name: 'answer',
            status: 'produced',
            producedByStepId: 'step-1',
            producedByAttempt: 1,
        },
    ]);
    assert.deepEqual(projected.workflow.steps[0]?.inputRefs, [
        { name: 'question', resultId: 'input-1' },
    ]);
    assert.deepEqual(projected.workflow.steps[0]?.resultRefs, [
        { name: 'answer', resultId: 'result-1' },
    ]);
    assert.equal(projected.workflow.steps[0]?.attempts?.[0]?.status, 'failed');
    assert.equal(
        projected.workflow.steps[0]?.attempts?.[0]?.actualProvider,
        'actual-provider'
    );
    assert.equal(
        projected.workflow.steps[0]?.attempts?.[0]?.actualModel,
        'actual-model'
    );
    assert.equal(projected.workflow.steps[0]?.reasonCode, undefined);
    assert.equal(
        projected.workflow.steps[0]?.attempts?.[0]?.reasonCode,
        undefined
    );
    assert.equal(
        projected.workflow.steps[0]?.attempts?.[0]?.terminationReason,
        undefined
    );
    assert.equal(projected.execution, undefined);
    assert.equal(
        projected.workflow.steps[0]?.attempts?.[0]?.settings,
        undefined
    );
    assert.equal(
        JSON.stringify(projected.workflow).includes('private-target'),
        false
    );
    assert.equal(
        JSON.stringify(projected.workflow).includes('private-flow'),
        false
    );
    assert.equal(
        projected.workflow.steps[0]?.attempts?.[0]?.trustGraphTargets,
        undefined
    );
    assert.equal(projected.imageGeneration, undefined);
    assert.equal(
        JSON.stringify(projected).includes('private image prompt'),
        false
    );
    assert.equal(JSON.stringify(projected).includes('retrieved body'), false);
    assert.equal(
        JSON.stringify(projected).includes('private prompt setting'),
        false
    );
    assert.equal(
        JSON.stringify(projected).includes('private recommendation body'),
        false
    );
    assert.equal(JSON.stringify(projected).includes('provider_timeout'), false);
    assert.equal(
        JSON.stringify(projected).includes('private operator tool'),
        false
    );
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
        contractType: 'fallback',
    });
    assert.equal(
        'privateSignal' in (projected.workflow.steps[0]?.outcome.signals ?? {}),
        false
    );
    assert.deepEqual(projected.workflow.steps[0]?.outcome.artifacts, [
        '[redacted:21 chars]',
    ]);
});

test('public trace exposes the safe fallback fact but omits recorded routing details', () => {
    const projected = projectTraceMetadataForDisplay(
        {
            ...baseTrace,
            provenanceAssessment: undefined,
            trace_target: {},
            trace_final: {},
            workflow: {
                workflowId: 'workflow-fallback',
                workflowName: 'reviewed_chat',
                status: 'completed',
                terminationReason: 'goal_satisfied',
                stepCount: 1,
                maxSteps: 4,
                maxDurationMs: 10_000,
                steps: [
                    {
                        stepId: 'step-generate',
                        attempt: 1,
                        stepKind: 'generate',
                        startedAt: '2026-10-04T00:00:00.000Z',
                        finishedAt: '2026-10-04T00:00:00.025Z',
                        durationMs: 25,
                        attempts: [
                            {
                                attempt: 1,
                                status: 'succeeded',
                                startedAt: '2026-10-04T00:00:00.000Z',
                                finishedAt: '2026-10-04T00:00:00.025Z',
                                durationMs: 25,
                                routingAttempts: [
                                    {
                                        index: 0,
                                        profileId: 'private-profile-id',
                                        status: 'succeeded',
                                        reasonCode:
                                            'search_rerouted_to_fallback_profile',
                                        chooseOneUsed: false,
                                        temporaryUnavailableReason:
                                            'private routing diagnostic',
                                    },
                                    {
                                        index: 1,
                                        profileId: 'private-primary-profile-id',
                                        status: 'failed',
                                        reasonCode: 'provider_timeout',
                                        chooseOneUsed: false,
                                    },
                                ],
                            },
                        ],
                        outcome: {
                            status: 'executed',
                            summary: 'Generated the delivered answer.',
                        },
                    },
                ],
            },
        },
        baseTrace.responseId
    );

    assert.ok(projected?.workflow);
    assert.equal(
        projected.workflow.steps[0]?.attempts?.[0]?.reasonCode,
        'search_rerouted_to_fallback_profile'
    );
    assert.equal(
        projected.workflow.steps[0]?.attempts?.[0]?.routingAttempts,
        undefined
    );
    const publicWorkflow = JSON.stringify(projected.workflow);
    assert.equal(publicWorkflow.includes('private-profile-id'), false);
    assert.equal(publicWorkflow.includes('private routing diagnostic'), false);
    assert.equal(publicWorkflow.includes('provider_timeout'), false);
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

test('public trace display keeps valid planner fallback while withholding operator signals', () => {
    const projected = projectTraceMetadataForDisplay(
        {
            ...baseTrace,
            workflow: {
                workflowId: 'workflow-planner',
                workflowName: 'reviewed_chat',
                status: 'completed',
                terminationReason: 'goal_satisfied',
                stepCount: 1,
                maxSteps: 4,
                maxDurationMs: 10_000,
                steps: [
                    {
                        stepId: 'step-plan',
                        attempt: 1,
                        stepKind: 'plan',
                        startedAt: '2026-10-04T00:00:00.000Z',
                        finishedAt: '2026-10-04T00:00:00.001Z',
                        durationMs: 1,
                        outcome: {
                            status: 'executed',
                            summary: 'Planner selected the declared route.',
                            signals: {
                                action: 'message',
                                contractType: 'fallback',
                                purpose: 'chat_orchestrator_action_selection',
                                applyOutcome: 'not_applied',
                                selectedProfileId: 'private-profile',
                                privateSignal: 'operator-only detail',
                            },
                        },
                    },
                ],
            },
        },
        baseTrace.responseId
    );

    assert.ok(projected?.workflow);
    assert.deepEqual(projected.workflow.steps[0]?.outcome.signals, {
        action: 'message',
        contractType: 'fallback',
    });
    assert.equal(JSON.stringify(projected).includes('private-profile'), false);
    assert.equal(
        JSON.stringify(projected).includes('operator-only detail'),
        false
    );
});
