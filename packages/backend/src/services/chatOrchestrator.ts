/**
 * @description: Orchestrates universal chat requests across web and Discord surfaces.
 * @footnote-scope: core
 * @footnote-module: ChatOrchestrator
 * @footnote-risk: high - Routing mistakes here can send the wrong action or break chat across surfaces.
 * @footnote-ethics: high - This is the canonical action-selection boundary for user-facing chat behavior.
 */
import type {
    ChatAssistantIdentity,
    PostChatRequest,
    PostChatResponse,
} from '@footnote/contracts/web';
import type { ModelProfile } from '@footnote/contracts';
import type { SafetyTier } from '@footnote/contracts/policy';
import { renderConversationPromptLayers } from './prompts/conversationPromptLayers.js';
import {
    createChatService,
    type CreateChatServiceOptions,
} from './chatService.js';
import {
    createChatPlanner,
    type ChatPlan,
    type ChatPlannerInvocationContext,
    ChatPlannerStructuredOutputError,
} from './chatPlanner.js';
import { createOpenAiChatPlannerStructuredExecutor } from './chatPlannerStructuredOpenAi.js';
import { chatPlannerDecisionStructuredOutput } from './chatPlannerDecisionContract.js';
import { removePlannerTransportNulls } from './plannerSchemaAdapter.js';
import {
    resolveActiveProfileOverlayPrompt,
    resolveChatPersonaProfile,
    resolvePersonaExpression,
    resolvePersonaPresentationGuidance,
} from './chatProfileOverlay.js';
import { createModelProfileResolver } from './modelProfileResolver.js';
import { listCapabilityProfileOptionsForStep } from './modelCapabilityPolicy.js';
import {
    createPlannerFallbackTelemetryRollup,
    type PlannerFallbackReason,
    type PlannerSelectionSource,
} from './plannerFallbackTelemetryRollup.js';
import { resolveExecutionContract } from './executionContractResolver.js';
import { capGenerationRequestToProfileMax } from './workflowEngine/tokenBudget.js';
import { resolveWorkflowModeDecision } from './workflowProfileRegistry.js';
import { buildSteerabilityControls } from './steerabilityControls.js';
import type { WeatherForecastTool } from './contextIntegrations/weather/index.js';
import type { InternalImageDescriptionTaskService } from './internalText.js';
import { resolveWeatherClarificationContinuation } from './tools/weatherClarificationContinuation.js';
import { createWeatherForecastContextStepExecutor } from './contextIntegrations/weather/index.js';
import { createFileScanningContextStepExecutor } from './contextIntegrations/fileScanning/index.js';
import { createReverseImageSearchContextStepExecutor } from './contextIntegrations/reverseImageSearch/index.js';
import { createSerpApiReverseImageSearchProvider } from './contextIntegrations/reverseImageSearch/index.js';
import { createWebSearchContextStepExecutor } from './contextIntegrations/webSearch/index.js';
import { createGitHubContextStepExecutor } from './contextIntegrations/github/index.js';
import {
    buildProjectContextWiring,
    createProjectContextStepExecutor,
} from './contextIntegrations/projectContext/wiring.js';
import { createPlannerResultApplier } from './chatOrchestrator/plannerResultApplier.js';
import { resolveStepRoutingChain } from './stepRoutingChains.js';
import { executeStepRoutingChain } from './stepRoutingExecutor.js';
import type { ConversationContextEnvelope } from './conversationContextService.js';
import { toSnapshotContextEnvelope } from './conversationContextService.js';
import { runtimeConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import type { IncidentAlertRouter } from './incidentAlerts.js';
import {
    buildExecutionContractScopeTuple,
    buildCorrelationIds,
    normalizeRequest,
} from './chatOrchestrator/requestNormalization.js';
import {
    runDeterministicEvaluator,
    type EvaluatorExecutionContext,
} from './chatOrchestrator/evaluatorCoordination.js';
import { assemblePlanGenerationInput } from './chatService/planGenerationInput.js';
import { classifyPlanContinuation } from './chatService/planContinuation.js';
import {
    resolveChatParticipation,
    resolveLocalChatParticipation,
} from './chatParticipationPolicy.js';
import {
    buildControlObservabilityEnvelope,
    emitControlObservabilityEnvelope,
} from './steerabilityControlObservability.js';
import type {
    PlannerStepExecutor,
    PlannerStepResult,
    PlanContinuationBuilder,
    AppliedPlanState,
} from './plannerWorkflowSeams.js';
import {
    deriveOpenAiSafetyIdentifier,
    resolveProfileReasoningEffort,
} from './runtimeRequestControls.js';
import {
    buildChatOutputBoundaryOptions,
    type ChatOutputBoundaryOptions,
} from './chatOutputBoundary.js';

type CreateChatOrchestratorOptions = CreateChatServiceOptions & {
    weatherForecastTool?: WeatherForecastTool;
    internalImageDescriptionTaskService?: InternalImageDescriptionTaskService;
    alertRouter?: IncidentAlertRouter;
};

const plannerFallbackTelemetryRollup = createPlannerFallbackTelemetryRollup({
    logger,
});

/**
 * Entry point for chat requests from web and Discord.
 *
 * Most of the work here is deciding what kind of response we are about to
 * produce. Once that is settled, ChatService handles the actual text
 * generation.
 */
export const createChatOrchestrator = ({
    generationRuntime,
    storeTrace,
    buildResponseMetadata,
    defaultModel = runtimeConfig.modelProfiles.defaultProfileId,
    recordUsage,
    executionContractTrustGraph,
    weatherForecastTool,
    internalImageDescriptionTaskService,
    alertRouter,
}: CreateChatOrchestratorOptions) => {
    const chatOrchestratorLogger =
        typeof logger.child === 'function'
            ? logger.child({ module: 'chatOrchestrator' })
            : logger;
    const catalogProfiles = runtimeConfig.modelProfiles.catalog;
    const enabledProfiles = catalogProfiles.filter(
        (profile) => profile.enabled
    );
    const searchCapableProfiles = enabledProfiles.filter(
        (profile) => profile.capabilities.canUseSearch
    );
    const enabledProfilesById = new Map(
        enabledProfiles.map((profile) => [profile.id, profile])
    );

    // Resolver remains authoritative for all profile-id/tier/raw selector
    // resolution and fail-open behavior.
    const modelProfileResolver = createModelProfileResolver({
        catalog: catalogProfiles,
        defaultProfileId: runtimeConfig.modelProfiles.defaultProfileId,
        legacyDefaultModel: runtimeConfig.openai.defaultModel,
        warn: chatOrchestratorLogger,
    });
    const plannerProfile = modelProfileResolver.resolve(
        runtimeConfig.modelProfiles.plannerProfileId
    );
    const allProfilesById = new Map(
        catalogProfiles.map((profile) => [profile.id, profile])
    );
    // Startup fallback profile for end-user response generation.
    // Planner may request a capability profile that resolves to one catalog profile.
    const defaultResponseProfile = modelProfileResolver.resolve(defaultModel);

    const plannerCapabilityOptions =
        listCapabilityProfileOptionsForStep('generation');
    // TODO(phase-5-provider-tool-registry): Add deterministic fallback ranking
    // metadata for planner/executor handoff (for example, preferred
    // search-capable backup profile ids by policy).

    // ChatService handles final message generation and trace/cost wiring.
    const chatService = createChatService({
        generationRuntime,
        storeTrace,
        buildResponseMetadata,
        defaultModel: defaultResponseProfile.providerModel,
        defaultProvider: defaultResponseProfile.provider,
        defaultCapabilities: defaultResponseProfile.capabilities,
        recordUsage,
        executionContractTrustGraph,
    });
    // Created once at orchestrator scope so the GitHub context executor keeps
    // its bounded in-process cache across requests instead of re-warming per
    // request. Reused by every request's step registry.
    const githubContextStepExecutor = createGitHubContextStepExecutor({
        ...runtimeConfig.chatWorkflow.contextIntegrations.github,
        onWarn: (message, meta) => chatOrchestratorLogger.warn(message, meta),
    });
    // Project-context integration is assembled once at orchestrator scope so its
    // embedded index and last-known-good fallback survive across requests.
    const projectContextWiring = buildProjectContextWiring({
        config: runtimeConfig.chatWorkflow.contextIntegrations.projectDocs,
        projectRoot: runtimeConfig.runtime.projectRoot,
        openaiApiKey: runtimeConfig.openai.apiKey,
        openrouterApiKey: runtimeConfig.openrouter.apiKey,
    });
    const projectContextStepExecutor = projectContextWiring
        ? createProjectContextStepExecutor(projectContextWiring)
        : undefined;
    const createRuntimeChatPlanner = (
        getActivePlannerProfile: () => ModelProfile,
        safetyIdentifier: string | undefined
    ) => {
        const directOpenAiStructuredExecutor =
            runtimeConfig.openai.plannerStructuredOutputEnabled &&
            runtimeConfig.openai.apiKey &&
            generationRuntime.kind !== 'test-runtime'
                ? createOpenAiChatPlannerStructuredExecutor({
                      apiKey: runtimeConfig.openai.apiKey,
                  })
                : undefined;
        const useRuntimeStructuredExecutor =
            runtimeConfig.openai.plannerStructuredOutputEnabled &&
            (getActivePlannerProfile().provider === 'openrouter' ||
                getActivePlannerProfile().provider === 'openai') &&
            generationRuntime.kind !== 'test-runtime';

        return createChatPlanner({
            availableCapabilityProfiles: plannerCapabilityOptions,
            availableTrustGraphTargets:
                executionContractTrustGraph?.targets ?? [],
            // DeepSeek's reasoning channel can consume the entire bounded
            // text-JSON planner allowance before emitting its small decision
            // object. The planner is a routing hint, not a deliberative step;
            // keep it non-reasoning on OpenRouter while retaining the existing
            // low-effort default for other planner providers.
            plannerReasoningEffort:
                plannerProfile.provider === 'openrouter' ? 'none' : 'low',
            ...((directOpenAiStructuredExecutor !== undefined ||
                useRuntimeStructuredExecutor) && {
                executePlannerStructured: async (request) => {
                    const activePlannerProfile = getActivePlannerProfile();
                    const cappedRequest = capGenerationRequestToProfileMax({
                        request,
                        profile: activePlannerProfile,
                    });
                    const reasoningEffort = resolveProfileReasoningEffort(
                        activePlannerProfile,
                        request.reasoningEffort,
                        chatOrchestratorLogger
                    );
                    if (
                        activePlannerProfile.provider === 'openai' &&
                        directOpenAiStructuredExecutor !== undefined
                    ) {
                        return directOpenAiStructuredExecutor({
                            ...cappedRequest,
                            model: activePlannerProfile.providerModel,
                            reasoningEffort,
                            ...(safetyIdentifier !== undefined && {
                                safetyIdentifier,
                            }),
                        });
                    }

                    try {
                        const result = await generationRuntime.generate({
                            ...cappedRequest,
                            model: activePlannerProfile.providerModel,
                            provider: activePlannerProfile.provider,
                            capabilities: activePlannerProfile.capabilities,
                            providerRouting:
                                activePlannerProfile.providerRouting,
                            reasoningEffort,
                            structuredOutput:
                                chatPlannerDecisionStructuredOutput,
                            ...(safetyIdentifier !== undefined && {
                                safetyIdentifier,
                            }),
                        });
                        if (result.completion?.status === 'incomplete') {
                            throw new ChatPlannerStructuredOutputError(
                                'incomplete',
                                'Structured planner output was incomplete.'
                            );
                        }
                        if (result.completion?.status === 'failed') {
                            throw new ChatPlannerStructuredOutputError(
                                'runtime_failure',
                                'Structured planner runtime failed.'
                            );
                        }
                        if (
                            result.finishReason === 'refusal' ||
                            result.finishReason === 'content-filter'
                        ) {
                            throw new ChatPlannerStructuredOutputError(
                                'refusal',
                                'Structured planner output was refused.'
                            );
                        }
                        if (result.text.trim().length === 0) {
                            throw new ChatPlannerStructuredOutputError(
                                'no_output',
                                'Structured planner returned no output.'
                            );
                        }
                        let decision: unknown;
                        try {
                            decision = JSON.parse(result.text) as unknown;
                        } catch (error) {
                            throw new ChatPlannerStructuredOutputError(
                                'parse_failure',
                                'Structured planner output was not valid JSON.',
                                { cause: error }
                            );
                        }
                        return {
                            decision: removePlannerTransportNulls(decision),
                            provider: activePlannerProfile.provider,
                            model: result.model,
                            usage: result.usage,
                            upstreamAttribution: result.upstreamAttribution,
                            rawArguments: result.text.slice(0, 2_000),
                        };
                    } catch (error) {
                        if (error instanceof ChatPlannerStructuredOutputError) {
                            throw error;
                        }
                        const message =
                            error instanceof Error
                                ? error.message
                                : String(error);
                        const outcome =
                            /unsupported|not support|require_parameters/i.test(
                                message
                            )
                                ? 'unsupported_route'
                                : /schema|validated output|400/i.test(message)
                                  ? 'schema_rejected'
                                  : 'runtime_failure';
                        throw new ChatPlannerStructuredOutputError(
                            outcome,
                            'Structured planner runtime failed.',
                            { cause: error }
                        );
                    }
                },
            }),
            executePlanner: async ({
                messages,
                model: _model,
                maxOutputTokens,
                reasoningEffort,
                verbosity,
            }) => {
                const activePlannerProfile = getActivePlannerProfile();
                // Planner calls go through the same runtime seam so model usage
                // and behavior stay aligned with normal generation calls.
                const plannerResult = await generationRuntime.generate({
                    ...capGenerationRequestToProfileMax({
                        request: {
                            messages,
                            maxOutputTokens,
                            reasoningEffort,
                            verbosity,
                        },
                        profile: activePlannerProfile,
                    }),
                    model: activePlannerProfile.providerModel,
                    provider: activePlannerProfile.provider,
                    capabilities: activePlannerProfile.capabilities,
                    providerRouting: activePlannerProfile.providerRouting,
                    reasoningEffort: resolveProfileReasoningEffort(
                        activePlannerProfile,
                        reasoningEffort,
                        chatOrchestratorLogger
                    ),
                    ...(safetyIdentifier !== undefined && {
                        safetyIdentifier,
                    }),
                });

                return {
                    text: plannerResult.text,
                    provider: activePlannerProfile.provider,
                    model: plannerResult.model,
                    usage: plannerResult.usage,
                    upstreamAttribution: plannerResult.upstreamAttribution,
                };
            },
            allowTextJsonCompatibilityFallback:
                runtimeConfig.openai.plannerAllowTextJsonCompatibilityFallback,
            defaultModel: plannerProfile.providerModel,
            recordUsage,
            ...(safetyIdentifier !== undefined && { safetyIdentifier }),
        });
    };

    /**
     * Runs one chat request end-to-end.
     *
     * The order is easy to miss: normalize the request, run the evaluator,
     * ask the planner, narrow the profile and tool choices, then generate if
     * we still owe the caller a message.
     */
    const runChat = async (
        request: PostChatRequest
    ): Promise<PostChatResponse> => {
        let activePlannerProfile = plannerProfile;
        const safetyIdentifier = deriveOpenAiSafetyIdentifier(
            {
                secret: runtimeConfig.openai.safetyIdentifierSecret,
                surface: request.surface,
                userId: request.surfaceContext?.userId,
            },
            chatOrchestratorLogger
        );
        const chatPlanner = createRuntimeChatPlanner(
            () => activePlannerProfile,
            safetyIdentifier
        );
        const isWeatherLikeRequest = (input: string): boolean => {
            const normalized = input.trim().toLowerCase();
            if (normalized.length === 0) {
                return false;
            }
            return (
                /\b(weather|forecast|temperature|temp|rain|snow|wind)\b/.test(
                    normalized
                ) && /\b(in|at|for|near)\b/.test(normalized)
            );
        };
        // Total wall-clock budget for this request from planner entry to
        // final response payload. This is exposed as telemetry only.
        const orchestrationStartedAt = Date.now();
        const personaProfile = resolveChatPersonaProfile(
            request,
            chatOrchestratorLogger
        );
        const personaExpression = resolvePersonaExpression(
            request,
            personaProfile
        );
        const fallbackAssistantIdentity: ChatAssistantIdentity = {
            displayName: personaProfile.displayName,
            mentionAliases: [...personaProfile.mentionAliases],
        };
        const outputBoundaryOptions: ChatOutputBoundaryOptions =
            buildChatOutputBoundaryOptions(request, fallbackAssistantIdentity);
        let normalizedConversation: PostChatRequest['conversation'];
        let normalizedRequest: PostChatRequest;
        let contextEnvelope: ConversationContextEnvelope;
        try {
            const normalized = normalizeRequest(
                request,
                chatOrchestratorLogger,
                outputBoundaryOptions
            );
            normalizedConversation = normalized.normalizedConversation;
            normalizedRequest = normalized.normalizedRequest;
            contextEnvelope = normalized.contextEnvelope;
        } catch (error) {
            chatOrchestratorLogger.error('chat.context.assembly_failed', {
                event: 'chat.context.assembly_failed',
                surface: request.surface,
                reasonCode:
                    error && typeof error === 'object' && 'reasonCode' in error
                        ? (error as { reasonCode?: string }).reasonCode
                        : 'context_assembly_error',
                reason: error instanceof Error ? error.message : String(error),
                correlation: buildCorrelationIds(request, null),
            });
            throw error;
        }
        const botProfileDisplayName = personaProfile.displayName;
        const addressing = normalizedRequest.trigger.addressing;
        // Backend policy owns Discord participation after normalization and
        // before evaluation or planning; an excluded persona returns ignore.
        if (
            normalizedRequest.surface === 'discord' &&
            normalizedRequest.botPersonaId !== undefined &&
            addressing !== undefined &&
            (addressing.participants.length > 0 ||
                addressing.resolution === 'degraded')
        ) {
            const participationDecision = resolveChatParticipation(addressing);
            const localParticipation = resolveLocalChatParticipation({
                decision: participationDecision,
                personaId: normalizedRequest.botPersonaId,
            });
            chatOrchestratorLogger.info('chat.participation.arbitration', {
                event: 'chat.participation.arbitration',
                surface: normalizedRequest.surface,
                triggerKind: normalizedRequest.trigger.kind,
                resolution: addressing.resolution,
                selectedPersonaIds: participationDecision.selectedPersonaIds,
                excludedPersonaIds: participationDecision.excluded.map(
                    (entry) => entry.personaId
                ),
                localPersonaId: normalizedRequest.botPersonaId,
                localSelected: localParticipation.selected,
                localReasonCode: localParticipation.reasonCode,
            });
            if (!localParticipation.selected) {
                return {
                    action: 'ignore',
                    metadata: null,
                };
            }
        }
        const clarificationContinuation =
            resolveWeatherClarificationContinuation(normalizedRequest);
        let evaluatorExecutionContext: EvaluatorExecutionContext | undefined;
        const notifyBreakerEvent = (input: {
            responseId: string | null;
            responseAction: 'message' | 'ignore' | 'react' | 'image';
            responseModality: ChatPlan['modality'];
        }): void => {
            const breakerDecision =
                evaluatorExecutionContext?.outcome?.safetyDecision;
            if (
                evaluatorExecutionContext?.status !== 'executed' ||
                !breakerDecision ||
                breakerDecision.action === 'allow'
            ) {
                return;
            }

            const correlation = buildCorrelationIds(
                normalizedRequest,
                input.responseId
            );
            const authorityLevel =
                evaluatorExecutionContext.outcome?.authorityLevel ??
                (evaluatorExecutionContext.outcome?.mode === 'enforced'
                    ? 'enforce'
                    : 'influence');
            const enforcement: 'observe_only' | 'enforced' =
                authorityLevel === 'enforce' ? 'enforced' : 'observe_only';
            chatOrchestratorLogger.info(
                'chat.orchestration.breaker_action_applied',
                {
                    event: 'chat.orchestration.breaker_action_applied',
                    authorityLevel,
                    mode: evaluatorExecutionContext.outcome?.mode,
                    action: breakerDecision.action,
                    ruleId: breakerDecision.ruleId,
                    reasonCode: breakerDecision.reasonCode,
                    reason: breakerDecision.reason,
                    safetyTier: breakerDecision.safetyTier,
                    enforcement,
                    responseAction: input.responseAction,
                    responseModality: input.responseModality,
                    correlation,
                }
            );
            if (alertRouter) {
                void alertRouter.notify({
                    type: 'breaker',
                    action: 'chat.orchestration.breaker_action_applied',
                    surface: normalizedRequest.surface,
                    authorityLevel: authorityLevel ?? 'observe',
                    enforcement,
                    breakerAction: breakerDecision.action,
                    ruleId: breakerDecision.ruleId,
                    reasonCode: breakerDecision.reasonCode,
                    reason: breakerDecision.reason,
                    safetyTier: breakerDecision.safetyTier,
                    responseAction: input.responseAction,
                    responseModality: input.responseModality,
                    responseId: input.responseId,
                    correlation,
                });
            }
        };
        const evaluatorStartedAt = Date.now();
        const evaluatorResult = runDeterministicEvaluator(
            {
                normalizedConversation,
                normalizedRequest,
                startedAtMs: evaluatorStartedAt,
            },
            chatOrchestratorLogger
        );
        evaluatorExecutionContext = evaluatorResult.evaluatorExecutionContext;
        const evaluatorSafetyTierHint = evaluatorResult.evaluatorSafetyTierHint;

        // Planner is a bounded, execution-relevant helper. It can suggest
        // action-selection details, but it is not policy authority, contract
        // authority, runtime ownership, or a second orchestrator.
        const plannerInvocationContext: ChatPlannerInvocationContext = {
            owner: 'workflow',
            workflowName: 'chat_orchestration',
            stepKind: 'plan',
            purpose: 'chat_orchestrator_action_selection',
        };
        const toPlannerStepResult = (
            plannerResult: Awaited<ReturnType<typeof chatPlanner.planChat>>
        ): PlannerStepResult => ({
            plan: plannerResult.plan,
            execution: {
                ...plannerResult.execution,
                profileId: activePlannerProfile.id,
                provider:
                    plannerResult.execution.upstreamAttribution
                        ?.inferenceProvider ?? activePlannerProfile.provider,
                model:
                    plannerResult.execution.upstreamAttribution
                        ?.resolvedModel ??
                    plannerResult.execution.model ??
                    activePlannerProfile.providerModel,
            },
            ingestion: {
                outputApplyOutcome:
                    plannerResult.execution.status === 'executed'
                        ? 'accepted'
                        : 'rejected',
                fallbackTier:
                    plannerResult.execution.status === 'executed'
                        ? 'none'
                        : 'safe_default_plan',
                correctionCodes: [],
                outOfContractFields: [],
                authorityFieldAttempts: [],
            },
            diagnostics: plannerResult.diagnostics,
        });
        const plannerStepExecutor: PlannerStepExecutor = async (input) => {
            const modeResolution = resolveWorkflowModeDecision({
                modeId:
                    input.request.modeId ?? runtimeConfig.chatWorkflow.modeId,
            });
            const plannerCandidates = resolveStepRoutingChain(
                {
                    modeId: modeResolution.modeDecision.modeId,
                    step: 'planner',
                    request: input.request,
                    correlationId: input.request.trigger.messageId ?? 'none',
                    stepOverrideProfileId: input.request.plannerProfileId,
                },
                enabledProfilesById,
                allProfilesById
            );
            const chainResult = await executeStepRoutingChain({
                step: 'planner',
                candidates: plannerCandidates,
                enabledProfilesById,
                requiresSearch: false,
                runWithProfile: async (profile) => {
                    activePlannerProfile = profile;
                    const plannerResult = await chatPlanner.planChat(
                        input.request,
                        input.invocationContext
                    );
                    const transportOutcome =
                        plannerResult.execution.structuredOutputOutcome;
                    if (
                        profile.provider === 'openrouter' &&
                        (transportOutcome === 'unsupported_route' ||
                            transportOutcome === 'schema_rejected' ||
                            transportOutcome === 'incomplete' ||
                            transportOutcome === 'no_output' ||
                            transportOutcome === 'runtime_failure')
                    ) {
                        throw new ChatPlannerStructuredOutputError(
                            transportOutcome,
                            `OpenRouter planner transport failed with outcome ${transportOutcome}.`
                        );
                    }
                    return plannerResult;
                },
            });

            if (chainResult.status === 'executed') {
                activePlannerProfile = chainResult.selected.profile;
                const base = toPlannerStepResult(chainResult.value);
                return {
                    ...base,
                    execution: {
                        ...base.execution,
                        routingChainAttempts: chainResult.attempts,
                    },
                };
            }

            activePlannerProfile = plannerProfile;
            const fallback = toPlannerStepResult(
                await chatPlanner.planChat(
                    input.request,
                    input.invocationContext
                )
            );
            return {
                ...fallback,
                execution: {
                    ...fallback.execution,
                    routingChainAttempts: chainResult.attempts,
                },
            };
        };
        const fallbackReasons: PlannerFallbackReason[] = [];
        const fallbackRollupSelectionSourceRef: {
            value: PlannerSelectionSource;
        } = { value: 'default' };
        const emitFallbackRollup = (
            selectionSource: PlannerSelectionSource
        ): void => {
            for (const reason of fallbackReasons) {
                plannerFallbackTelemetryRollup.record({
                    reason,
                    surface: normalizedRequest.surface,
                    selectionSource,
                });
            }
        };
        // Contract-governed routing boundary:
        // 1) resolve initial high-level workflow mode (fixed for this run in v1)
        // 2) derive Execution Contract preset from mode
        // 3) execute orchestration within that contract
        const workflowModeResolution = resolveWorkflowModeDecision({
            modeId:
                normalizedRequest.modeId ?? runtimeConfig.chatWorkflow.modeId,
        });
        activePlannerProfile = plannerProfile;
        // Pick the run mode first, then derive the contract from it. That keeps
        // later branches from inventing their own policy rules.
        // TODO(workflow-mode-escalation): Add optional runtime mode transitions
        // (for example express -> grounded) when later retrieval/sufficiency
        // signals justify escalation. This is future behavior only, and should
        // stay attached to centralized mode routing policy.
        const resolvedExecutionContract = resolveExecutionContract({
            presetId:
                workflowModeResolution.modeDecision.behavior
                    .executionContractPresetId,
        }).policyContract;
        const plannerResultApplier = createPlannerResultApplier({
            enabledProfiles,
            searchCapableProfiles,
            enabledProfilesById,
            defaultResponseProfile,
            weatherForecastTool,
            logger: chatOrchestratorLogger,
        });
        const promptLayers = renderConversationPromptLayers(
            normalizedRequest.surface === 'discord'
                ? 'discord-chat'
                : 'web-chat',
            {
                botProfileDisplayName,
            }
        );
        const backendOwnedProfileOverlay =
            normalizedRequest.surface === 'discord'
                ? resolveActiveProfileOverlayPrompt(
                      normalizedRequest,
                      chatOrchestratorLogger
                  )
                : null;
        // Discord can inject backend-owned runtime overlay text.
        // Web keeps default prompt persona layers.
        const personaPrompt = `${backendOwnedProfileOverlay ?? promptLayers.personaPrompt}\n\n${personaExpression.guidance}`;
        const weatherContextStepExecutor =
            createWeatherForecastContextStepExecutor({
                weatherForecastTool,
                onWarn: (message, meta) => {
                    chatOrchestratorLogger.warn(message, meta);
                },
            });
        const fileScanningContextStepExecutor =
            createFileScanningContextStepExecutor({
                imageDescriptionTaskService:
                    internalImageDescriptionTaskService,
                logger: chatOrchestratorLogger,
            });
        const reverseImageSearchProviderMode =
            runtimeConfig.chatWorkflow.contextIntegrations.reverseImageSearch
                .provider;
        const reverseImageSearchSerpApiKey =
            runtimeConfig.chatWorkflow.contextIntegrations.reverseImageSearch.serpApiKey?.trim();
        const reverseImageSearchProvider =
            reverseImageSearchProviderMode === 'serpapi' &&
            reverseImageSearchSerpApiKey
                ? createSerpApiReverseImageSearchProvider({
                      apiKey: reverseImageSearchSerpApiKey,
                      requestTimeoutMs:
                          runtimeConfig.chatWorkflow.contextIntegrations
                              .reverseImageSearch.providerTimeoutMs,
                      logger: chatOrchestratorLogger,
                  })
                : null;
        if (
            reverseImageSearchProviderMode === 'serpapi' &&
            !reverseImageSearchSerpApiKey
        ) {
            chatOrchestratorLogger.warn(
                'reverse_image_search provider is set to serpapi, but CHAT_CONTEXT_REVERSE_IMAGE_SEARCH_SERPAPI_API_KEY is missing; integration will fail open as unavailable.'
            );
        }
        const webSearchConfig =
            runtimeConfig.chatWorkflow.contextIntegrations.webSearch;
        if (
            webSearchConfig.providerPriority.includes('serpapi') &&
            !webSearchConfig.serpApiKey
        ) {
            chatOrchestratorLogger.warn(
                'web_search provider priority includes serpapi, but CHAT_CONTEXT_WEB_SEARCH_SERPAPI_API_KEY is missing; serpapi will fail open as unavailable.'
            );
        }
        const contextStepExecutorRegistry = {
            weather_forecast: weatherContextStepExecutor,
            web_search: createWebSearchContextStepExecutor({
                enabled: webSearchConfig.enabled,
                providerPriority: webSearchConfig.providerPriority,
                searxngBaseUrl: webSearchConfig.searxngBaseUrl,
                braveApiKey: webSearchConfig.braveApiKey,
                serpApiKey: webSearchConfig.serpApiKey,
                serpApiEngine: webSearchConfig.serpApiEngine,
                serpApiGl: webSearchConfig.serpApiGl,
                serpApiHl: webSearchConfig.serpApiHl,
                providerTimeoutMs: webSearchConfig.providerTimeoutMs,
                maxResults: webSearchConfig.maxResults,
                onWarn: (message, meta) => {
                    chatOrchestratorLogger.warn(message, meta);
                },
            }),
            github_context: githubContextStepExecutor,
            file_scan: fileScanningContextStepExecutor,
            ...(projectContextStepExecutor !== undefined && {
                project_context: projectContextStepExecutor,
            }),
            reverse_image_search: createReverseImageSearchContextStepExecutor({
                provider: reverseImageSearchProvider,
                logger: chatOrchestratorLogger,
                maxMatchesPerImage:
                    runtimeConfig.chatWorkflow.contextIntegrations
                        .reverseImageSearch.maxMatchesPerImage,
            }),
        };
        const buildPlannerSummary = (input: {
            plannerStepResult: PlannerStepResult;
            plannerApplication: ReturnType<typeof plannerResultApplier>;
            executionPlan: ChatPlan;
        }): AppliedPlanState => ({
            executionPlan: input.executionPlan,
            ...(input.plannerApplication.surfacePolicy !== undefined && {
                surfacePolicy: input.plannerApplication.surfacePolicy,
            }),
            generationForExecution:
                input.plannerApplication.generationForExecution,
            selectedResponseProfile: {
                id: input.plannerApplication.selectedResponseProfile.id,
                provider:
                    input.plannerApplication.selectedResponseProfile.provider,
                providerModel:
                    input.plannerApplication.selectedResponseProfile
                        .providerModel,
                capabilities:
                    input.plannerApplication.selectedResponseProfile
                        .capabilities,
            },
            originalSelectedProfileId:
                input.plannerApplication.originalSelectedProfileId,
            effectiveSelectedProfileId:
                input.plannerApplication.effectiveSelectedProfileId,
            ...(input.plannerApplication.selectedCapabilityProfile !==
                undefined && {
                selectedCapabilityProfile:
                    input.plannerApplication.selectedCapabilityProfile,
            }),
            ...(input.plannerApplication.capabilityReasonCode !== undefined && {
                capabilityReasonCode:
                    input.plannerApplication.capabilityReasonCode,
            }),
            toolRequestContext: input.plannerApplication.toolRequestContext,
            ...(input.plannerApplication.toolExecutionContext !== undefined && {
                toolExecutionContext:
                    input.plannerApplication.toolExecutionContext,
            }),
            plannerDiagnostics: {
                rawToolIntentPresent:
                    input.plannerStepResult.diagnostics.rawToolIntentPresent,
                ...(input.plannerStepResult.diagnostics.rawToolIntentName !==
                    undefined && {
                    rawToolIntentName:
                        input.plannerStepResult.diagnostics.rawToolIntentName,
                }),
                normalizedToolIntentPresent:
                    input.plannerStepResult.diagnostics
                        .normalizedToolIntentPresent,
                ...(input.plannerStepResult.diagnostics
                    .normalizedToolIntentName !== undefined && {
                    normalizedToolIntentName:
                        input.plannerStepResult.diagnostics
                            .normalizedToolIntentName,
                }),
                toolIntentRejected:
                    input.plannerStepResult.diagnostics.toolIntentRejected,
                toolIntentRejectionReasons:
                    input.plannerStepResult.diagnostics
                        .toolIntentRejectionReasons,
            },
            plannerApplyOutcome: input.plannerApplication.plannerApplyOutcome,
            plannerMattered: input.plannerApplication.plannerMattered,
            plannerMatteredControlIds:
                input.plannerApplication.plannerMatteredControlIds,
            fallbackReasons: [...fallbackReasons],
            fallbackRollupSelectionSource:
                input.plannerApplication.fallbackRollupSelectionSource,
            modality: input.executionPlan.modality,
            safetyTier: input.executionPlan.safetyTier,
            searchRequested:
                input.plannerApplication.generationForExecution.search !==
                undefined,
        });
        const plannerStepRequest = {
            workflowId: 'wf_chat_orchestration',
            workflowName: 'chat_orchestration',
            attempt: 1,
            request: normalizedRequest,
            invocationContext: plannerInvocationContext,
            capabilityProfiles: plannerCapabilityOptions,
        };
        const executionContractScopeTuple =
            executionContractTrustGraph === undefined
                ? undefined
                : buildExecutionContractScopeTuple(normalizedRequest, {
                      collectionId:
                          executionContractTrustGraph.deploymentCollectionId,
                  });

        const buildTrustGraphContextStepRequest = (
            targetIds: readonly string[]
        ):
            | {
                  integrationName: 'trustgraph';
                  requested: true;
                  eligible: true;
                  input: {
                      queryIntent: string;
                      scopeTuple: NonNullable<
                          typeof executionContractScopeTuple
                      >;
                      targetIds: readonly string[];
                  };
              }
            | undefined => {
            if (
                executionContractTrustGraph === undefined ||
                executionContractScopeTuple === undefined ||
                targetIds.length === 0
            ) {
                return undefined;
            }
            return {
                integrationName: 'trustgraph',
                requested: true,
                eligible: true,
                input: {
                    queryIntent: normalizedRequest.latestUserInput,
                    scopeTuple: executionContractScopeTuple,
                    targetIds,
                },
            };
        };

        // Applies backend policy to planner output and returns the next
        // workflow action (`terminal_action` or `continue_message`).
        const planContinuationBuilder: PlanContinuationBuilder = (input) => {
            if (input.plannerStepResult.execution.status === 'failed') {
                const plannerFailureReason: PlannerFallbackReason =
                    input.plannerStepResult.execution.reasonCode ===
                    'planner_invalid_output'
                        ? 'planner_execution_failed_planner_invalid_output'
                        : input.plannerStepResult.execution.reasonCode ===
                            'planner_runtime_error'
                          ? 'planner_execution_failed_planner_runtime_error'
                          : 'planner_execution_failed_unknown';
                fallbackReasons.push(plannerFailureReason);
            }
            const plannerApplication = plannerResultApplier({
                normalizedRequest,
                plannerStepResult: input.plannerStepResult,
                clarificationContinuation,
                resolvedExecutionPolicy: resolvedExecutionContract,
            });
            fallbackReasons.push(
                ...(plannerApplication.fallbackReasons as PlannerFallbackReason[])
            );
            fallbackRollupSelectionSourceRef.value =
                plannerApplication.fallbackRollupSelectionSource as PlannerSelectionSource;
            const executionPlan: ChatPlan = {
                ...plannerApplication.plan,
                generation: plannerApplication.generationForExecution,
                profileId: plannerApplication.selectedResponseProfile.id,
                ...(plannerApplication.selectedCapabilityProfile !==
                    undefined && {
                    selectedCapabilityProfile:
                        plannerApplication.selectedCapabilityProfile,
                }),
            };
            const plannerActionOutcome = classifyPlanContinuation({
                executionPlan,
                normalizedRequest,
            });
            if (plannerActionOutcome.kind === 'terminal_action') {
                if (plannerActionOutcome.fallbackReason !== undefined) {
                    fallbackReasons.push(plannerActionOutcome.fallbackReason);
                }
                if (plannerActionOutcome.warningMessage !== undefined) {
                    chatOrchestratorLogger.warn(
                        plannerActionOutcome.warningMessage
                    );
                }
                return {
                    continuation: 'terminal_action' as const,
                    terminalAction: plannerActionOutcome.terminalAction,
                    plannerSummary: buildPlannerSummary({
                        plannerStepResult: input.plannerStepResult,
                        plannerApplication,
                        executionPlan,
                    }),
                };
            }
            const safetyTierRank: Record<SafetyTier, number> = {
                Low: 1,
                Medium: 2,
                High: 3,
            };
            const orchestrationSafetyTier =
                evaluatorSafetyTierHint &&
                safetyTierRank[evaluatorSafetyTierHint] >
                    safetyTierRank[executionPlan.safetyTier]
                    ? evaluatorSafetyTierHint
                    : executionPlan.safetyTier;
            const postPlanAssembly = assemblePlanGenerationInput({
                systemPrompt: promptLayers.systemPrompt,
                personaPrompt,
                normalizedConversation,
                contextEnvelope,
                executionPlan,
                ...(plannerApplication.surfacePolicy !== undefined && {
                    surfacePolicy: plannerApplication.surfacePolicy,
                }),
                normalizedRequest,
                orchestrationSafetyTier,
                toolIntent:
                    plannerApplication.generationForExecution.toolIntent,
                toolRequestContext: plannerApplication.toolRequestContext,
                executionContract: {
                    policyId: resolvedExecutionContract.policyId,
                    policyVersion: resolvedExecutionContract.policyVersion,
                },
            });
            const mergedMessagesWithHints =
                input.baseMessagesWithHints.length > 0
                    ? input.baseMessagesWithHints
                    : postPlanAssembly.conversationMessages;
            const configuredTrustGraphTargetIds = new Set(
                (executionContractTrustGraph?.targets ?? []).map(
                    (target) => target.id
                )
            );
            const requestedTrustGraphTargetIds =
                executionPlan.trustGraphTargetIds ?? [];
            const admittedTrustGraphTargetIds =
                requestedTrustGraphTargetIds.filter((targetId) =>
                    configuredTrustGraphTargetIds.has(targetId)
                );
            chatOrchestratorLogger.info(
                'chat.execution_contract_trustgraph.target_selection',
                {
                    event: 'chat.execution_contract_trustgraph.target_selection',
                    requestedTargetIds: requestedTrustGraphTargetIds,
                    admittedTargetIds: admittedTrustGraphTargetIds,
                    rejectedTargetIds: requestedTrustGraphTargetIds.filter(
                        (targetId) =>
                            !configuredTrustGraphTargetIds.has(targetId)
                    ),
                    notSelectedTargetIds: [
                        ...(executionContractTrustGraph?.targets ?? [])
                            .filter(
                                (target) =>
                                    !admittedTrustGraphTargetIds.includes(
                                        target.id
                                    )
                            )
                            .map((target) => target.id),
                    ],
                    selectionReason: executionPlan.reasoning.slice(0, 500),
                }
            );
            const trustGraphContextStepRequest =
                buildTrustGraphContextStepRequest(admittedTrustGraphTargetIds);
            const contextStepRequests = [
                ...(plannerApplication.contextStepRequests ?? []),
                ...(trustGraphContextStepRequest !== undefined
                    ? [trustGraphContextStepRequest]
                    : []),
            ];
            return {
                continuation: 'continue_message' as const,
                messagesWithHints: mergedMessagesWithHints,
                generationRequest: {
                    ...input.baseGenerationRequest,
                    messages: mergedMessagesWithHints,
                    model: plannerApplication.selectedResponseProfile
                        .providerModel,
                    provider:
                        plannerApplication.selectedResponseProfile.provider,
                    capabilities:
                        plannerApplication.selectedResponseProfile.capabilities,
                    ...(executionPlan.generation.reasoningEffort !==
                        undefined && {
                        reasoningEffort:
                            executionPlan.generation.reasoningEffort,
                    }),
                    verbosity: executionPlan.generation.verbosity,
                },
                plannerTemperament: executionPlan.generation.temperament,
                conversationSnapshot: postPlanAssembly.conversationSnapshot,
                contextEnvelope,
                ...(contextStepRequests.length > 0 && { contextStepRequests }),
                plannerSummary: buildPlannerSummary({
                    plannerStepResult: input.plannerStepResult,
                    plannerApplication,
                    executionPlan,
                }),
            };
        };
        const baseConversationMessages = [
            { role: 'system' as const, content: promptLayers.systemPrompt },
            { role: 'system' as const, content: personaPrompt },
            ...normalizedConversation,
        ];
        const baseConversationSnapshot = JSON.stringify({
            request: normalizedRequest,
            executionContract: {
                policyId: resolvedExecutionContract.policyId,
                policyVersion: resolvedExecutionContract.policyVersion,
            },
            contextEnvelope: toSnapshotContextEnvelope(contextEnvelope),
        });
        const response = await chatService.runChatMessagesWithOutcome({
            messages: baseConversationMessages,
            conversationSnapshot: baseConversationSnapshot,
            contextEnvelope,
            orchestrationStartedAtMs: orchestrationStartedAt,
            safetyTier: evaluatorSafetyTierHint,
            model: defaultResponseProfile.providerModel,
            provider: defaultResponseProfile.provider,
            capabilities: defaultResponseProfile.capabilities,
            ...(safetyIdentifier !== undefined && { safetyIdentifier }),
            workflowModeId: workflowModeResolution.modeDecision.modeId,
            workflowMaxReviewCycles: normalizedRequest.maxReviewCycles,
            routingRequest: {
                sessionId: normalizedRequest.sessionId,
                traceTarget: normalizedRequest.traceTarget,
                plannerProfileId: normalizedRequest.plannerProfileId,
                generateProfileId: normalizedRequest.generateProfileId,
                assessProfileId: normalizedRequest.assessProfileId,
                trigger: normalizedRequest.trigger,
            },
            plannerStepRequest,
            plannerStepExecutor,
            planContinuationBuilder,
            contextStepExecutorRegistry,
            latestUserInput: normalizedRequest.latestUserInput,
            outputBoundary: outputBoundaryOptions,
            ExecutionContract: resolvedExecutionContract,
            ...(executionContractScopeTuple !== undefined && {
                executionContractTrustGraphContext: {
                    queryIntent: normalizedRequest.latestUserInput,
                    scopeTuple: executionContractScopeTuple,
                    targetIds: [],
                },
            }),
            executionContext: {
                evaluator: evaluatorExecutionContext,
            },
            presentationPersona: {
                id: personaProfile.id,
                presentationGuidance: resolvePersonaPresentationGuidance(
                    personaProfile.id
                ),
                expressionStrength: personaExpression.strength,
                expressionSource: personaExpression.source,
                expressionGuidance: personaExpression.guidance,
            },
        });
        const plannerSummary =
            response.kind === 'message' ? response.plannerSummary : undefined;
        const plannerStepResult =
            response.kind === 'message'
                ? response.plannerStepResult
                : undefined;
        const finalToolExecutionTelemetry =
            response.kind === 'message'
                ? response.finalToolExecutionTelemetry
                : undefined;
        const executionPlan: ChatPlan = plannerSummary?.executionPlan ?? {
            action: 'message',
            modality: 'text',
            profileId: defaultResponseProfile.id,
            safetyTier: 'Low',
            reasoning: 'Fallback execution plan before planner summary.',
            trustGraphTargetIds: [],
            generation: {
                reasoningEffort: 'low',
                verbosity: 'medium',
            },
        };
        const fallbackRollupSelectionSource =
            (plannerSummary?.fallbackRollupSelectionSource as
                PlannerSelectionSource | undefined) ??
            fallbackRollupSelectionSourceRef.value;
        const weatherRouting = {
            weatherLikeRequest: isWeatherLikeRequest(
                normalizedRequest.latestUserInput
            ),
            plannerToolIntentPresent:
                plannerSummary?.plannerDiagnostics
                    .normalizedToolIntentPresent ?? false,
            plannerRawToolIntentPresent:
                plannerSummary?.plannerDiagnostics.rawToolIntentPresent ??
                false,
            plannerRawToolIntentName:
                plannerSummary?.plannerDiagnostics.rawToolIntentName,
            plannerNormalizedToolIntentName:
                plannerSummary?.plannerDiagnostics.normalizedToolIntentName,
            plannerToolIntentRejected:
                plannerSummary?.plannerDiagnostics.toolIntentRejected ?? false,
            plannerToolIntentRejectionReasons:
                plannerSummary?.plannerDiagnostics.toolIntentRejectionReasons ??
                [],
            plannerRequestedWeather:
                plannerSummary?.plannerDiagnostics.normalizedToolIntentName ===
                'weather_forecast',
            toolSelectionRequested:
                plannerSummary?.toolRequestContext.requested ?? false,
            toolSelectionEligible:
                plannerSummary?.toolRequestContext.eligible ?? false,
            toolSelectionToolName: plannerSummary?.toolRequestContext.toolName,
            toolSelectionReasonCode:
                plannerSummary?.toolRequestContext.reasonCode,
            selectedWeather:
                plannerSummary?.toolRequestContext.toolName ===
                'weather_forecast',
        };
        if (
            weatherRouting.weatherLikeRequest ||
            weatherRouting.selectedWeather
        ) {
            chatOrchestratorLogger.info('chat.weather.routing', {
                event: 'chat.weather.routing',
                stage: 'selection',
                surface: normalizedRequest.surface,
                ...weatherRouting,
            });
        }
        const weatherExecutionAttempted =
            finalToolExecutionTelemetry?.toolName === 'weather_forecast' &&
            (finalToolExecutionTelemetry.status === 'executed' ||
                finalToolExecutionTelemetry.status === 'failed');
        const weatherOutcome =
            plannerSummary?.toolRequestContext.toolName ===
                'weather_forecast' &&
            plannerSummary.toolRequestContext.requested
                ? 'not_executed'
                : 'not_selected';
        if (
            weatherRouting.weatherLikeRequest ||
            weatherRouting.selectedWeather
        ) {
            chatOrchestratorLogger.info('chat.weather.routing', {
                event: 'chat.weather.routing',
                stage: 'execution',
                surface: normalizedRequest.surface,
                ...weatherRouting,
                weatherExecutionAttempted,
                weatherToolStatus:
                    finalToolExecutionTelemetry?.status ??
                    plannerSummary?.toolExecutionContext?.status,
                weatherToolReasonCode:
                    finalToolExecutionTelemetry?.reasonCode ??
                    plannerSummary?.toolExecutionContext?.reasonCode,
                weatherOutcome,
            });
        }
        if (
            (weatherRouting.weatherLikeRequest ||
                weatherRouting.selectedWeather) &&
            !weatherExecutionAttempted
        ) {
            chatOrchestratorLogger.warn(
                'chat.weather.routing.normal_generation_without_weather_tool',
                {
                    event: 'chat.weather.routing',
                    stage: 'normal_generation_without_weather_tool',
                    surface: normalizedRequest.surface,
                    ...weatherRouting,
                    clarificationShortCircuitHit: false,
                    weatherExecutionAttempted,
                    weatherOutcome,
                }
            );
        }
        const emitControlObservability = (input: {
            responseAction: 'message' | 'ignore' | 'react' | 'image';
            responseModality: ChatPlan['modality'];
        }): void => {
            if (
                plannerSummary === undefined ||
                plannerStepResult === undefined
            ) {
                return;
            }
            const runtimeSteerabilityControls = buildSteerabilityControls({
                workflowMode: workflowModeResolution.modeDecision,
                executionContractResponseMode:
                    resolvedExecutionContract.response.responseMode,
                requestedProfileId: undefined,
                plannerSelectedProfileId: executionPlan.profileId,
                selectedProfile: {
                    profileId: plannerSummary.selectedResponseProfile.id,
                    provider: plannerSummary.selectedResponseProfile.provider,
                    model: plannerSummary.selectedResponseProfile.providerModel,
                },
                persona: {
                    personaId: personaProfile.id,
                    overlaySource: personaProfile.promptOverlay.source,
                },
                toolRequest: plannerSummary.toolRequestContext,
            });
            try {
                const observabilityEnvelope = buildControlObservabilityEnvelope(
                    {
                        surface: normalizedRequest.surface,
                        workflowModeId:
                            workflowModeResolution.modeDecision.modeId,
                        executionContractResponseMode:
                            resolvedExecutionContract.response.responseMode,
                        requestedProfileId: undefined,
                        plannerSelectedProfileId: executionPlan.profileId,
                        selectedProfileId:
                            plannerSummary.selectedResponseProfile.id,
                        personaOverlaySource:
                            personaProfile.promptOverlay.source,
                        toolRequest: plannerSummary.toolRequestContext,
                        plannerApplyOutcome: plannerSummary.plannerApplyOutcome,
                        plannerMatteredControlIds:
                            plannerSummary.plannerMatteredControlIds,
                        plannerStatus: plannerStepResult.execution.status,
                        plannerReasonCode:
                            plannerStepResult.execution.reasonCode,
                        responseAction: input.responseAction,
                        responseModality: input.responseModality,
                        steerabilityControls: runtimeSteerabilityControls,
                    }
                );
                emitControlObservabilityEnvelope(
                    chatOrchestratorLogger,
                    observabilityEnvelope
                );
            } catch (error) {
                chatOrchestratorLogger.warn(
                    'chat.steerability.control_observability_failed_open',
                    {
                        event: 'chat.steerability.control_observability_failed_open',
                        reason:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        surface: normalizedRequest.surface,
                        plannerStatus: plannerStepResult.execution.status,
                    }
                );
            }
        };
        const finalizedSteerabilityControls =
            plannerSummary !== undefined && plannerStepResult !== undefined
                ? buildSteerabilityControls({
                      workflowMode: workflowModeResolution.modeDecision,
                      executionContractResponseMode:
                          resolvedExecutionContract.response.responseMode,
                      requestedProfileId: undefined,
                      plannerSelectedProfileId: executionPlan.profileId,
                      selectedProfile: {
                          profileId: plannerSummary.selectedResponseProfile.id,
                          provider:
                              plannerSummary.selectedResponseProfile.provider,
                          model: plannerSummary.selectedResponseProfile
                              .providerModel,
                      },
                      persona: {
                          personaId: personaProfile.id,
                          overlaySource: personaProfile.promptOverlay.source,
                      },
                      toolRequest: plannerSummary.toolRequestContext,
                  })
                : undefined;
        if (response.kind === 'terminal_action') {
            const terminalResponse =
                response.response ??
                ({
                    action: 'ignore',
                    metadata: null,
                } as const);
            emitFallbackRollup(fallbackRollupSelectionSource);
            notifyBreakerEvent({
                responseId: null,
                responseAction: terminalResponse.action,
                responseModality: executionPlan.modality,
            });
            emitControlObservability({
                responseAction: terminalResponse.action,
                responseModality: executionPlan.modality,
            });
            return terminalResponse;
        }
        if (response.metadata === undefined || response.message === undefined) {
            chatOrchestratorLogger.warn(
                'ChatService returned message outcome without message metadata; failing open to ignore.'
            );
            emitFallbackRollup(fallbackRollupSelectionSource);
            notifyBreakerEvent({
                responseId: null,
                responseAction: 'ignore',
                responseModality: executionPlan.modality,
            });
            emitControlObservability({
                responseAction: 'ignore',
                responseModality: executionPlan.modality,
            });
            return {
                action: 'ignore',
                metadata: null,
            };
        }
        // ChatService computes totalDurationMs before metadata assembly and
        // queued trace writes. Avoid mutating metadata here to keep trace
        // persistence race-free.
        const totalDurationMs =
            response.metadata.totalDurationMs ??
            Math.max(0, Date.now() - orchestrationStartedAt);
        if (finalizedSteerabilityControls !== undefined) {
            response.metadata.steerabilityControls =
                finalizedSteerabilityControls;
        }
        emitFallbackRollup(fallbackRollupSelectionSource);
        notifyBreakerEvent({
            responseId: response.metadata.responseId,
            responseAction: 'message',
            responseModality: executionPlan.modality,
        });
        emitControlObservability({
            responseAction: 'message',
            responseModality: executionPlan.modality,
        });
        chatOrchestratorLogger.debug({
            event: 'chat.orchestration.timing',
            surface: normalizedRequest.surface,
            plannerStatus: plannerStepResult?.execution.status,
            plannerReasonCode: plannerStepResult?.execution.reasonCode,
            plannerDurationMs: plannerStepResult?.execution.durationMs,
            evaluatorStatus: evaluatorExecutionContext?.status,
            evaluatorReasonCode: evaluatorExecutionContext?.reasonCode,
            evaluatorSafetyTier:
                evaluatorExecutionContext?.outcome?.safetyDecision.safetyTier,
            evaluatorProvenance: evaluatorExecutionContext?.outcome?.provenance,
            evaluatorMode: evaluatorExecutionContext?.outcome?.mode,
            evaluatorAuthorityLevel:
                evaluatorExecutionContext?.outcome?.authorityLevel,
            generationDurationMs: response.generationDurationMs,
            totalDurationMs,
            plannerProfileId: activePlannerProfile.id,
            incomingBotPersonaId:
                normalizedRequest.botPersonaId?.trim() || null,
            personaProfileId: personaProfile.id,
            personaDisplayName: personaProfile.displayName,
            personaOverlaySource: personaProfile.promptOverlay.source,
            personaOverlayLength: personaProfile.promptOverlay.length,
            responseProfileId: plannerSummary?.selectedResponseProfile.id,
            originalProfileId: plannerSummary?.originalSelectedProfileId,
            effectiveProfileId: plannerSummary?.effectiveSelectedProfileId,
            requestedCapabilityProfile:
                plannerSummary?.executionPlan.requestedCapabilityProfile,
            selectedCapabilityProfile:
                plannerSummary?.selectedCapabilityProfile,
            capabilityReasonCode: plannerSummary?.capabilityReasonCode,
            searchRequested: plannerSummary?.searchRequested,
            toolName: finalToolExecutionTelemetry?.toolName,
            toolStatus: finalToolExecutionTelemetry?.status,
            toolReasonCode: finalToolExecutionTelemetry?.reasonCode,
            toolEligible: finalToolExecutionTelemetry?.eligible,
            toolRequestReasonCode:
                finalToolExecutionTelemetry?.requestReasonCode,
            rerouteApplied: undefined,
            fallbackApplied:
                plannerStepResult?.execution.status === 'failed' ||
                fallbackReasons.length > 0,
            fallbackReasons,
            executionContractId: resolvedExecutionContract.policyId,
            executionContractVersion: resolvedExecutionContract.policyVersion,
            routingStrategy: resolvedExecutionContract.routing.strategy,
            workflowModeId: workflowModeResolution.modeDecision.modeId,
            workflowModeSelectedBy:
                workflowModeResolution.modeDecision.selectedBy,
            responseId: response.metadata.responseId,
            responseAction: 'message',
            responseModality: executionPlan.modality,
            responseProvenance: response.metadata.provenance,
            responseSafetyTier: response.metadata.safetyTier,
            responseModelVersion: response.metadata.modelVersion,
            responseCitationCount: response.metadata.citations.length,
            responseMessageLength: response.message.length,
            correlation: buildCorrelationIds(
                normalizedRequest,
                response.metadata.responseId
            ),
        });

        // Message action is the only branch that returns provenance metadata.
        return {
            action: 'message',
            message: response.message,
            modality: executionPlan.modality,
            metadata: response.metadata,
        };
    };

    return {
        runChat,
    };
};
