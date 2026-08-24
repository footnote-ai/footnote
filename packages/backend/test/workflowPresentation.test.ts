/**
 * @description: Verifies the workflow invokes draft-first presentation before final main-model wording.
 * @footnote-scope: test
 * @footnote-module: WorkflowPresentationTests
 * @footnote-risk: high - A reversed call order would restore plain-answer-first behavior.
 * @footnote-ethics: high - Workflow tracing must make the presentation path visible without exposing response text.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type {
    GenerationRequest,
    GenerationResult,
    GenerationRuntime,
} from '@footnote/agent-runtime';
import type { ModelProfile } from '@footnote/contracts';
import {
    runBoundedReviewWorkflow,
    type ReviewWorkflowUsageSummary,
} from '../src/services/workflowEngine.js';
import type { PresentationConfig } from '../src/services/presentation.js';
import type { ConversationContextEnvelope } from '../src/services/conversationContextService.js';

const profile: ModelProfile = {
    id: 'presentation',
    description: 'test',
    provider: 'openai',
    providerModel: 'gpt-5-mini',
    enabled: true,
    tierBindings: [],
    capabilities: { canUseSearch: false },
    maxInputTokens: 2000,
    maxOutputTokens: 500,
    costClass: 'low',
    latencyClass: 'low',
    providerRouting: { openrouter: { only: ['openai'] } },
};
const config: PresentationConfig = {
    enabled: true,
    profileId: profile.id,
    profile,
    validatorProfileId: profile.id,
    validatorProfile: profile,
    timeoutMs: 100,
    validatorTimeoutMs: 100,
};
const generated = (text: string): GenerationResult => ({
    text,
    model: 'gpt-5-mini',
    usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
    provenance: 'Inferred',
    citations: [],
});
const usage = (value: GenerationResult): ReviewWorkflowUsageSummary => ({
    model: value.model ?? 'gpt-5-mini',
    promptTokens: value.usage?.promptTokens ?? 0,
    completionTokens: value.usage?.completionTokens ?? 0,
    totalTokens: value.usage?.totalTokens ?? 0,
    estimatedCost: {
        inputCostUsd: 0.001,
        outputCostUsd: 0.002,
        totalCostUsd: 0.003,
    },
});
const contextEnvelope: ConversationContextEnvelope = {
    participants: [],
    turns: [],
    diagnostics: {
        surface: 'web',
        totalInputMessages: 0,
        projectedMessageCount: 0,
        trimmedMessageCount: 0,
        sanitizedTimestampCount: 0,
        projectedSpeakerLabelCount: 0,
    },
};
const policy = {
    enablePlanning: false,
    enableToolUse: false,
    enableReplanning: false,
    enableGeneration: true,
    enableAssessment: false,
    enableRevision: false,
};

const runPresentationScenario = async (
    generate: (
        call: number,
        request: GenerationRequest
    ) => Promise<GenerationResult>,
    configOverride: Partial<PresentationConfig> = {}
) => {
    let calls = 0;
    const result = await runBoundedReviewWorkflow({
        generationRuntime: {
            kind: 'test',
            generate: (request) => {
                calls += 1;
                return generate(calls, request);
            },
        },
        generationRequest: {
            messages: [
                {
                    role: 'system',
                    content:
                        'AUTHORITATIVE CONTEXT: Ada Lovelace confirmed 12 fixes at https://example.com/release.',
                },
                { role: 'user', content: 'status' },
            ],
        },
        messagesWithHints: [
            {
                role: 'system',
                content:
                    'AUTHORITATIVE CONTEXT: Ada Lovelace confirmed 12 fixes at https://example.com/release.',
            },
            { role: 'user', content: 'status' },
        ],
        contextEnvelope,
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'test',
            maxIterations: 1,
            maxDurationMs: 1000,
            executionLimits: {
                maxWorkflowSteps: 3,
                maxToolCalls: 0,
                maxDeliberationCalls: 0,
                maxTokensTotal: 100,
                maxDurationMs: 1000,
            },
        },
        workflowPolicy: policy,
        captureUsage: usage,
        presentation: {
            config: { ...config, ...configOverride },
            persona: {
                id: 'myuri',
                presentationGuidance: 'Lively prose.',
                expressionStrength: 'balanced',
                expressionSource: 'persona_default',
                expressionGuidance: 'Persona expression strength: balanced.',
            },
            captureUsage: usage,
        },
    });
    return result;
};

test('workflow asks for a styled draft before main-model finalization and records the receipt', async () => {
    const calls: GenerationRequest[] = [];
    const generationUsageTexts: string[] = [];
    const presentationUsageCalls: Array<{
        feature: 'chat_presentation_draft' | 'chat_presentation_audit';
        profileId: string;
    }> = [];
    const captureGenerationUsage = (
        value: GenerationResult
    ): ReviewWorkflowUsageSummary => {
        generationUsageTexts.push(value.text);
        return usage(value);
    };
    const capturePresentationUsage = (
        value: GenerationResult,
        profile: ModelProfile,
        feature: 'chat_presentation_draft' | 'chat_presentation_audit'
    ): ReviewWorkflowUsageSummary => {
        presentationUsageCalls.push({ feature, profileId: profile.id });
        return usage(value);
    };
    const runtime: GenerationRuntime = {
        kind: 'test',
        generate: async (request) => {
            calls.push(request);
            if (calls.length === 1)
                return generated(
                    'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
                );
            if (calls.length === 2)
                return generated(
                    'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
                );
            if (calls.length === 3)
                return generated(
                    '{"verdict":"evidence_issue","feedback":"Restore the attribution."}'
                );
            return generated(
                'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
            );
        },
    };
    const result = await runBoundedReviewWorkflow({
        generationRuntime: runtime,
        generationRequest: { messages: [{ role: 'user', content: 'status' }] },
        messagesWithHints: [{ role: 'user', content: 'status' }],
        contextEnvelope,
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'test',
            maxIterations: 0,
            maxDurationMs: 1000,
            executionLimits: {
                maxWorkflowSteps: 2,
                maxToolCalls: 0,
                maxDeliberationCalls: 0,
                maxTokensTotal: 100,
                maxDurationMs: 1000,
            },
        },
        workflowPolicy: policy,
        stepRoutingChainSet: {
            enabledProfilesById: new Map([[profile.id, profile]]),
            generateCandidates: [
                { profileId: profile.id, chooseOneUsed: false },
            ],
            assessCandidates: [],
        },
        captureUsage: captureGenerationUsage,
        presentation: {
            config,
            persona: {
                id: 'myuri',
                presentationGuidance: 'Lively prose.',
                expressionStrength: 'balanced',
                expressionSource: 'persona_default',
                expressionGuidance: 'Persona expression strength: balanced.',
            },
            captureUsage: capturePresentationUsage,
        },
    });
    assert.equal(result.outcome, 'generated');
    if (result.outcome !== 'generated')
        throw new Error('Expected generated result.');
    assert.equal(
        result.presentation?.outcome,
        'finalized_after_evidence_repair'
    );
    assert.equal(result.presentation?.reasonCode, 'evidence_repaired');
    assert.match(
        String(calls[0]?.messages[0]?.content),
        /Write the full presentation draft/u
    );
    assert.match(
        String(calls[1]?.messages.at(-2)?.content),
        /prose authority/u
    );
    assert.match(
        String(calls[3]?.messages.at(-2)?.content),
        /Restore the attribution/u
    );
    assert.match(
        String(
            calls[0]?.messages.find((message) =>
                message.content.includes('FOOTNOTE CONTEXT MANIFEST')
            )?.content
        ),
        /not evidence that a name was absent/iu
    );
    assert.match(
        String(calls[1]?.messages.at(-2)?.content),
        /Persona expression strength: balanced/u
    );
    assert.deepEqual(
        calls.map((call) => call.providerRouting),
        [
            { openrouter: { only: ['openai'] } },
            { openrouter: { only: ['openai'] } },
            { openrouter: { only: ['openai'] } },
            { openrouter: { only: ['openai'] } },
        ]
    );
    assert.deepEqual(presentationUsageCalls, [
        { feature: 'chat_presentation_draft', profileId: profile.id },
        { feature: 'chat_presentation_audit', profileId: profile.id },
    ]);
    assert.equal(result.presentation?.backendEstimatedCostUsd, 0.012);
    assert.equal(result.workflowLineage.terminationReason, 'goal_satisfied');
    assert.equal(result.workflowLineage.steps.length, 1);
    const [presentationStep] = result.workflowLineage.steps;
    assert.deepEqual(
        presentationStep?.outcome.artifacts?.map((artifact) =>
            artifact.startsWith('candidate_')
        ),
        [true, true, true]
    );
    const responseCandidates = result.responseCandidates;
    assert.ok(responseCandidates);
    assert.deepEqual(
        responseCandidates.map((candidate) => ({
            stage: candidate.stage,
            state: candidate.state,
            workflowStepId: candidate.workflowStepId,
            parentCandidateId: candidate.parentCandidateId,
        })),
        [
            {
                stage: 'presentation_draft',
                state: 'superseded',
                workflowStepId: 'step_1',
                parentCandidateId: undefined,
            },
            {
                stage: 'presentation_finalization',
                state: 'superseded',
                workflowStepId: 'step_1',
                parentCandidateId: responseCandidates[0]?.id,
            },
            {
                stage: 'presentation_repair',
                state: 'selected',
                workflowStepId: 'step_1',
                parentCandidateId: responseCandidates[1]?.id,
            },
        ]
    );
    const { artifacts: _artifacts, ...outcomeWithoutArtifacts } =
        presentationStep!.outcome;
    assert.deepEqual(
        { ...presentationStep, outcome: outcomeWithoutArtifacts },
        {
            stepId: 'step_1',
            attempt: 1,
            stepKind: 'presentation',
            reasonCode: 'presentation_finalized',
            startedAt: result.workflowLineage.steps[0]?.startedAt,
            finishedAt: result.workflowLineage.steps[0]?.finishedAt,
            durationMs: result.workflowLineage.steps[0]?.durationMs,
            model: 'gpt-5-mini',
            usage: {
                promptTokens: 32,
                completionTokens: 16,
                totalTokens: 48,
            },
            cost: {
                inputCostUsd: 0.004,
                outputCostUsd: 0.008,
                totalCostUsd: 0.012,
            },
            outcome: {
                status: 'executed',
                summary:
                    'Finalized presentation draft with evidence-aware editing.',
                signals: {
                    presentationOutcome: 'finalized_after_evidence_repair',
                    presentationReasonCode: 'evidence_repaired',
                    presentationAttempted: true,
                    draftAttemptCount: 1,
                    finalizerAttemptCount: 2,
                    auditAttemptCount: 1,
                    auditOutcome: 'evidence_issue',
                    draftProfileId: 'presentation',
                    auditProfileId: 'presentation',
                },
            },
        }
    );
    assert.deepEqual(generationUsageTexts, [
        'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.',
        'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.',
    ]);
    assert.equal(
        result.generationResult.text,
        'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
    );
});

test('workflow falls back to normal generation after a structured presentation draft', async () => {
    let calls = 0;
    const runtime: GenerationRuntime = {
        kind: 'test',
        generate: async () => {
            calls += 1;
            return calls === 1
                ? generated('```json\n{"answer":"not prose"}\n```')
                : generated('Normal main-model response.');
        },
    };

    const result = await runBoundedReviewWorkflow({
        generationRuntime: runtime,
        generationRequest: { messages: [{ role: 'user', content: 'status' }] },
        messagesWithHints: [{ role: 'user', content: 'status' }],
        contextEnvelope,
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'test',
            maxIterations: 1,
            maxDurationMs: 1000,
            executionLimits: {
                maxWorkflowSteps: 2,
                maxToolCalls: 0,
                maxDeliberationCalls: 0,
                maxTokensTotal: 100,
                maxDurationMs: 1000,
            },
        },
        workflowPolicy: policy,
        captureUsage: usage,
        presentation: {
            config,
            persona: {
                id: 'myuri',
                presentationGuidance: 'Lively prose.',
                expressionStrength: 'balanced',
                expressionSource: 'persona_default',
                expressionGuidance: 'Persona expression strength: balanced.',
            },
            captureUsage: usage,
        },
    });

    assert.equal(result.outcome, 'generated');
    if (result.outcome !== 'generated')
        throw new Error('Expected generated result.');
    assert.equal(result.presentation?.outcome, 'fallback');
    assert.equal(result.presentation?.reasonCode, 'structured_output');
    assert.equal(result.generationResult.text, 'Normal main-model response.');
    assert.equal(result.workflowLineage.steps[0]?.stepKind, 'presentation');
    assert.equal(result.workflowLineage.steps[0]?.outcome.status, 'failed');
    assert.equal(
        result.workflowLineage.steps[0]?.reasonCode,
        'presentation_fallback'
    );
    assert.equal(result.workflowLineage.steps[1]?.stepKind, 'generate');
    const responseCandidates = result.responseCandidates;
    assert.ok(responseCandidates);
    assert.deepEqual(responseCandidates, [
        {
            id: responseCandidates[0]?.id,
            workflowStepId: 'step_1',
            sequence: 0,
            stage: 'presentation_draft',
            state: 'superseded',
            text: '```json\n{"answer":"not prose"}\n```',
        },
        {
            id: responseCandidates[1]?.id,
            parentCandidateId: responseCandidates[0]?.id,
            workflowStepId: 'step_2',
            sequence: 1,
            stage: 'fallback',
            state: 'selected',
            text: 'Normal main-model response.',
        },
    ]);
});

test('workflow keeps timeout and provider-error traces free of presentation candidates', async () => {
    const timeoutResult = await runPresentationScenario(
        async (call) => {
            if (call === 1) {
                await new Promise<void>((resolve) => setTimeout(resolve, 20));
                return generated('Late draft.');
            }
            return generated('Normal answer after timeout.');
        },
        { timeoutMs: 5 }
    );
    const providerErrorResult = await runPresentationScenario(async (call) => {
        if (call === 1) {
            throw new Error('draft provider unavailable');
        }
        return generated('Normal answer after provider error.');
    });

    for (const [result, reasonCode, answer] of [
        [timeoutResult, 'draft_timeout', 'Normal answer after timeout.'],
        [
            providerErrorResult,
            'draft_provider_error',
            'Normal answer after provider error.',
        ],
    ] as const) {
        assert.equal(result.outcome, 'generated');
        if (result.outcome !== 'generated') {
            continue;
        }
        assert.equal(result.presentation?.reasonCode, reasonCode);
        assert.equal(result.generationResult.text, answer);
        assert.deepEqual(
            result.responseCandidates?.map((candidate) => candidate.stage),
            ['fallback']
        );
    }
});

test('workflow exposes only the returned draft when the finalizer fails', async () => {
    const result = await runPresentationScenario(async (call) => {
        if (call === 1) {
            return generated(
                'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
            );
        }
        if (call === 2) {
            throw new Error('finalizer provider unavailable');
        }
        return generated('Normal answer after finalizer failure.');
    });

    assert.equal(result.outcome, 'generated');
    if (result.outcome !== 'generated') {
        return;
    }
    assert.equal(result.presentation?.reasonCode, 'finalizer_provider_error');
    assert.deepEqual(
        result.responseCandidates?.map((candidate) => candidate.stage),
        ['presentation_draft', 'fallback']
    );
    assert.equal(
        result.generationResult.text,
        'Normal answer after finalizer failure.'
    );
});

test('workflow keeps returned presentation candidates before a mechanical fallback', async () => {
    const result = await runPresentationScenario(async (call) => {
        if (call === 1) {
            return generated(
                'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
            );
        }
        if (call === 2) {
            return generated('A lively update: 12 fixes confirmed.');
        }
        return generated('Normal answer after mechanical fallback.');
    });

    assert.equal(result.outcome, 'generated');
    if (result.outcome !== 'generated') {
        return;
    }
    assert.equal(
        result.presentation?.reasonCode,
        'mechanical_preservation_failed'
    );
    assert.deepEqual(
        result.responseCandidates?.map((candidate) => candidate.stage),
        ['presentation_draft', 'presentation_finalization', 'fallback']
    );
    assert.equal(
        result.generationResult.text,
        'Normal answer after mechanical fallback.'
    );
});

test('workflow selects a successful finalization and does not create a fallback candidate', async () => {
    const result = await runPresentationScenario(async (call) => {
        if (call === 1) {
            return generated(
                'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
            );
        }
        if (call === 2) {
            return generated(
                'A bright release: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
            );
        }
        return generated('{"verdict":"clear","feedback":""}');
    });

    assert.equal(result.outcome, 'generated');
    if (result.outcome !== 'generated') {
        return;
    }
    assert.equal(result.presentation?.reasonCode, 'finalized');
    assert.deepEqual(
        result.responseCandidates?.map((candidate) => candidate.stage),
        ['presentation_draft', 'presentation_finalization']
    );
    assert.equal(result.responseCandidates?.at(-1)?.state, 'selected');
});

test('does not suppress presentation when resolved TRACE caution is high', async () => {
    const calls: GenerationRequest[] = [];
    const runtime: GenerationRuntime = {
        kind: 'test',
        generate: async (request) => {
            calls.push(request);
            return generated('Normal main-model response.');
        },
    };

    const result = await runBoundedReviewWorkflow({
        generationRuntime: runtime,
        generationRequest: { messages: [{ role: 'user', content: 'status' }] },
        messagesWithHints: [{ role: 'user', content: 'status' }],
        contextEnvelope,
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'test',
            maxIterations: 1,
            maxDurationMs: 1000,
            executionLimits: {
                maxWorkflowSteps: 2,
                maxToolCalls: 0,
                maxDeliberationCalls: 0,
                maxTokensTotal: 100,
                maxDurationMs: 1000,
            },
        },
        workflowPolicy: policy,
        captureUsage: usage,
        presentation: {
            config,
            persona: {
                id: 'myuri',
                presentationGuidance: 'Lively prose.',
                expressionStrength: 'balanced',
                expressionSource: 'persona_default',
                expressionGuidance: 'Persona expression strength: balanced.',
            },
            caution: 5,
            captureUsage: usage,
        },
    });

    assert.equal(result.outcome, 'generated');
    if (result.outcome !== 'generated')
        throw new Error('Expected generated result.');
    assert.equal(result.presentation?.expressionStrength, 'balanced');
    assert.equal(result.presentation?.attempted, true);
    assert.ok(calls.length > 1);
    assert.equal(
        calls.some((call) =>
            call.messages.some((message) =>
                String(message.content).includes(
                    'Write the full presentation draft'
                )
            )
        ),
        true
    );
    assert.equal(result.workflowLineage.steps[0]?.stepKind, 'presentation');
    assert.equal(result.workflowLineage.steps[0]?.outcome.status, 'executed');
});
