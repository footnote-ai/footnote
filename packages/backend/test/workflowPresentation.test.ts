/**
 * @description: Verifies presentation candidates feed ordinary authoritative generation and review.
 * @footnote-scope: test
 * @footnote-module: WorkflowPresentationTests
 * @footnote-risk: high - A shortcut here could bypass authoritative generation or review.
 * @footnote-ethics: high - Response history must distinguish expression influence from evidence authority.
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
};
const config: PresentationConfig = {
    enabled: true,
    profileId: profile.id,
    profile,
    timeoutMs: 100,
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
    enableAssessment: true,
    enableRevision: true,
};
const presentationPersona = {
    id: 'myuri',
    presentationGuidance: 'Lively prose.',
    expressionStrength: 'strong' as const,
    expressionSource: 'profile' as const,
    expressionGuidance: 'Persona expression strength: strong.',
};
const baseRequest: GenerationRequest = {
    messages: [{ role: 'user', content: 'status' }],
    search: {
        query: 'current status',
        contextSize: 'low',
        intent: 'current_facts',
    },
};

const runScenario = async (
    generate: (
        request: GenerationRequest,
        call: number
    ) => Promise<GenerationResult>,
    options?: {
        workflowPolicy?: typeof policy;
        maxWorkflowSteps?: number;
        maxTokensTotal?: number;
    }
) => {
    const calls: GenerationRequest[] = [];
    const presentationFeatures: string[] = [];
    let call = 0;
    const runtime: GenerationRuntime = {
        kind: 'test',
        generate: async (request) => {
            calls.push(request);
            call += 1;
            return generate(request, call);
        },
    };
    const result = await runBoundedReviewWorkflow({
        generationRuntime: runtime,
        generationRequest: baseRequest,
        messagesWithHints: baseRequest.messages,
        contextEnvelope,
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'test',
            maxIterations: 1,
            maxDurationMs: 1000,
            executionLimits: {
                maxWorkflowSteps: options?.maxWorkflowSteps ?? 8,
                maxToolCalls: 0,
                maxDeliberationCalls: 4,
                maxTokensTotal: options?.maxTokensTotal ?? 5000,
                maxDurationMs: 1000,
            },
        },
        workflowPolicy: options?.workflowPolicy ?? policy,
        captureUsage: usage,
        presentation: {
            config,
            persona: presentationPersona,
            caution: 3,
            captureUsage: (value, _profile, feature) => {
                presentationFeatures.push(feature);
                assert.equal(feature, 'chat_presentation_draft');
                return usage(value);
            },
        },
        personaExpressionGuidance: presentationPersona.expressionGuidance,
    });
    return { calls, result, presentationFeatures };
};

const reviewFinalize = JSON.stringify({
    reviewDecision: 'finalize',
    reviewReason: 'The authoritative answer is ready.',
});
const reviewRevise = JSON.stringify({
    reviewDecision: 'revise',
    reviewReason: 'Preserve the requested voice while tightening the answer.',
    revisionInstruction: 'Keep the recognizable persona expression.',
});

test('runs candidate, authoritative generation, and ordinary assessment in order', async () => {
    const candidate = 'A vivid candidate with a distinct cadence.';
    const { calls, result, presentationFeatures } = await runScenario(
        async (_request, call) => {
            if (call === 1) return generated(candidate);
            if (call === 2)
                return generated('Authoritative reconciled answer.');
            return generated(reviewFinalize);
        }
    );

    assert.equal(result.outcome, 'generated');
    if (result.outcome !== 'generated')
        throw new Error('Expected generated result.');
    assert.equal(result.presentation?.outcome, 'candidate_generated');
    assert.deepEqual(presentationFeatures, ['chat_presentation_draft']);
    assert.equal(calls.length, 3);
    assert.equal(calls[0]?.search, undefined);
    assert.equal(calls[1]?.search?.query, 'current status');
    assert.match(
        String(calls[1]?.messages.at(-1)?.content),
        /PRESENTATION CANDIDATE/u
    );
    assert.match(
        String(calls[1]?.messages.at(-1)?.content),
        /A vivid candidate/u
    );
    const presentationStep = result.workflowLineage.steps.find(
        (step) => step.stepKind === 'presentation'
    );
    const generationStep = result.workflowLineage.steps.find(
        (step) => step.stepKind === 'generate'
    );
    assert.ok(presentationStep !== undefined);
    assert.ok(generationStep !== undefined);
    assert.ok(
        Date.parse(presentationStep.finishedAt) <=
            Date.parse(generationStep.startedAt)
    );
    assert.doesNotMatch(
        calls[2]?.messages.map((message) => message.content).join('\n') ?? '',
        /A vivid candidate/u
    );
    assert.deepEqual(
        result.responseCandidates?.map((candidateValue) => ({
            stage: candidateValue.stage,
            state: candidateValue.state,
            parentCandidateId: candidateValue.parentCandidateId,
        })),
        [
            {
                stage: 'presentation_draft',
                state: 'superseded',
                parentCandidateId: undefined,
            },
            {
                stage: 'initial_generation',
                state: 'selected',
                parentCandidateId: result.responseCandidates?.[0]?.id,
            },
        ]
    );
});

test('skips presentation when only authoritative generation fits the budget', async () => {
    const { calls, result, presentationFeatures } = await runScenario(
        async () => generated('Authoritative answer.'),
        { maxTokensTotal: 300 }
    );

    assert.equal(result.outcome, 'generated');
    assert.equal(calls.length, 1);
    assert.deepEqual(presentationFeatures, []);
    assert.equal(result.presentation?.outcome, 'candidate_unavailable');
    assert.equal(result.presentation?.reasonCode, 'budget_skipped');
    assert.equal(result.presentation?.attempted, false);
});

test('bounds authoritative generation so assessment can follow a skipped candidate', async () => {
    const { calls, result } = await runScenario(
        async (_request, call) =>
            call === 1
                ? generated('Authoritative answer.')
                : generated(reviewFinalize),
        { maxTokensTotal: 3000 }
    );

    assert.equal(result.outcome, 'generated');
    assert.equal(calls.length, 2);
    assert.equal(result.presentation?.reasonCode, 'budget_skipped');
    assert.deepEqual(
        result.workflowLineage.steps.map((step) => step.stepKind),
        ['generate', 'assess']
    );
});

test('records a provider overrun for an admitted presentation and stops later work', async () => {
    const overrunCandidate = {
        ...generated('Candidate text.'),
        usage: {
            promptTokens: 6500,
            completionTokens: 4500,
            totalTokens: 11000,
        },
    };
    const { calls, result } = await runScenario(
        async (_request, call) =>
            call === 1 ? overrunCandidate : generated('Should not run.'),
        { maxTokensTotal: 10000 }
    );

    assert.equal(calls.length, 1);
    assert.equal(result.outcome, 'no_generation');
    assert.equal(result.presentation?.outcome, 'candidate_generated');
    assert.equal(result.presentation?.reasonCode, 'candidate_generated');
    assert.equal(result.workflowLineage.status, 'degraded');
    assert.equal(
        result.workflowLineage.terminationReason,
        'budget_exhausted_tokens'
    );
    assert.deepEqual(
        result.workflowLineage.steps.map((step) => step.stepKind),
        ['presentation']
    );
    assert.equal(result.workflowLineage.steps[0]?.usage?.totalTokens, 11000);
});

test('runs ordinary revision without carrying the raw presentation candidate', async () => {
    const candidate = 'A vivid candidate with a distinct cadence.';
    const { calls, result } = await runScenario(async (_request, call) => {
        if (call === 1) return generated(candidate);
        if (call === 2) return generated('Authoritative reconciled answer.');
        if (call === 3) return generated(reviewRevise);
        return generated('Reviewed answer with preserved persona guidance.');
    });

    assert.equal(result.outcome, 'generated');
    if (result.outcome !== 'generated')
        throw new Error('Expected generated result.');
    assert.ok(calls.length >= 4);
    for (const reviewRequest of calls.slice(2)) {
        assert.doesNotMatch(
            reviewRequest.messages.map((message) => message.content).join('\n'),
            /A vivid candidate/u
        );
    }
    assert.deepEqual(
        result.responseCandidates?.map(
            (candidateValue) => candidateValue.stage
        ),
        ['presentation_draft', 'initial_generation', 'revision']
    );
    assert.equal(result.responseCandidates?.at(-1)?.state, 'selected');
});

test('falls back to ordinary generation and review without a candidate', async () => {
    const { calls, result } = await runScenario(async (_request, call) => {
        if (call === 1) throw new Error('candidate provider unavailable');
        if (call === 2) return generated('Ordinary authoritative answer.');
        return generated(reviewFinalize);
    });

    assert.equal(result.outcome, 'generated');
    if (result.outcome !== 'generated')
        throw new Error('Expected generated result.');
    assert.equal(result.presentation?.outcome, 'candidate_unavailable');
    assert.equal(calls.length, 3);
    assert.doesNotMatch(
        calls[1]?.messages.map((message) => message.content).join('\n') ?? '',
        /PRESENTATION CANDIDATE/u
    );
    assert.deepEqual(
        result.responseCandidates?.map(
            (candidateValue) => candidateValue.stage
        ),
        ['initial_generation']
    );
});

test('candidate failure does not consume the only authoritative workflow step', async () => {
    const { calls, result } = await runScenario(
        async (_request, call) => {
            if (call === 1) throw new Error('candidate provider unavailable');
            return generated('Ordinary authoritative answer.');
        },
        { maxWorkflowSteps: 1 }
    );

    assert.equal(result.outcome, 'generated');
    assert.equal(calls.length, 2);
    assert.equal(result.presentation?.outcome, 'candidate_unavailable');
});

test('preserves candidate metadata when a later authoritative step is blocked', async () => {
    const { calls, result } = await runScenario(
        async () => generated('Candidate text.'),
        { maxWorkflowSteps: 1 }
    );

    assert.equal(result.outcome, 'no_generation');
    assert.equal(calls.length, 1);
    assert.equal(result.presentation?.outcome, 'candidate_generated');
});

test('presentation does not run when authoritative generation is disabled', async () => {
    const { calls, result } = await runScenario(
        async () => generated('This call must not run.'),
        {
            workflowPolicy: {
                ...policy,
                enableGeneration: false,
            },
        }
    );

    assert.equal(result.outcome, 'no_generation');
    assert.equal(calls.length, 0);
});

test('stops review after an incomplete generation with no visible text', async () => {
    const incomplete = generated('');
    incomplete.finishReason = 'length';
    incomplete.completion = {
        status: 'incomplete',
        reason: 'max_output_tokens',
        visibleTextLength: 0,
    };
    incomplete.usage = {
        promptTokens: 40,
        completionTokens: 1200,
        reasoningTokens: 1200,
        totalTokens: 1240,
    };

    const { calls, result } = await runScenario(async (_request, call) => {
        if (call === 1) return generated('Presentation candidate.');
        return incomplete;
    });

    assert.equal(calls.length, 2);
    assert.equal(result.outcome, 'generated');
    if (result.outcome !== 'generated')
        throw new Error('Expected generated result.');
    assert.equal(result.generationResult.text, '');
    assert.deepEqual(result.responseCandidates, []);
    assert.equal(result.workflowLineage.status, 'degraded');
    assert.equal(
        result.workflowLineage.steps.at(-1)?.reasonCode,
        'generation_incomplete_before_output'
    );
    assert.equal(
        result.workflowLineage.steps.at(-1)?.usage?.reasoningTokens,
        1200
    );
});
