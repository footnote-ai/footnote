/**
 * @description: Verifies context-step execution, merge ordering, and fail-open behavior.
 * @footnote-scope: test
 * @footnote-module: WorkflowEngineContextStepTests
 * @footnote-risk: medium - Context-step regressions can misapply tools or block generation.
 * @footnote-ethics: high - Context provenance and clarification behavior must stay auditable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {
    GenerationRuntime,
    RuntimeMessage,
} from '@footnote/agent-runtime';
import type {
    ContextStepResult,
    ToolInvocationName,
} from '@footnote/contracts/policy';
import { runBoundedReviewWorkflowForTest } from './helpers.js';
import type { ConversationContextEnvelope } from '../../src/services/conversationContextService.js';

const contextEnvelopeWithUserTurn: ConversationContextEnvelope = {
    participants: [],
    turns: [
        {
            turnId: 'turn-1',
            role: 'user',
            speakerId: 'user-1',
            speakerLabel: 'Jordan',
            visibility: 'model_visible',
            authority: 'conversation',
        },
    ],
    diagnostics: {
        surface: 'web',
        totalInputMessages: 1,
        projectedMessageCount: 1,
        trimmedMessageCount: 0,
        sanitizedTimestampCount: 0,
        projectedSpeakerLabelCount: 0,
    },
};

test('runBoundedReviewWorkflow does not emit concrete tool steps in current engine-owned review path', async () => {
    const generationRuntime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate({ messages }) {
            const lastSystemMessage = [...messages]
                .reverse()
                .find((message) => message.role === 'system');
            const isAssessmentCall =
                lastSystemMessage?.content.includes(
                    'Return plain JSON only.'
                ) === true;

            return isAssessmentCall
                ? {
                      text: '{"reviewDecision":"finalize","reviewReason":"done"}',
                      model: 'gpt-5-mini',
                      usage: {
                          promptTokens: 8,
                          completionTokens: 4,
                          totalTokens: 12,
                      },
                      provenance: 'Inferred',
                      citations: [],
                  }
                : {
                      text: 'draft',
                      model: 'gpt-5-mini',
                      usage: {
                          promptTokens: 10,
                          completionTokens: 5,
                          totalTokens: 15,
                      },
                      provenance: 'Inferred',
                      citations: [],
                  };
        },
    };

    const result = await runBoundedReviewWorkflowForTest({
        generationRuntime,
        generationRequest: {
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Summarize weather' }],
        },
        messagesWithHints: [{ role: 'user', content: 'Summarize weather' }],
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'message_reviewed',
            maxIterations: 1,
            maxDurationMs: 15000,
        },
        workflowPolicy: {
            enablePlanning: false,
            enableToolUse: true,
            enableReplanning: false,
            enableGeneration: true,
            enableAssessment: true,
            enableRevision: true,
        },
        captureUsage: (generationResult) => ({
            model: generationResult.model ?? 'gpt-5-mini',
            promptTokens: generationResult.usage?.promptTokens ?? 0,
            completionTokens: generationResult.usage?.completionTokens ?? 0,
            totalTokens: generationResult.usage?.totalTokens ?? 0,
            estimatedCost: {
                inputCostUsd: 0,
                outputCostUsd: 0,
                totalCostUsd: 0,
            },
        }),
    });

    assert.equal(result.outcome, 'generated');
    assert.equal(
        result.workflowLineage.steps.some((step) => step.stepKind === 'tool'),
        false
    );
});

test('runBoundedReviewWorkflow executes injected context step and records context artifacts before generation', async () => {
    const generationRuntime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate() {
            return {
                text: 'draft',
                model: 'gpt-5-mini',
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                provenance: 'Inferred',
                citations: [],
            };
        },
    };

    const result = await runBoundedReviewWorkflowForTest({
        generationRuntime,
        generationRequest: {
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Need weather summary' }],
        },
        messagesWithHints: [
            { role: 'user', content: 'Need weather summary' },
            { role: 'system', content: 'hint' },
        ],
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'message_reviewed',
            maxIterations: 1,
            maxDurationMs: 15000,
        },
        workflowPolicy: {
            enablePlanning: false,
            enableToolUse: true,
            enableReplanning: false,
            enableGeneration: true,
            enableAssessment: true,
            enableRevision: true,
        },
        contextStepRequests: [
            {
                integrationName: 'weather_forecast',
                requested: true,
                eligible: true,
                input: { location: 'Indianapolis' },
            },
        ],
        contextStepExecutor: async () => ({
            outcome: 'executed',
            executionContext: {
                toolName: 'weather_forecast',
                status: 'executed',
                durationMs: 4,
            },
            evidence: {
                content: ['weather_context: clear skies'],
                visibility: 'model_visible',
                authority: 'advisory',
            },
        }),
        captureUsage: (generationResult) => ({
            model: generationResult.model ?? 'gpt-5-mini',
            promptTokens: generationResult.usage?.promptTokens ?? 0,
            completionTokens: generationResult.usage?.completionTokens ?? 0,
            totalTokens: generationResult.usage?.totalTokens ?? 0,
            estimatedCost: {
                inputCostUsd: 0,
                outputCostUsd: 0,
                totalCostUsd: 0,
            },
        }),
    });

    assert.equal(result.outcome, 'generated');
    const toolStep = result.workflowLineage.steps.find(
        (step) => step.stepKind === 'tool'
    );
    assert.ok(toolStep);
    assert.equal(toolStep.outcome.status, 'executed');
    assert.deepEqual(toolStep.outcome.artifacts, [
        'weather_context: clear skies',
    ]);
});

test('runBoundedReviewWorkflow preserves backend-injected context steps after planner continuation', async () => {
    const executedIntegrations: string[] = [];
    const generationRuntime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate() {
            return {
                text: 'draft',
                model: 'gpt-5-mini',
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                provenance: 'Inferred',
                citations: [],
            };
        },
    };

    const plannerResult = {
        plan: {
            action: 'message' as const,
            modality: 'text' as const,
            safetyTier: 'Low' as const,
            reasoning: 'Continue message flow.',
            generation: {
                reasoningEffort: 'low' as const,
                verbosity: 'low' as const,
            },
        },
        execution: {
            status: 'executed' as const,
            purpose: 'chat_orchestrator_action_selection' as const,
            contractType: 'structured' as const,
            durationMs: 1,
        },
        ingestion: {
            outputApplyOutcome: 'accepted' as const,
            fallbackTier: 'none' as const,
            correctionCodes: [],
            outOfContractFields: [],
            authorityFieldAttempts: [],
        },
        diagnostics: {
            rawToolIntentPresent: false,
            normalizedToolIntentPresent: false,
            toolIntentRejected: false,
            toolIntentRejectionReasons: [],
        },
    };

    const result = await runBoundedReviewWorkflowForTest({
        generationRuntime,
        generationRequest: {
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Need context' }],
        },
        messagesWithHints: [{ role: 'user', content: 'Need context' }],
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'message_with_planner_context',
            maxIterations: 1,
            maxDurationMs: 15000,
            executionLimits: {
                maxWorkflowSteps: 4,
                maxToolCalls: 4,
                maxPlanCycles: 1,
                maxDeliberationCalls: 1,
                maxTokensTotal: Number.MAX_SAFE_INTEGER,
                maxDurationMs: 15000,
            },
        },
        workflowPolicy: {
            enablePlanning: true,
            enableToolUse: true,
            enableReplanning: false,
            enableGeneration: true,
            enableAssessment: false,
            enableRevision: false,
        },
        contextStepRequests: [
            {
                integrationName: 'trustgraph',
                requested: true,
                eligible: true,
                input: { queryIntent: 'Need context' },
            },
        ],
        contextStepExecutorRegistry: {
            trustgraph: async ({ request }) => {
                executedIntegrations.push(request.integrationName);
                return {
                    outcome: 'executed',
                    executionContext: {
                        toolName: request.integrationName,
                        status: 'executed',
                    },
                    evidence: {
                        content: ['trustgraph_context: found'],
                        visibility: 'model_visible',
                        authority: 'advisory',
                    },
                };
            },
            weather_forecast: async ({ request }) => {
                executedIntegrations.push(request.integrationName);
                return {
                    outcome: 'executed',
                    executionContext: {
                        toolName: request.integrationName,
                        status: 'executed',
                    },
                    evidence: {
                        content: ['weather_context: clear skies'],
                        visibility: 'model_visible',
                        authority: 'advisory',
                    },
                };
            },
        },
        plannerStepRequest: {
            workflowId: 'wf_test',
            workflowName: 'message_with_planner_context',
            attempt: 1,
            request: {
                surface: 'web',
                trigger: { kind: 'submit' },
                latestUserInput: 'Need context',
                conversation: [{ role: 'user', content: 'Need context' }],
            },
            invocationContext: {
                owner: 'workflow',
                workflowName: 'message_with_planner_context',
                stepKind: 'plan',
                purpose: 'chat_orchestrator_action_selection',
            },
            capabilityProfiles: [],
        },
        plannerStepExecutor: async () => plannerResult,
        planContinuationBuilder: ({
            baseGenerationRequest,
            baseMessagesWithHints,
            contextEnvelope,
        }) => ({
            continuation: 'continue_message',
            messagesWithHints: baseMessagesWithHints,
            generationRequest: baseGenerationRequest,
            conversationSnapshot: 'planner continuation snapshot',
            contextEnvelope,
            contextStepRequests: [
                {
                    integrationName: 'weather_forecast',
                    requested: true,
                    eligible: true,
                    input: { location: 'Indianapolis' },
                },
            ],
            plannerSummary: {
                executionPlan: plannerResult.plan,
                generationForExecution: plannerResult.plan.generation,
                selectedResponseProfile: {
                    id: 'default',
                    provider: 'openai',
                    providerModel: 'gpt-5-mini',
                    capabilities: {
                        supportsReasoningEffort: true,
                        supportsVerbosity: true,
                        canUseSearch: false,
                        canGenerateImage: false,
                        canUseVision: false,
                        canUseAudio: false,
                        canUseStreaming: true,
                    },
                },
                originalSelectedProfileId: 'default',
                effectiveSelectedProfileId: 'default',
                toolRequestContext: {
                    toolName: 'web_search',
                    requested: false,
                    eligible: false,
                    reasonCode: 'tool_not_requested',
                },
                plannerDiagnostics: plannerResult.diagnostics,
                plannerApplyOutcome: 'applied',
                plannerMattered: true,
                plannerMatteredControlIds: [],
                fallbackReasons: [],
                fallbackRollupSelectionSource: 'default',
                modality: plannerResult.plan.modality,
                safetyTier: plannerResult.plan.safetyTier,
                searchRequested: false,
            },
        }),
        captureUsage: () => ({
            model: 'gpt-5-mini',
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            estimatedCost: {
                inputCostUsd: 0,
                outputCostUsd: 0,
                totalCostUsd: 0,
            },
        }),
    });

    assert.equal(result.outcome, 'generated');
    assert.deepEqual(executedIntegrations, ['trustgraph', 'weather_forecast']);
});

test('runBoundedReviewWorkflow executes eligible context steps in parallel and merges evidence', async () => {
    const observedMessages: RuntimeMessage[][] = [];
    const generationRuntime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate(input) {
            observedMessages.push(input.messages);
            return {
                text: 'draft',
                model: 'gpt-5-mini',
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                provenance: 'Inferred',
                citations: [],
            };
        },
    };
    let weatherStartedAt = 0;
    let weatherFinishedAt = 0;
    let webSearchStartedAt = 0;
    let webSearchFinishedAt = 0;

    const result = await runBoundedReviewWorkflowForTest({
        generationRuntime,
        generationRequest: {
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Need context' }],
        },
        messagesWithHints: [{ role: 'user', content: 'Need context' }],
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'message_with_review_loop',
            maxIterations: 1,
            maxDurationMs: 15000,
            executionLimits: {
                maxWorkflowSteps: 4,
                maxToolCalls: 4,
                maxDeliberationCalls: 2,
                maxTokensTotal: 1000,
                maxDurationMs: 15000,
            },
        },
        workflowPolicy: {
            enablePlanning: false,
            enableToolUse: true,
            enableReplanning: false,
            enableGeneration: true,
            enableAssessment: true,
            enableRevision: true,
        },
        contextStepRequests: [
            {
                integrationName: 'weather_forecast',
                requested: true,
                eligible: true,
            },
            {
                integrationName: 'web_search',
                requested: true,
                eligible: true,
            },
        ],
        contextStepExecutorRegistry: {
            weather_forecast: async () => {
                weatherStartedAt = Date.now();
                await new Promise((resolve) => setTimeout(resolve, 40));
                weatherFinishedAt = Date.now();
                return {
                    outcome: 'executed',
                    executionContext: {
                        toolName: 'weather_forecast',
                        status: 'executed',
                    },
                    evidence: {
                        content: ['weather_context: clear skies'],
                        visibility: 'model_visible',
                        authority: 'advisory',
                    },
                };
            },
            web_search: async () => {
                webSearchStartedAt = Date.now();
                await new Promise((resolve) => setTimeout(resolve, 40));
                webSearchFinishedAt = Date.now();
                return {
                    outcome: 'executed',
                    executionContext: {
                        toolName: 'web_search',
                        status: 'executed',
                    },
                    evidence: {
                        content: ['web_context: top result'],
                        visibility: 'model_visible',
                        authority: 'advisory',
                    },
                };
            },
        },
        captureUsage: (generationResult) => ({
            model: generationResult.model ?? 'gpt-5-mini',
            promptTokens: generationResult.usage?.promptTokens ?? 0,
            completionTokens: generationResult.usage?.completionTokens ?? 0,
            totalTokens: generationResult.usage?.totalTokens ?? 0,
            estimatedCost: {
                inputCostUsd: 0,
                outputCostUsd: 0,
                totalCostUsd: 0,
            },
        }),
    });

    assert.equal(result.outcome, 'generated');
    assert.ok(weatherStartedAt < webSearchFinishedAt);
    assert.ok(webSearchStartedAt < weatherFinishedAt);
    assert.equal(result.contextStepResults?.length, 2);
    const firstMessageBatch = observedMessages[0] ?? [];
    const weatherContextMessageIndex = firstMessageBatch.findIndex(
        (message) =>
            message.role === 'user' &&
            message.content === 'weather_context: clear skies'
    );
    const webContextMessageIndex = firstMessageBatch.findIndex(
        (message) =>
            message.role === 'user' &&
            message.content === 'web_context: top result'
    );
    assert.ok(weatherContextMessageIndex >= 0);
    assert.ok(webContextMessageIndex >= 0);
    assert.ok(weatherContextMessageIndex < webContextMessageIndex);
});

test('runBoundedReviewWorkflow prioritizes exact GitHub context before broad and web discovery', async () => {
    const executionOrder: string[] = [];
    let resolveExactGitHub: (() => void) | undefined;
    const exactGitHubReady = new Promise<void>((resolve) => {
        resolveExactGitHub = resolve;
    });
    const generationRuntime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate() {
            return {
                text: 'draft',
                model: 'gpt-5-mini',
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                provenance: 'Inferred',
                citations: [],
            };
        },
    };
    const contextResult = (name: ToolInvocationName): ContextStepResult => ({
        outcome: 'executed' as const,
        executionContext: {
            toolName: name,
            status: 'executed' as const,
            durationMs: 1,
        },
        evidence: {
            content: [`${name}: context`],
            visibility: 'model_visible',
            authority: 'advisory',
        },
    });
    const resultPromise = runBoundedReviewWorkflowForTest({
        generationRuntime,
        generationRequest: {
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Inspect PR #528.' }],
        },
        messagesWithHints: [{ role: 'user', content: 'Inspect PR #528.' }],
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'message_with_context',
            maxIterations: 0,
            maxDurationMs: 15000,
            executionLimits: {
                maxWorkflowSteps: 5,
                maxToolCalls: 3,
                maxDeliberationCalls: 0,
                maxTokensTotal: 1000,
                maxDurationMs: 15000,
            },
        },
        workflowPolicy: {
            enablePlanning: false,
            enableToolUse: true,
            enableReplanning: false,
            enableGeneration: true,
            enableAssessment: false,
            enableRevision: false,
        },
        contextStepRequests: [
            {
                integrationName: 'web_search',
                requested: true,
                eligible: true,
                input: { intent: 'repo_explainer' },
            },
            {
                integrationName: 'project_context',
                requested: true,
                eligible: true,
            },
            {
                integrationName: 'github_context',
                requested: true,
                eligible: true,
                input: {
                    repository: 'footnote-ai/footnote',
                    reference: { kind: 'pull_request', number: 528 },
                },
            },
        ],
        contextStepExecutorRegistry: {
            github_context: async () => {
                executionOrder.push('github_exact');
                await exactGitHubReady;
                return contextResult('github_exact');
            },
            project_context: async () => {
                executionOrder.push('project_context');
                return contextResult('project_context');
            },
            web_search: async () => {
                executionOrder.push('web_search');
                return contextResult('web_search');
            },
        },
        captureUsage: (generationResult) => ({
            model: generationResult.model ?? 'gpt-5-mini',
            promptTokens: generationResult.usage?.promptTokens ?? 0,
            completionTokens: generationResult.usage?.completionTokens ?? 0,
            totalTokens: generationResult.usage?.totalTokens ?? 0,
            estimatedCost: {
                inputCostUsd: 0,
                outputCostUsd: 0,
                totalCostUsd: 0,
            },
        }),
    });

    await Promise.resolve();
    assert.deepEqual(executionOrder, ['github_exact']);
    resolveExactGitHub?.();
    const result = await resultPromise;
    assert.equal(result.outcome, 'generated');
    assert.deepEqual(executionOrder, [
        'github_exact',
        'project_context',
        'web_search',
    ]);
});

test('runBoundedReviewWorkflow keeps project evidence separate from trusted instructions', async () => {
    const observedMessages: RuntimeMessage[][] = [];
    const generationRuntime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate(input) {
            observedMessages.push(input.messages);
            return {
                text: 'draft',
                model: 'gpt-5-mini',
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                provenance: 'Inferred',
                citations: [],
            };
        },
    };

    const result = await runBoundedReviewWorkflowForTest({
        generationRuntime,
        generationRequest: {
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Explain Footnote.' }],
        },
        messagesWithHints: [{ role: 'user', content: 'Explain Footnote.' }],
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'message_reviewed',
            maxIterations: 1,
            maxDurationMs: 15000,
        },
        workflowPolicy: {
            enablePlanning: false,
            enableToolUse: true,
            enableReplanning: false,
            enableGeneration: true,
            enableAssessment: true,
            enableRevision: true,
        },
        contextStepRequests: [
            {
                integrationName: 'project_context',
                requested: true,
                eligible: true,
            },
        ],
        contextStepExecutor: async () => ({
            outcome: 'executed' as const,
            executionContext: {
                toolName: 'project_context' as const,
                status: 'executed' as const,
            },
            trustedInstructions: ['Trusted project-context guidance.'],
            evidence: {
                content: ['UNTRUSTED PROJECT CONTEXT: repository evidence.'],
                visibility: 'model_visible',
                authority: 'advisory',
            },
        }),
        captureUsage: (generationResult) => ({
            model: generationResult.model ?? 'gpt-5-mini',
            promptTokens: generationResult.usage?.promptTokens ?? 0,
            completionTokens: generationResult.usage?.completionTokens ?? 0,
            totalTokens: generationResult.usage?.totalTokens ?? 0,
            estimatedCost: {
                inputCostUsd: 0,
                outputCostUsd: 0,
                totalCostUsd: 0,
            },
        }),
    });

    assert.equal(result.outcome, 'generated');
    const messages = observedMessages[0] ?? [];
    const trusted = messages.find((message) =>
        message.content.includes('Trusted project-context guidance')
    );
    const untrusted = messages.find(
        (message) =>
            message.role === 'user' &&
            message.content.includes('UNTRUSTED PROJECT CONTEXT')
    );
    const untrustedSystemMessage = messages.find(
        (message) =>
            message.role === 'system' &&
            message.content.includes('UNTRUSTED PROJECT CONTEXT')
    );
    const manifestIndex = messages.findIndex((message) =>
        message.content.includes('FOOTNOTE CONTEXT MANIFEST')
    );
    const untrustedIndex = messages.findIndex((message) =>
        message.content.includes('UNTRUSTED PROJECT CONTEXT')
    );
    assert.equal(trusted?.role, 'system');
    assert.equal(untrusted?.role, 'user');
    assert.equal(untrustedSystemMessage, undefined);
    assert.ok(manifestIndex >= 0 && manifestIndex < untrustedIndex);
});

test('runBoundedReviewWorkflow exposes source state without changing conversation evidence', async () => {
    const observedMessages: RuntimeMessage[][] = [];
    const generationRuntime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate(input) {
            observedMessages.push(input.messages);
            return {
                text: 'draft',
                model: 'gpt-5-mini',
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                provenance: 'Inferred',
                citations: [],
            };
        },
    };

    const result = await runBoundedReviewWorkflowForTest({
        generationRuntime,
        generationRequest: {
            model: 'gpt-5-mini',
            messages: [
                {
                    role: 'user',
                    content:
                        'Compare Ada and Grace based on what I have told you.',
                },
            ],
        },
        messagesWithHints: [
            {
                role: 'user',
                content: 'Compare Ada and Grace based on what I have told you.',
            },
        ],
        contextEnvelope: contextEnvelopeWithUserTurn,
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'message_reviewed',
            maxIterations: 1,
            maxDurationMs: 15000,
        },
        workflowPolicy: {
            enablePlanning: false,
            enableToolUse: true,
            enableReplanning: false,
            enableGeneration: true,
            enableAssessment: true,
            enableRevision: true,
        },
        contextStepRequests: [
            {
                integrationName: 'github_context',
                requested: true,
                eligible: true,
            },
        ],
        contextStepExecutor: async () => ({
            outcome: 'skipped' as const,
            executionContext: {
                toolName: 'github_context' as const,
                status: 'skipped' as const,
                reasonCode: 'tool_unavailable' as const,
            },
        }),
        captureUsage: (generationResult) => ({
            model: generationResult.model ?? 'gpt-5-mini',
            promptTokens: generationResult.usage?.promptTokens ?? 0,
            completionTokens: generationResult.usage?.completionTokens ?? 0,
            totalTokens: generationResult.usage?.totalTokens ?? 0,
            estimatedCost: {
                inputCostUsd: 0,
                outputCostUsd: 0,
                totalCostUsd: 0,
            },
        }),
    });

    assert.equal(result.outcome, 'generated');
    const firstMessages = observedMessages[0] ?? [];
    const manifest = firstMessages.find((message) =>
        message.content.includes('FOOTNOTE CONTEXT MANIFEST')
    );
    assert.ok(manifest);
    assert.match(
        manifest?.content ?? '',
        /github_context: status=unavailable/iu
    );
    assert.match(
        manifest?.content ?? '',
        /not evidence that a name was absent/iu
    );
    assert.ok(
        firstMessages.some(
            (message) =>
                message.role === 'user' &&
                message.content.includes('Ada and Grace')
        )
    );
});

test('runBoundedReviewWorkflow reports missing and throwing context executors', async () => {
    const observedMessages: RuntimeMessage[][] = [];
    const generationRuntime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate(input) {
            observedMessages.push(input.messages);
            return {
                text: 'draft',
                model: 'gpt-5-mini',
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                provenance: 'Inferred',
                citations: [],
            };
        },
    };

    const result = await runBoundedReviewWorkflowForTest({
        generationRuntime,
        generationRequest: {
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Inspect the repository.' }],
        },
        messagesWithHints: [
            { role: 'user', content: 'Inspect the repository.' },
        ],
        contextEnvelope: contextEnvelopeWithUserTurn,
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'message_reviewed',
            maxIterations: 1,
            maxDurationMs: 15000,
        },
        workflowPolicy: {
            enablePlanning: false,
            enableToolUse: true,
            enableReplanning: false,
            enableGeneration: true,
            enableAssessment: true,
            enableRevision: true,
        },
        contextStepRequests: [
            {
                integrationName: 'github_context',
                requested: true,
                eligible: true,
            },
            {
                integrationName: 'project_context',
                requested: true,
                eligible: true,
            },
        ],
        contextStepExecutorRegistry: {
            project_context: async () => {
                throw new Error('project context failed');
            },
        },
        captureUsage: (generationResult) => ({
            model: generationResult.model ?? 'gpt-5-mini',
            promptTokens: generationResult.usage?.promptTokens ?? 0,
            completionTokens: generationResult.usage?.completionTokens ?? 0,
            totalTokens: generationResult.usage?.totalTokens ?? 0,
            estimatedCost: {
                inputCostUsd: 0,
                outputCostUsd: 0,
                totalCostUsd: 0,
            },
        }),
    });

    assert.equal(result.outcome, 'generated');
    const manifest = (observedMessages[0] ?? []).find((message) =>
        message.content.includes('FOOTNOTE CONTEXT MANIFEST')
    );
    assert.match(
        manifest?.content ?? '',
        /github_context: status=unavailable/iu
    );
    assert.match(manifest?.content ?? '', /project_context: status=failed/iu);
    assert.ok(
        result.workflowLineage.steps.some(
            (step) =>
                step.stepKind === 'tool' &&
                step.outcome.status === 'failed' &&
                step.reasonCode === 'tool_execution_error'
        )
    );
});

test('runBoundedReviewWorkflow records failed injected context step with reason and continues fail-open', async () => {
    const generationRuntime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate() {
            return {
                text: 'draft',
                model: 'gpt-5-mini',
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                provenance: 'Inferred',
                citations: [],
            };
        },
    };

    const result = await runBoundedReviewWorkflowForTest({
        generationRuntime,
        generationRequest: {
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Need weather summary' }],
        },
        messagesWithHints: [{ role: 'user', content: 'Need weather summary' }],
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'message_reviewed',
            maxIterations: 1,
            maxDurationMs: 15000,
        },
        workflowPolicy: {
            enablePlanning: false,
            enableToolUse: true,
            enableReplanning: false,
            enableGeneration: true,
            enableAssessment: true,
            enableRevision: true,
        },
        contextStepRequests: [
            {
                integrationName: 'weather_forecast',
                requested: true,
                eligible: true,
                input: { location: 'Indianapolis' },
            },
        ],
        contextStepExecutor: async () => ({
            outcome: 'failed',
            executionContext: {
                toolName: 'weather_forecast',
                status: 'failed',
                reasonCode: 'tool_timeout',
                durationMs: 10,
            },
        }),
        captureUsage: (generationResult) => ({
            model: generationResult.model ?? 'gpt-5-mini',
            promptTokens: generationResult.usage?.promptTokens ?? 0,
            completionTokens: generationResult.usage?.completionTokens ?? 0,
            totalTokens: generationResult.usage?.totalTokens ?? 0,
            estimatedCost: {
                inputCostUsd: 0,
                outputCostUsd: 0,
                totalCostUsd: 0,
            },
        }),
    });

    assert.equal(result.outcome, 'generated');
    const toolStep = result.workflowLineage.steps.find(
        (step) => step.stepKind === 'tool'
    );
    assert.ok(toolStep);
    assert.equal(toolStep.outcome.status, 'failed');
    assert.equal(toolStep.reasonCode, 'tool_timeout');
});

test('runBoundedReviewWorkflow still generates when a context step is blocked by the tool-call limit', async () => {
    let generationCalls = 0;
    const generationRuntime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate() {
            generationCalls += 1;
            return {
                text: 'local answer without blocked context',
                model: 'gpt-5-mini',
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                provenance: 'Inferred',
                citations: [],
            };
        },
    };

    const result = await runBoundedReviewWorkflowForTest({
        generationRuntime,
        generationRequest: {
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Answer without retrieval' }],
        },
        messagesWithHints: [
            { role: 'user', content: 'Answer without retrieval' },
        ],
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'message_reviewed',
            maxIterations: 1,
            maxDurationMs: 15000,
            executionLimits: {
                maxWorkflowSteps: 8,
                maxToolCalls: 0,
                maxPlanCycles: 1,
                maxReviewCycles: 1,
                maxDeliberationCalls: 2,
                maxTokensTotal: Number.MAX_SAFE_INTEGER,
                maxDurationMs: 15000,
            },
        },
        workflowPolicy: {
            enablePlanning: false,
            enableToolUse: true,
            enableReplanning: false,
            enableGeneration: true,
            enableAssessment: false,
            enableRevision: false,
        },
        contextStepRequests: [
            {
                integrationName: 'trustgraph',
                requested: true,
                eligible: true,
                input: {
                    queryIntent: 'Answer without retrieval',
                    scopeTuple: {
                        userId: 'user-1',
                        collectionId: 'collection-1',
                    },
                    targetIds: ['target-1'],
                },
            },
        ],
        contextStepExecutor: async () => {
            throw new Error('context executor should be blocked');
        },
        captureUsage: (generationResult) => ({
            model: generationResult.model ?? 'gpt-5-mini',
            promptTokens: generationResult.usage?.promptTokens ?? 0,
            completionTokens: generationResult.usage?.completionTokens ?? 0,
            totalTokens: generationResult.usage?.totalTokens ?? 0,
            estimatedCost: {
                inputCostUsd: 0,
                outputCostUsd: 0,
                totalCostUsd: 0,
            },
        }),
    });

    assert.equal(generationCalls, 1);
    assert.equal(result.outcome, 'generated');
    assert.equal(
        result.generationResult?.text,
        'local answer without blocked context'
    );
    assert.ok(
        result.workflowLineage.steps.some(
            (step) =>
                step.stepKind === 'tool' &&
                step.outcome.status === 'failed' &&
                step.reasonCode === 'max_tool_calls_reached'
        )
    );
});

test('runBoundedReviewWorkflow does not generate after a blocked context step consumes the workflow-step limit', async () => {
    let generationCalls = 0;
    const generationRuntime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate() {
            generationCalls += 1;
            throw new Error('generation should be blocked by the step limit');
        },
    };

    const result = await runBoundedReviewWorkflowForTest({
        generationRuntime,
        generationRequest: {
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Answer without retrieval' }],
        },
        messagesWithHints: [
            { role: 'user', content: 'Answer without retrieval' },
        ],
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'message_reviewed',
            maxIterations: 1,
            maxDurationMs: 15000,
            executionLimits: {
                maxWorkflowSteps: 1,
                maxToolCalls: 0,
                maxPlanCycles: 1,
                maxReviewCycles: 1,
                maxDeliberationCalls: 2,
                maxTokensTotal: Number.MAX_SAFE_INTEGER,
                maxDurationMs: 15000,
            },
        },
        workflowPolicy: {
            enablePlanning: false,
            enableToolUse: true,
            enableReplanning: false,
            enableGeneration: true,
            enableAssessment: false,
            enableRevision: false,
        },
        contextStepRequests: [
            {
                integrationName: 'trustgraph',
                requested: true,
                eligible: true,
                input: {
                    queryIntent: 'Answer without retrieval',
                    scopeTuple: {
                        userId: 'user-1',
                        collectionId: 'collection-1',
                    },
                    targetIds: ['target-1'],
                },
            },
        ],
        contextStepExecutor: async () => {
            throw new Error('context executor should be blocked');
        },
        captureUsage: (generationResult) => ({
            model: generationResult.model ?? 'gpt-5-mini',
            promptTokens: generationResult.usage?.promptTokens ?? 0,
            completionTokens: generationResult.usage?.completionTokens ?? 0,
            totalTokens: generationResult.usage?.totalTokens ?? 0,
            estimatedCost: {
                inputCostUsd: 0,
                outputCostUsd: 0,
                totalCostUsd: 0,
            },
        }),
    });

    assert.equal(generationCalls, 0);
    assert.equal(result.outcome, 'no_generation');
    assert.equal(result.workflowLineage.steps.length, 1);
    assert.equal(
        result.workflowLineage.steps[0]?.reasonCode,
        'max_tool_calls_reached'
    );
    assert.equal(result.workflowLineage.stepCount, 1);
    assert.ok(result.workflowLineage.limitStop);
    assert.equal(
        result.workflowLineage.limitStop.exhaustedLimitKey,
        'maxWorkflowSteps'
    );
});

test('runBoundedReviewWorkflow stops before generation when injected context step requires clarification', async () => {
    let generationCalls = 0;
    const generationRuntime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate() {
            generationCalls += 1;
            return {
                text: 'draft',
                model: 'gpt-5-mini',
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                provenance: 'Inferred',
                citations: [],
            };
        },
    };

    const result = await runBoundedReviewWorkflowForTest({
        generationRuntime,
        generationRequest: {
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Need weather summary' }],
        },
        messagesWithHints: [{ role: 'user', content: 'Need weather summary' }],
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'message_reviewed',
            maxIterations: 0,
            maxDurationMs: 15000,
        },
        workflowPolicy: {
            enablePlanning: false,
            enableToolUse: true,
            enableReplanning: false,
            enableGeneration: true,
            enableAssessment: true,
            enableRevision: true,
        },
        contextStepRequests: [
            {
                integrationName: 'weather_forecast',
                requested: true,
                eligible: true,
                input: { location: 'Springfield' },
            },
        ],
        contextStepExecutor: async () => ({
            outcome: 'needs_clarification',
            executionContext: {
                toolName: 'weather_forecast',
                status: 'executed',
                clarification: {
                    reasonCode: 'ambiguous_location',
                    question: 'Which Springfield did you mean?',
                    options: [
                        { id: '1', label: 'Springfield, Illinois' },
                        { id: '2', label: 'Springfield, Missouri' },
                    ],
                },
            },
            clarification: {
                reasonCode: 'ambiguous_location',
                question: 'Which Springfield did you mean?',
                options: [
                    { id: '1', label: 'Springfield, Illinois' },
                    { id: '2', label: 'Springfield, Missouri' },
                ],
            },
        }),
        captureUsage: () => ({
            model: 'gpt-5-mini',
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            estimatedCost: {
                inputCostUsd: 0,
                outputCostUsd: 0,
                totalCostUsd: 0,
            },
        }),
    });

    assert.equal(result.outcome, 'no_generation');
    assert.equal(generationCalls, 0);
    const toolStep = result.workflowLineage.steps.find(
        (step) => step.stepKind === 'tool'
    );
    assert.ok(toolStep);
    assert.equal(toolStep.outcome.status, 'executed');
    assert.equal(
        toolStep.outcome.signals?.clarificationReasonCode,
        'ambiguous_location'
    );
});

test('runBoundedReviewWorkflow returns terminal planner action outcome without generation', async () => {
    let generationCalls = 0;
    const generationRuntime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate() {
            generationCalls += 1;
            return {
                text: 'should not run',
                model: 'gpt-5-mini',
                provenance: 'Inferred',
                citations: [],
            };
        },
    };

    const result = await runBoundedReviewWorkflowForTest({
        generationRuntime,
        generationRequest: {
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Send a reaction' }],
        },
        messagesWithHints: [{ role: 'user', content: 'Send a reaction' }],
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'generate-only',
            maxIterations: 0,
            maxDurationMs: 15000,
        },
        workflowPolicy: {
            enablePlanning: true,
            enableToolUse: false,
            enableReplanning: false,
            enableGeneration: true,
            enableAssessment: false,
            enableRevision: false,
        },
        plannerStepRequest: {
            workflowId: 'wf_test',
            workflowName: 'generate-only',
            attempt: 1,
            request: {
                surface: 'web',
                trigger: { kind: 'submit' },
                latestUserInput: 'Send a reaction',
                conversation: [{ role: 'user', content: 'Send a reaction' }],
            },
            invocationContext: {
                owner: 'workflow',
                workflowName: 'generate-only',
                stepKind: 'plan',
                purpose: 'chat_orchestrator_action_selection',
            },
            capabilityProfiles: [],
        },
        plannerStepExecutor: async () => ({
            plan: {
                action: 'react',
                modality: 'text',
                reaction: '🔥',
                safetyTier: 'Low',
                reasoning: 'Reaction is sufficient.',
                generation: { reasoningEffort: 'low', verbosity: 'low' },
            },
            execution: {
                status: 'executed',
                purpose: 'chat_orchestrator_action_selection',
                contractType: 'structured',
                durationMs: 1,
            },
            ingestion: {
                outputApplyOutcome: 'accepted',
                fallbackTier: 'none',
                correctionCodes: [],
                outOfContractFields: [],
                authorityFieldAttempts: [],
            },
            diagnostics: {
                rawToolIntentPresent: false,
                normalizedToolIntentPresent: false,
                toolIntentRejected: false,
                toolIntentRejectionReasons: [],
            },
        }),
        planContinuationBuilder: ({ plannerStepResult }) => ({
            continuation: 'terminal_action',
            terminalAction:
                plannerStepResult.plan.action === 'react'
                    ? { responseAction: 'react', reaction: '🔥' }
                    : { responseAction: 'ignore' },
            plannerSummary: {
                executionPlan: plannerStepResult.plan,
                generationForExecution: plannerStepResult.plan.generation,
                selectedResponseProfile: {
                    id: 'default',
                    provider: 'openai',
                    providerModel: 'gpt-5-mini',
                    capabilities: {
                        supportsReasoningEffort: true,
                        supportsVerbosity: true,
                        canUseSearch: false,
                        canGenerateImage: false,
                        canUseVision: false,
                        canUseAudio: false,
                        canUseStreaming: true,
                    },
                },
                originalSelectedProfileId: 'default',
                effectiveSelectedProfileId: 'default',
                toolRequestContext: {
                    toolName: 'web_search',
                    requested: false,
                    eligible: false,
                    reasonCode: 'tool_not_requested',
                },
                plannerDiagnostics: plannerStepResult.diagnostics,
                plannerApplyOutcome: 'applied',
                plannerMattered: true,
                plannerMatteredControlIds: [],
                fallbackReasons: [],
                fallbackRollupSelectionSource: 'default',
                modality: plannerStepResult.plan.modality,
                safetyTier: plannerStepResult.plan.safetyTier,
                searchRequested: false,
            },
        }),
        captureUsage: () => ({
            model: 'gpt-5-mini',
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            estimatedCost: {
                inputCostUsd: 0,
                outputCostUsd: 0,
                totalCostUsd: 0,
            },
        }),
    });

    assert.equal(generationCalls, 0);
    assert.equal(result.outcome, 'terminal_action');
    if (result.outcome !== 'terminal_action') {
        throw new Error('Expected terminal action outcome');
    }
    assert.equal(result.terminalAction.responseAction, 'react');
    assert.equal(result.workflowLineage.terminationReason, 'goal_satisfied');
});

test('runBoundedReviewWorkflow uses web_search hints for one OpenAI native follow-up when enabled', async () => {
    let observedSearch: unknown;
    let observedMessages: RuntimeMessage[] = [];
    const generationRuntime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate(input) {
            observedSearch = input.search;
            observedMessages = input.messages;
            return {
                text: 'draft',
                model: 'gpt-5-mini',
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15,
                },
                provenance: 'Retrieved',
                citations: [{ title: 'source', url: 'https://example.com' }],
            };
        },
    };

    const result = await runBoundedReviewWorkflowForTest({
        generationRuntime,
        generationRequest: {
            model: 'gpt-5-mini',
            provider: 'openai',
            messages: [{ role: 'user', content: 'Need context' }],
        },
        messagesWithHints: [{ role: 'user', content: 'Need context' }],
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'message_with_review_loop',
            maxIterations: 1,
            maxDurationMs: 15000,
            executionLimits: {
                maxWorkflowSteps: 4,
                maxToolCalls: 4,
                maxDeliberationCalls: 2,
                maxTokensTotal: 1000,
                maxDurationMs: 15000,
            },
        },
        workflowPolicy: {
            enablePlanning: false,
            enableToolUse: true,
            enableReplanning: false,
            enableGeneration: true,
            enableAssessment: false,
            enableRevision: false,
        },
        openAiNativeSearchFromHintsEnabled: true,
        contextStepRequests: [
            {
                integrationName: 'web_search',
                requested: true,
                eligible: true,
            },
        ],
        contextStepExecutorRegistry: {
            web_search: async () => ({
                outcome: 'executed',
                executionContext: {
                    toolName: 'web_search',
                    status: 'executed',
                },
                integrationContext: {
                    kind: 'web_search',
                    version: 'v1',
                    payload: {
                        searchHints: [
                            {
                                query: 'latest policy change',
                                intent: 'current_facts',
                                priority: 'high',
                            },
                        ],
                    },
                },
            }),
        },
        captureUsage: (generationResult) => ({
            model: generationResult.model ?? 'gpt-5-mini',
            promptTokens: generationResult.usage?.promptTokens ?? 0,
            completionTokens: generationResult.usage?.completionTokens ?? 0,
            totalTokens: generationResult.usage?.totalTokens ?? 0,
            estimatedCost: {
                inputCostUsd: 0,
                outputCostUsd: 0,
                totalCostUsd: 0,
            },
        }),
    });

    assert.equal(result.outcome, 'generated');
    assert.deepEqual(observedSearch, {
        query: 'latest policy change',
        intent: 'current_facts',
        contextSize: 'low',
    });
    assert.match(
        observedMessages.find((message) =>
            message.content.includes('FOOTNOTE CONTEXT MANIFEST')
        )?.content ?? '',
        /web_search: status=requested/iu
    );
});
