/**
 * @description: Verifies incomplete routed generations fail over without losing usage accounting.
 * @footnote-scope: test
 * @footnote-module: GenerationRoutingFallbackTests
 * @footnote-risk: high - A regression can make every normal response surface a false budget failure.
 * @footnote-ethics: high - Users need complete answers and truthful failure records.
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
} from '../../src/services/workflowCore/reviewedChatWorkflow.js';
import type { ConversationContextEnvelope } from '../../src/services/conversationContextService.js';

const contextEnvelope: ConversationContextEnvelope = {
    participants: [],
    turns: [],
    diagnostics: {
        surface: 'web',
        totalInputMessages: 1,
        projectedMessageCount: 1,
        trimmedMessageCount: 0,
        sanitizedTimestampCount: 0,
        projectedSpeakerLabelCount: 0,
    },
};

const makeProfile = (id: string): ModelProfile => ({
    id,
    description: id,
    provider: 'openai',
    providerModel: id,
    enabled: true,
    tierBindings: [],
    capabilities: {
        canUseSearch: false,
        supportedReasoningEfforts: ['none'],
    },
    maxOutputTokens: 128_000,
});

const usage = (result: GenerationResult): ReviewWorkflowUsageSummary => {
    const promptTokens = result.usage?.promptTokens ?? 0;
    const completionTokens = result.usage?.completionTokens ?? 0;
    const totalTokens =
        result.usage?.totalTokens ?? promptTokens + completionTokens;
    return {
        model: result.model ?? 'unknown',
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCost: {
            inputCostUsd: 0,
            outputCostUsd: 0,
            totalCostUsd: 0,
        },
    };
};

const runGeneration = async (input: {
    runtime: GenerationRuntime;
    request: GenerationRequest;
    candidates: ModelProfile[];
}) =>
    runBoundedReviewWorkflow({
        generationRuntime: input.runtime,
        generationRequest: input.request,
        messagesWithHints: input.request.messages,
        contextEnvelope,
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'message_reviewed',
            maxIterations: 1,
            maxDurationMs: 10_000,
            executionLimits: {
                maxWorkflowSteps: 2,
                maxToolCalls: 0,
                maxDeliberationCalls: 0,
                // Even the stale 96k live override leaves ample room for
                // this large but ordinary prompt when admission is honest.
                maxTokensTotal: 96_000,
                maxDurationMs: 10_000,
            },
        },
        workflowPolicy: {
            enablePlanning: false,
            enableToolUse: false,
            enableReplanning: false,
            enableGeneration: true,
            enableAssessment: false,
            enableRevision: false,
        },
        captureUsage: usage,
        stepRoutingChainSet: {
            enabledProfilesById: new Map(
                input.candidates.map((profile) => [profile.id, profile])
            ),
            generateCandidates: input.candidates.map((profile) => ({
                profileId: profile.id,
                chooseOneUsed: false,
            })),
            assessCandidates: [],
        },
    });

test('gives a large-prompt generation useful output room and advances after incomplete provider output', async () => {
    const first = makeProfile('first-profile');
    const second = makeProfile('second-profile');
    const requests: GenerationRequest[] = [];
    const runtime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate(request) {
            requests.push(request);
            if (requests.length === 1) {
                return {
                    text: '',
                    model: first.providerModel,
                    finishReason: 'length',
                    completion: {
                        status: 'incomplete',
                        reason: 'max_output_tokens',
                        visibleTextLength: 0,
                    },
                    usage: {
                        promptTokens: 12_000,
                        completionTokens: 2_000,
                        reasoningTokens: 1_500,
                        totalTokens: 14_000,
                    },
                    provenance: 'Inferred',
                    citations: [],
                };
            }
            return {
                text: 'A complete answer.',
                model: second.providerModel,
                completion: {
                    status: 'completed',
                    visibleTextLength: 18,
                },
                usage: {
                    promptTokens: 12_000,
                    completionTokens: 40,
                    reasoningTokens: 8,
                    totalTokens: 12_040,
                },
                provenance: 'Inferred',
                citations: [],
            };
        },
    };

    const result = await runGeneration({
        runtime,
        request: {
            messages: [
                {
                    role: 'user',
                    content: 'Explain this context. '.repeat(5_000),
                },
            ],
        },
        candidates: [first, second],
    });

    assert.equal(result.outcome, 'generated');
    assert.equal(requests.length, 2);
    assert.ok((requests[0]?.maxOutputTokens ?? 0) > 1_000);
    assert.ok((requests[1]?.maxOutputTokens ?? 0) > 1_000);
    const generateStep = result.workflowLineage.steps.find(
        (step) => step.stepKind === 'generate'
    );
    assert.ok(generateStep);
    assert.equal(generateStep.usage?.totalTokens, 26_040);
    const attempts = JSON.parse(
        String(generateStep.outcome.signals?.routingChainAttemptsJson)
    ) as Array<{
        profileId: string;
        status: string;
        reasonCode?: string;
        finishReason?: string;
        completion?: { status: string; visibleTextLength: number };
        usage?: { totalTokens?: number };
    }>;
    assert.deepEqual(
        attempts.map((attempt) => [attempt.profileId, attempt.status]),
        [
            ['first-profile', 'failed_transient_advanced'],
            ['second-profile', 'executed'],
        ]
    );
    assert.equal(
        attempts[0]?.reasonCode,
        'generation_incomplete_before_output'
    );
    assert.equal(attempts[0]?.finishReason, 'length');
    assert.deepEqual(attempts[0]?.completion, {
        status: 'incomplete',
        reason: 'max_output_tokens',
        visibleTextLength: 0,
    });
    assert.equal(attempts[0]?.usage?.totalTokens, 14_000);
});

test('rejects empty completed output before selecting a fallback candidate', async () => {
    const first = makeProfile('first-profile');
    const second = makeProfile('second-profile');
    let calls = 0;
    const runtime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate(request) {
            calls += 1;
            return calls === 1
                ? {
                      text: '   ',
                      model: request.model,
                      finishReason: 'stop',
                      completion: {
                          status: 'completed',
                          visibleTextLength: 0,
                      },
                      usage: {
                          promptTokens: 10,
                          completionTokens: 2,
                          totalTokens: 12,
                      },
                      provenance: 'Inferred' as const,
                      citations: [],
                  }
                : {
                      text: 'Fallback answer.',
                      model: request.model,
                      completion: {
                          status: 'completed',
                          visibleTextLength: 16,
                      },
                      usage: {
                          promptTokens: 10,
                          completionTokens: 4,
                          totalTokens: 14,
                      },
                      provenance: 'Inferred' as const,
                      citations: [],
                  };
        },
    };

    const result = await runGeneration({
        runtime,
        request: { messages: [{ role: 'user', content: 'Reply.' }] },
        candidates: [first, second],
    });

    assert.equal(result.outcome, 'generated');
    if (result.outcome !== 'generated') {
        throw new Error('Expected fallback generation to be selected.');
    }
    assert.equal(result.generationResult.text, 'Fallback answer.');
    const generateStep = result.workflowLineage.steps.find(
        (step) => step.stepKind === 'generate'
    );
    assert.ok(generateStep);
    const attempts = JSON.parse(
        String(generateStep.outcome.signals?.routingChainAttemptsJson)
    ) as Array<{ profileId: string; reasonCode?: string }>;
    assert.equal(attempts[0]?.profileId, first.id);
    assert.equal(attempts[0]?.reasonCode, 'generation_empty_output');
    assert.equal(attempts[1]?.profileId, second.id);
});

test('keeps an all-incomplete routed generation rejected and retains its usage', async () => {
    const first = makeProfile('first-profile');
    const second = makeProfile('second-profile');
    let calls = 0;
    const runtime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate() {
            calls += 1;
            return {
                text: 'partial answer',
                model: calls === 1 ? first.providerModel : second.providerModel,
                completion: {
                    status: 'incomplete',
                    reason: 'max_output_tokens',
                    visibleTextLength: 14,
                },
                usage: {
                    promptTokens: 100,
                    completionTokens: 80,
                    totalTokens: 180,
                },
                provenance: 'Inferred',
                citations: [],
            };
        },
    };

    const result = await runGeneration({
        runtime,
        request: {
            messages: [{ role: 'user', content: 'Reply.' }],
        },
        candidates: [first, second],
    });

    assert.equal(result.outcome, 'no_generation');
    assert.equal(calls, 2);
    const generateStep = result.workflowLineage.steps.find(
        (step) => step.stepKind === 'generate'
    );
    assert.ok(generateStep);
    assert.equal(
        generateStep.reasonCode,
        'generation_incomplete_before_output'
    );
    assert.equal(generateStep.usage?.totalTokens, 360);
});
