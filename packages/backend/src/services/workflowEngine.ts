/**
 * @description: Defines backend-owned workflow engine primitives for step orchestration and bounded execution.
 * @footnote-scope: core
 * @footnote-module: WorkflowEngine
 * @footnote-risk: medium - Incorrect transition or limit logic can cause invalid workflow routes or runaway execution.
 * @footnote-ethics: high - Workflow control determines whether model-deliberative paths remain bounded and auditable.
 */
import type {
    PresentationMetadata,
    WorkflowStepKind,
} from '@footnote/contracts/policy';
import type { WorkflowTerminationReason } from '@footnote/contracts/policy';
import type {
    ContextStepRequest as ContractContextStepRequest,
    ContextStepResult as ContractContextStepResult,
    ExecutionReasonCode,
    StepSignals,
    StepRecord,
    WorkflowTerminalActionSignals,
    WorkflowToolClarificationSignals,
    WorkflowLimitKey,
    WorkflowRecord,
} from '@footnote/contracts/policy';
import type { WorkflowProfilePolicyContract } from './workflowProfileContract.js';
import type {
    GenerationRequest,
    GenerationResult,
    GenerationRuntime,
    RuntimeMessage,
} from '@footnote/agent-runtime';
import type { ModelProfile, TraceAxisScore } from '@footnote/contracts';
import type { ResponseCandidate } from '@footnote/contracts/web';
import { logger } from '../utils/logger.js';
import { resolveProfileReasoningEffort } from './runtimeRequestControls.js';
import type {
    PlanContinuationBuilder,
    PlanContinuation,
    PlanTerminalAction,
    PlannerStepExecutor,
    PlannerStepRequest,
    PlannerStepResult,
} from './plannerWorkflowSeams.js';
import { buildPlannerExecutionSummaryExtras } from './plannerWorkflowSeams.js';
import type { ConversationContextEnvelope } from './conversationContextService.js';
import {
    sanitizeReviewModuleIds,
    type ReviewModuleId,
} from './reviewModules.js';
import {
    DEFAULT_REVIEW_DECISION_PROMPT,
    DEFAULT_REVISION_PROMPT_PREFIX,
    parseReviewDecisionOutputResult,
    type ReviewDecisionParseResult,
} from './workflowEngine/reviewDecision.js';
import { isWorkflowTransitionAllowed } from './workflowEngine/transitions.js';
import {
    applyStepExecutionToState,
    createInitialWorkflowState,
    type WorkflowState,
} from './workflowEngine/state.js';
import {
    resolveExecutionLimits,
    buildExecutionLimitStop,
    checkExecutionLimits,
    mapLimitExhaustionToTerminationReason,
    UNBOUNDED_EXECUTION_LIMIT,
    type ExecutionLimits,
} from './workflowEngine/limits.js';
import { buildPlannerStepRecord } from './workflowEngine/plannerStepRecord.js';
import { executeReviewLoop } from './workflowEngine/reviewLoopExecutor.js';
import {
    injectContextMessagesIntoPrompt,
    injectGenerationContextManifestIntoPrompt,
    selectContextStepExecutor,
    selectFollowUpSearchHint,
} from './workflowEngine/contextStepHelpers.js';
import {
    buildGenerationContextManifest,
    renderGenerationContextManifest,
} from './workflowEngine/contextManifest.js';
import {
    boundGenerationRequestToWorkflowBudget,
    DEFAULT_WORKFLOW_GENERATION_MAX_OUTPUT_TOKENS,
    estimateGenerationTokenBudget,
    estimatePlannerInputTokens,
    estimatePlannerTokenBudget,
    estimateRuntimeMessageTokens,
    calculatePresentationOutputBudget,
    calculateReviewedGenerationOutputBudget,
    resolveDefaultGenerationMaxOutputTokens,
} from './workflowEngine/tokenBudget.js';
import {
    executeStepRoutingChain,
    type RoutingChainAttemptLog,
} from './stepRoutingExecutor.js';
import type { ResolvedStepRoutingCandidate } from './stepRoutingChains.js';
import { buildRoutingChainSignals } from './workflowEngine/routingSignals.js';
import { toRoutingChainResult } from './routingChainResult.js';
import {
    buildAuthoritativeGenerationRequest,
    createPresentationFallback,
    runPresentationCandidate,
    type PresentationConfig,
    type PresentationPersona,
} from './presentation.js';
import { createResponseCandidateCollector } from './responseCandidates.js';

/**
 * Canonical Execution Contract workflow-policy surface.
 *
 * This alias keeps existing engine call sites stable while making
 * `WorkflowProfilePolicyContract` the single source of truth for shape.
 */
export type WorkflowRunPolicy = WorkflowProfilePolicyContract;

/**
 * Canonical execution-limits surface used by workflow runtime checks.
 */
export type {
    ExecutionLimits,
    ExhaustedExecutionLimit,
} from './workflowEngine/limits.js';
export type { WorkflowState } from './workflowEngine/state.js';
export type { ReviewDecision } from './workflowEngine/reviewDecision.js';
export {
    DEFAULT_REVIEW_DECISION_PROMPT,
    DEFAULT_REVISION_PROMPT_PREFIX,
    parseReviewDecisionOutput,
    parseReviewDecisionOutputResult,
} from './workflowEngine/reviewDecision.js';

export type BoundedReviewProfileStrategy = {
    reviewDecisionPrompt: string;
    revisionPromptPrefix: string;
    parseReviewDecision: (text: string) => ReviewDecisionParseResult;
};

export const BOUNDED_REVIEW_PROFILE_STRATEGY: BoundedReviewProfileStrategy = {
    reviewDecisionPrompt: DEFAULT_REVIEW_DECISION_PROMPT,
    revisionPromptPrefix: DEFAULT_REVISION_PROMPT_PREFIX,
    parseReviewDecision: parseReviewDecisionOutputResult,
};

export type ReviewWorkflowRuntimeConfig = {
    workflowName: string;
    maxIterations: number;
    maxDurationMs: number;
    executionLimits?: ExecutionLimits;
};

export type ReviewWorkflowUsageSummary = {
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCost: {
        inputCostUsd: number;
        outputCostUsd: number;
        totalCostUsd: number;
    };
};

export type RunBoundedReviewWorkflowInput = {
    generationRuntime: GenerationRuntime;
    generationRequest: GenerationRequest;
    messagesWithHints: RuntimeMessage[];
    contextEnvelope: ConversationContextEnvelope;
    generationStartedAtMs: number;
    workflowConfig: ReviewWorkflowRuntimeConfig;
    workflowPolicy: WorkflowRunPolicy;
    profileStrategy?: BoundedReviewProfileStrategy;
    reviewDecisionPrompt?: string;
    revisionPromptPrefix?: string;
    reviewModuleIds?: ReviewModuleId[];
    parseReviewDecision?: (text: string) => ReviewDecisionParseResult;
    captureUsage: (
        result: GenerationResult,
        requestedModel: string | undefined
    ) => ReviewWorkflowUsageSummary;
    plannerStepRecord?: StepRecord;
    // Workflow engine owns when the plan step runs.
    plannerStepRequest?: PlannerStepRequest;
    plannerStepExecutor?: PlannerStepExecutor;
    // Caller-owned policy application. Engine only consumes continuation output.
    planContinuationBuilder?: PlanContinuationBuilder;
    // Multi-integration input. Engine executes eligible steps in parallel.
    contextStepRequests?: ContextStepRequest[];
    contextStepExecutor?: ContextStepExecutor;
    // Preferred executor routing by integration name.
    contextStepExecutorRegistry?: Record<string, ContextStepExecutor>;
    // Optional OpenAI-native follow-up search from context-step search hints.
    openAiNativeSearchFromHintsEnabled?: boolean;
    stepRoutingChainSet?: {
        enabledProfilesById: Map<string, ModelProfile>;
        generateCandidates: ResolvedStepRoutingCandidate[];
        assessCandidates: ResolvedStepRoutingCandidate[];
    };
    /** Optional, backend-owned presentation step. It is never a generic transform pipeline. */
    presentation?: {
        config: PresentationConfig;
        persona: PresentationPersona;
        /** Resolved TRACE caution from the planning path before presentation runs. */
        caution?: TraceAxisScore;
        captureUsage: (
            result: GenerationResult,
            profile: ModelProfile,
            feature: 'chat_presentation_draft'
        ) => ReviewWorkflowUsageSummary;
    };
    /** Shared persona guidance for assess and revise prompts. */
    personaExpressionGuidance?: string;
};

export type RunBoundedReviewWorkflowResult =
    | {
          outcome: 'generated';
          generationResult: GenerationResult;
          workflowLineage: WorkflowRecord;
          responseCandidates?: ResponseCandidate[];
          presentation?: PresentationMetadata;
          plannerStepResult?: PlannerStepResult;
          planContinuation?: PlanContinuation;
          contextStepResult?: ContextStepResult;
          contextStepResults?: ContextStepResult[];
      }
    | {
          outcome: 'terminal_action';
          terminalAction: PlanTerminalAction;
          workflowLineage: WorkflowRecord;
          plannerStepResult?: PlannerStepResult;
          planContinuation?: PlanContinuation;
          contextStepResult?: ContextStepResult;
          contextStepResults?: ContextStepResult[];
      }
    | {
          outcome: 'no_generation';
          workflowLineage: WorkflowRecord;
          presentation?: PresentationMetadata;
          plannerStepResult?: PlannerStepResult;
          planContinuation?: PlanContinuation;
          contextStepResult?: ContextStepResult;
          contextStepResults?: ContextStepResult[];
      };

export type ContextStepRequest = ContractContextStepRequest;

export type ContextStepResult = ContractContextStepResult;

export type ContextStepExecutorInput = {
    request: ContextStepRequest;
    workflowId: string;
    workflowName: string;
    attempt: number;
};

export type ContextStepExecutor = (
    input: ContextStepExecutorInput
) => Promise<ContextStepResult>;

type ContextStepExecutionOutcome = {
    request: ContextStepRequest;
    result?: ContextStepResult;
    error?: unknown;
    blockedByLimit?: boolean;
    startedAtMs: number;
    finishedAtMs: number;
};

type ContextStepManifestFailure = {
    integrationName: string;
    requested: boolean;
    status: 'unavailable' | 'failed' | 'skipped';
};

/**
 * @description: Preserves admitted context requests when planner continuation adds requests. It prevents injected TrustGraph context from being dropped.
 * @footnote-scope: core
 * @footnote-module: WorkflowEngine
 * @footnote-risk: medium - A merge defect can remove context from generation.
 * @footnote-ethics: medium - Context provenance can affect governance evidence.
 */
const mergeContextStepRequests = (
    existingRequests: ContextStepRequest[] | undefined,
    continuationRequests: ContextStepRequest[] | undefined
): ContextStepRequest[] => {
    const mergedRequests = [...(existingRequests ?? [])];
    const seenIntegrations = new Set(
        mergedRequests.map((request) => request.integrationName)
    );

    for (const request of continuationRequests ?? []) {
        if (seenIntegrations.has(request.integrationName)) {
            continue;
        }

        seenIntegrations.add(request.integrationName);
        mergedRequests.push(request);
    }

    return mergedRequests;
};

type LimitStopEvaluation = {
    stopped: boolean;
    shouldStop: boolean;
    terminationReason: WorkflowTerminationReason;
    workflowStatus: WorkflowRecord['status'];
    exhaustedLimitKey?: WorkflowLimitKey;
    stoppedBeforeStepKind?: WorkflowStepKind;
};

const DEFAULT_PLANNER_MAX_OUTPUT_TOKENS = 1200;
// Keep optional presentation admission usable while provider-reported usage
// remains the authoritative cumulative budget check.
const PRESENTATION_PROMPT_OVERHEAD_TOKENS = 128;
const PRESENTATION_ASSESSMENT_OUTPUT_TOKENS = 200;

export { isWorkflowTransitionAllowed } from './workflowEngine/transitions.js';
export {
    applyStepExecutionToState,
    cloneWorkflowState,
    createInitialWorkflowState,
} from './workflowEngine/state.js';
export {
    checkExecutionLimits,
    mapLimitExhaustionToTerminationReason,
} from './workflowEngine/limits.js';
export { buildPlannerStepRecord } from './workflowEngine/plannerStepRecord.js';
export type { BuildPlannerStepRecordInput } from './workflowEngine/plannerStepRecord.js';

export const runBoundedReviewWorkflow = async ({
    generationRuntime,
    generationRequest,
    messagesWithHints,
    contextEnvelope,
    generationStartedAtMs,
    workflowConfig,
    workflowPolicy,
    profileStrategy = BOUNDED_REVIEW_PROFILE_STRATEGY,
    reviewDecisionPrompt,
    revisionPromptPrefix,
    reviewModuleIds,
    parseReviewDecision,
    captureUsage,
    plannerStepRecord,
    plannerStepRequest,
    plannerStepExecutor,
    planContinuationBuilder,
    contextStepRequests,
    contextStepExecutor,
    contextStepExecutorRegistry,
    openAiNativeSearchFromHintsEnabled = false,
    stepRoutingChainSet,
    presentation,
    personaExpressionGuidance,
}: RunBoundedReviewWorkflowInput): Promise<RunBoundedReviewWorkflowResult> => {
    if (!contextEnvelope) {
        throw new Error(
            'contextEnvelope is required for runBoundedReviewWorkflow.'
        );
    }
    // NOTE: Concrete tool execution is still orchestrator/registry-owned.
    // This engine path currently executes only Reviewed generation steps.
    const sanitizeNonNegativeInteger = (
        value: number,
        fallback: number
    ): number => {
        if (!Number.isFinite(value)) {
            return Math.max(0, Math.floor(fallback));
        }

        return Math.max(0, Math.floor(value));
    };
    const sanitizePositiveInteger = (
        value: number,
        fallback: number
    ): number => {
        if (!Number.isFinite(value)) {
            return Math.max(1, Math.floor(fallback));
        }

        return Math.max(1, Math.floor(value));
    };
    const normalizedMaxIterations = sanitizeNonNegativeInteger(
        workflowConfig.maxIterations,
        0
    );
    const normalizedMaxDurationMs = sanitizePositiveInteger(
        workflowConfig.maxDurationMs,
        15000
    );
    const workflowStartedAt = Date.now();
    const workflowId = `wf_${workflowStartedAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const workflowSteps: StepRecord[] = [];
    // Both the engine and review-loop seam append lineage steps. Keep one
    // shared counter so a post-review presentation step cannot reuse an
    // assessment or planner-reentry id and invalidate trace persistence.
    const workflowStepCounter = { value: 0 };
    let plannerRootStepId: string | undefined;
    if (plannerStepRecord?.stepKind === 'plan') {
        workflowSteps.push(plannerStepRecord);
        workflowStepCounter.value = 1;
        plannerRootStepId = plannerStepRecord.stepId;
    }
    let plannerExecutionResult: PlannerStepResult | undefined;
    let terminationReason: WorkflowTerminationReason = 'budget_exhausted_steps';
    let workflowStatus: WorkflowRecord['status'] = 'degraded';
    let draftResult: GenerationResult | null = null;
    let draftParentStepId: string | undefined;
    let shouldStop = false;
    let exhaustedLimitKey: WorkflowLimitKey | undefined;
    let stoppedBeforeStepKind: WorkflowStepKind | undefined;
    let executedContextStepResult: ContextStepResult | undefined;
    let executedContextStepResults: ContextStepResult[] = [];
    let messagesWithContext = messagesWithHints;
    let effectiveGenerationRequest = generationRequest;
    let effectiveMessagesWithHints = messagesWithHints;
    let effectiveContextEnvelope: ConversationContextEnvelope = contextEnvelope;
    let effectiveContextStepRequests = contextStepRequests;
    let workflowTerminalAction: PlanTerminalAction | undefined;
    let planContinuation: PlanContinuation | undefined;
    const effectiveReviewDecisionPrompt = reviewDecisionPrompt?.trim();
    const effectiveRevisionPromptPrefix =
        revisionPromptPrefix ?? profileStrategy.revisionPromptPrefix;
    const effectiveParseReviewDecision =
        parseReviewDecision ?? profileStrategy.parseReviewDecision;
    const selectedReviewModuleIds = sanitizeReviewModuleIds(reviewModuleIds);

    const executionLimits: ExecutionLimits = {
        maxWorkflowSteps: sanitizePositiveInteger(
            workflowConfig.executionLimits?.maxWorkflowSteps ??
                Math.max(1, normalizedMaxIterations * 2),
            Math.max(1, normalizedMaxIterations * 2)
        ),
        maxToolCalls: sanitizeNonNegativeInteger(
            workflowConfig.executionLimits?.maxToolCalls ??
                UNBOUNDED_EXECUTION_LIMIT,
            UNBOUNDED_EXECUTION_LIMIT
        ),
        maxPlanCycles: sanitizeNonNegativeInteger(
            workflowConfig.executionLimits?.maxPlanCycles ?? 1,
            1
        ),
        maxReviewCycles: sanitizeNonNegativeInteger(
            workflowConfig.executionLimits?.maxReviewCycles ??
                Math.max(0, normalizedMaxIterations * 2 - 1),
            Math.max(0, normalizedMaxIterations * 2 - 1)
        ),
        maxDeliberationCalls: sanitizeNonNegativeInteger(
            workflowConfig.executionLimits?.maxDeliberationCalls ??
                Math.max(1, normalizedMaxIterations * 2),
            Math.max(1, normalizedMaxIterations * 2)
        ),
        maxTokensTotal: sanitizeNonNegativeInteger(
            workflowConfig.executionLimits?.maxTokensTotal ??
                UNBOUNDED_EXECUTION_LIMIT,
            UNBOUNDED_EXECUTION_LIMIT
        ),
        maxDurationMs: sanitizePositiveInteger(
            workflowConfig.executionLimits?.maxDurationMs ??
                normalizedMaxDurationMs,
            normalizedMaxDurationMs
        ),
    };
    const boundGenerationRequest = (
        request: GenerationRequest,
        state: WorkflowState = workflowState
    ): GenerationRequest | undefined =>
        boundGenerationRequestToWorkflowBudget({
            request,
            totalTokens: state.totalTokens,
            maxTokensTotal: executionLimits.maxTokensTotal,
        });
    const hasExplicitMaxDeliberationCalls =
        workflowConfig.executionLimits?.maxDeliberationCalls !== undefined;
    if (!hasExplicitMaxDeliberationCalls) {
        executionLimits.maxDeliberationCalls = Math.max(
            executionLimits.maxDeliberationCalls,
            (executionLimits.maxPlanCycles ?? 0) +
                (executionLimits.maxReviewCycles ?? 0)
        );
    }
    const effectiveMaxIterations =
        workflowConfig.executionLimits !== undefined
            ? Math.max(
                  0,
                  Math.min(
                      Math.ceil(executionLimits.maxDeliberationCalls / 2),
                      Math.ceil(
                          Math.max(0, executionLimits.maxWorkflowSteps - 1) / 2
                      )
                  )
              )
            : normalizedMaxIterations;
    let workflowState = createInitialWorkflowState({
        workflowId,
        workflowName: workflowConfig.workflowName,
        startedAtMs: workflowStartedAt,
    });
    const responseCandidates = createResponseCandidateCollector();

    if (plannerStepRecord?.stepKind === 'plan') {
        const plannerStepUsageTokens =
            plannerStepRecord.usage?.totalTokens ??
            (plannerStepRecord.usage?.promptTokens ?? 0) +
                (plannerStepRecord.usage?.completionTokens ?? 0);
        workflowState = {
            ...workflowState,
            stepCount: workflowState.stepCount + 1,
            planCallCount: workflowState.planCallCount + 1,
            totalTokens: workflowState.totalTokens + plannerStepUsageTokens,
        };
    }

    const captureStep = (input: {
        stepKind: StepRecord['stepKind'];
        status: StepRecord['outcome']['status'];
        summary: string;
        artifacts?: string[];
        startedAtMs: number;
        finishedAtMs: number;
        model?: string;
        usage?: GenerationResult['usage'];
        estimatedCost?: ReviewWorkflowUsageSummary['estimatedCost'];
        reasonCode?: ExecutionReasonCode;
        parentStepId?: string;
        attempt: number;
        signals?: StepSignals;
        recommendations?: string[];
    }): string => {
        workflowStepCounter.value += 1;
        const stepId = `step_${workflowStepCounter.value}`;
        workflowSteps.push({
            stepId,
            ...(input.parentStepId !== undefined && {
                parentStepId: input.parentStepId,
            }),
            attempt: input.attempt,
            stepKind: input.stepKind,
            ...(input.reasonCode !== undefined && {
                reasonCode: input.reasonCode,
            }),
            startedAt: new Date(input.startedAtMs).toISOString(),
            finishedAt: new Date(input.finishedAtMs).toISOString(),
            durationMs: Math.max(0, input.finishedAtMs - input.startedAtMs),
            ...(input.model !== undefined && { model: input.model }),
            ...(input.usage !== undefined && {
                usage: {
                    promptTokens: input.usage.promptTokens,
                    completionTokens: input.usage.completionTokens,
                    reasoningTokens: input.usage.reasoningTokens,
                    totalTokens: input.usage.totalTokens,
                },
            }),
            ...(input.estimatedCost !== undefined && {
                cost: {
                    inputCostUsd: input.estimatedCost.inputCostUsd,
                    outputCostUsd: input.estimatedCost.outputCostUsd,
                    totalCostUsd: input.estimatedCost.totalCostUsd,
                },
            }),
            outcome: {
                status: input.status,
                summary: input.summary,
                ...(input.artifacts !== undefined && {
                    artifacts: input.artifacts,
                }),
                ...(input.signals !== undefined && {
                    signals: input.signals,
                }),
                ...(input.recommendations !== undefined && {
                    recommendations: input.recommendations,
                }),
            },
        });
        return stepId;
    };

    const stopIfOverLimits = (
        nextStepKind?: WorkflowStepKind,
        nextStepTokenBudget = 0,
        stateForCheck: WorkflowState = workflowState
    ): LimitStopEvaluation => {
        const limitsCheck = checkExecutionLimits(
            stateForCheck,
            executionLimits,
            Date.now(),
            nextStepKind,
            nextStepTokenBudget
        );
        if (limitsCheck.withinLimits) {
            return {
                stopped: shouldStop,
                shouldStop,
                terminationReason,
                workflowStatus,
                exhaustedLimitKey,
                stoppedBeforeStepKind,
            };
        }

        exhaustedLimitKey = limitsCheck.exhaustedBy;
        stoppedBeforeStepKind = nextStepKind;
        terminationReason =
            exhaustedLimitKey !== undefined
                ? mapLimitExhaustionToTerminationReason(exhaustedLimitKey)
                : 'budget_exhausted_steps';
        workflowStatus = 'degraded';
        shouldStop = true;
        return {
            stopped: true,
            shouldStop,
            terminationReason,
            workflowStatus,
            exhaustedLimitKey,
            stoppedBeforeStepKind,
        };
    };

    const stopIfTokenBudgetExceeded = (
        stateForCheck: WorkflowState = workflowState
    ): LimitStopEvaluation => {
        if (stateForCheck.totalTokens <= executionLimits.maxTokensTotal) {
            return {
                stopped: shouldStop,
                shouldStop,
                terminationReason,
                workflowStatus,
                exhaustedLimitKey,
                stoppedBeforeStepKind,
            };
        }

        exhaustedLimitKey = 'maxTokensTotal';
        stoppedBeforeStepKind = undefined;
        terminationReason = 'budget_exhausted_tokens';
        workflowStatus = 'degraded';
        shouldStop = true;
        return {
            stopped: true,
            shouldStop,
            terminationReason,
            workflowStatus,
            exhaustedLimitKey,
            stoppedBeforeStepKind,
        };
    };

    if (
        plannerRootStepId === undefined &&
        plannerStepRequest !== undefined &&
        plannerStepExecutor !== undefined
    ) {
        if (
            !isWorkflowTransitionAllowed(
                workflowState.currentStepKind,
                'plan',
                workflowPolicy
            )
        ) {
            terminationReason = 'transition_blocked_by_policy';
            shouldStop = true;
        } else {
            const plannerInputTokens = estimatePlannerInputTokens(
                plannerStepRequest.request
            );
            const remainingTokens =
                executionLimits.maxTokensTotal >= UNBOUNDED_EXECUTION_LIMIT
                    ? Number.MAX_SAFE_INTEGER
                    : Math.max(
                          0,
                          executionLimits.maxTokensTotal -
                              workflowState.totalTokens
                      );
            const plannerOutputBudget = Math.min(
                DEFAULT_PLANNER_MAX_OUTPUT_TOKENS,
                Math.max(0, remainingTokens - plannerInputTokens)
            );
            if (plannerOutputBudget < 1) {
                stopIfOverLimits('plan', remainingTokens + 1);
            } else if (
                !stopIfOverLimits(
                    'plan',
                    estimatePlannerTokenBudget({
                        request: plannerStepRequest.request,
                        maxOutputTokens: plannerOutputBudget,
                    })
                ).stopped
            ) {
                const plannerStartedAt = Date.now();
                plannerExecutionResult = await plannerStepExecutor({
                    ...plannerStepRequest,
                    invocationContext: {
                        ...plannerStepRequest.invocationContext,
                        maxOutputTokens: plannerOutputBudget,
                    },
                    workflowId,
                    workflowName: workflowConfig.workflowName,
                    attempt: 1,
                });
                const plannerFinishedAt = Date.now();
                const plannerStep = buildPlannerStepRecord({
                    stepId: 'step_1',
                    attempt: 1,
                    startedAtMs: plannerStartedAt,
                    finishedAtMs: plannerFinishedAt,
                    summary: {
                        status: plannerExecutionResult.execution.status,
                        ...(plannerExecutionResult.execution.reasonCode !==
                            undefined && {
                            reasonCode:
                                plannerExecutionResult.execution.reasonCode,
                        }),
                        purpose: plannerExecutionResult.execution.purpose,
                        contractType:
                            plannerExecutionResult.execution.contractType,
                        applyOutcome:
                            plannerExecutionResult.execution.status ===
                            'executed'
                                ? 'applied'
                                : 'not_applied',
                        durationMs: plannerExecutionResult.execution.durationMs,
                        action: plannerExecutionResult.plan.action,
                        modality: plannerExecutionResult.plan.modality,
                        requestedCapabilityProfile:
                            plannerExecutionResult.plan
                                .requestedCapabilityProfile,
                        ...buildPlannerExecutionSummaryExtras(
                            plannerExecutionResult.execution
                        ),
                    },
                });
                workflowSteps.push(plannerStep);
                workflowStepCounter.value = 1;
                plannerRootStepId = plannerStep.stepId;
                workflowState = applyStepExecutionToState(
                    workflowState,
                    'plan',
                    plannerExecutionResult.execution.usage?.totalTokens ?? 0,
                    0,
                    1
                );
                stopIfTokenBudgetExceeded();
            }
        }
    }

    if (
        !shouldStop &&
        plannerExecutionResult !== undefined &&
        planContinuationBuilder !== undefined
    ) {
        try {
            planContinuation = planContinuationBuilder({
                plannerStepResult: plannerExecutionResult,
                workflowId,
                workflowName: workflowConfig.workflowName,
                attempt: 1,
                baseMessagesWithHints: messagesWithHints,
                baseGenerationRequest: generationRequest,
                contextEnvelope: effectiveContextEnvelope,
            });
            if (planContinuation.continuation === 'terminal_action') {
                workflowTerminalAction = planContinuation.terminalAction;
            } else {
                effectiveGenerationRequest = planContinuation.generationRequest;
                effectiveMessagesWithHints = planContinuation.messagesWithHints;
                effectiveContextStepRequests = mergeContextStepRequests(
                    effectiveContextStepRequests,
                    planContinuation.contextStepRequests
                );
            }
        } catch (error) {
            logger.warn(
                'Plan continuation builder failed; continuing with pre-plan generation request.',
                {
                    workflowId,
                    workflowName: workflowConfig.workflowName,
                    attempt: 1,
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    if (workflowTerminalAction !== undefined) {
        const terminalStartedAt = Date.now();
        const terminalFinishedAt = Date.now();
        const terminalSignals: WorkflowTerminalActionSignals = {
            terminalAction: workflowTerminalAction.responseAction,
        };
        captureStep({
            stepKind: 'finalize',
            status: 'executed',
            summary:
                workflowTerminalAction.responseAction === 'image'
                    ? 'Workflow completed with planner terminal image action.'
                    : workflowTerminalAction.responseAction === 'react'
                      ? 'Workflow completed with planner terminal reaction action.'
                      : 'Workflow completed with planner terminal ignore action.',
            startedAtMs: terminalStartedAt,
            finishedAtMs: terminalFinishedAt,
            parentStepId: plannerRootStepId,
            attempt: 1,
            signals: terminalSignals,
        });
        workflowState = applyStepExecutionToState(
            workflowState,
            'finalize',
            0,
            0,
            0
        );
        terminationReason = 'goal_satisfied';
        workflowStatus = 'completed';
        shouldStop = true;
    }

    const requestedContextSteps = (effectiveContextStepRequests ?? []).filter(
        (request) => request.requested === true && request.eligible
    );
    const contextStepManifestFailures: ContextStepManifestFailure[] = [];
    const executableContextSteps = requestedContextSteps.filter((request) => {
        const executor = selectContextStepExecutor(
            request,
            contextStepExecutor,
            contextStepExecutorRegistry
        );
        if (executor !== undefined) return true;
        contextStepManifestFailures.push({
            integrationName: request.integrationName,
            requested: request.requested,
            status: 'unavailable',
        });
        return false;
    });
    if (!shouldStop && executableContextSteps.length > 0) {
        if (
            !isWorkflowTransitionAllowed(
                workflowState.currentStepKind,
                'tool',
                workflowPolicy
            )
        ) {
            terminationReason = 'transition_blocked_by_policy';
            shouldStop = true;
        } else if (!stopIfOverLimits('tool').stopped) {
            // Independent context integrations remain parallel by default. An
            // explicit GitHub object creates a narrow dependency chain so exact
            // repository retrieval completes before broad context and web
            // discovery can be admitted.
            const remainingToolCalls =
                executionLimits.maxToolCalls === UNBOUNDED_EXECUTION_LIMIT
                    ? Number.POSITIVE_INFINITY
                    : Math.max(
                          0,
                          executionLimits.maxToolCalls -
                              workflowState.toolCallCount
                      );
            let reservedToolCallCount = 0;
            const runContextStepBatch = async (
                requests: ContextStepRequest[]
            ): Promise<ContextStepExecutionOutcome[]> =>
                Promise.all(
                    requests.map(
                        async (
                            request
                        ): Promise<ContextStepExecutionOutcome> => {
                            if (reservedToolCallCount >= remainingToolCalls) {
                                const blockedAtMs = Date.now();
                                return {
                                    request,
                                    blockedByLimit: true,
                                    startedAtMs: blockedAtMs,
                                    finishedAtMs: blockedAtMs,
                                };
                            }
                            reservedToolCallCount += 1;
                            const executor = selectContextStepExecutor(
                                request,
                                contextStepExecutor,
                                contextStepExecutorRegistry
                            );
                            if (executor === undefined) {
                                return {
                                    request,
                                    startedAtMs: Date.now(),
                                    finishedAtMs: Date.now(),
                                };
                            }
                            const startedAtMs = Date.now();
                            try {
                                const result = await executor({
                                    request,
                                    workflowId,
                                    workflowName: workflowConfig.workflowName,
                                    attempt: 1,
                                });
                                return {
                                    request,
                                    result,
                                    startedAtMs,
                                    finishedAtMs: Date.now(),
                                };
                            } catch (error) {
                                return {
                                    request,
                                    error,
                                    startedAtMs,
                                    finishedAtMs: Date.now(),
                                };
                            }
                        }
                    )
                );
            const hasExplicitGitHubObject = executableContextSteps.some(
                (request) =>
                    request.integrationName === 'github_context' &&
                    request.input?.reference !== undefined
            );
            const contextStepBatches = hasExplicitGitHubObject
                ? [
                      executableContextSteps.filter(
                          (request) =>
                              request.integrationName === 'github_context' &&
                              request.input?.reference !== undefined
                      ),
                      executableContextSteps.filter(
                          (request) =>
                              !(
                                  request.integrationName ===
                                      'github_context' &&
                                  request.input?.reference !== undefined
                              ) && request.integrationName !== 'web_search'
                      ),
                      executableContextSteps.filter(
                          (request) => request.integrationName === 'web_search'
                      ),
                  ]
                : [executableContextSteps];
            const contextStepOutcomes: ContextStepExecutionOutcome[] = [];
            for (const batch of contextStepBatches) {
                if (batch.length > 0) {
                    contextStepOutcomes.push(
                        ...(await runContextStepBatch(batch))
                    );
                }
            }
            for (const contextStepOutcome of contextStepOutcomes) {
                if (contextStepOutcome.blockedByLimit === true) {
                    exhaustedLimitKey = 'maxToolCalls';
                    stoppedBeforeStepKind = 'tool';
                    terminationReason =
                        mapLimitExhaustionToTerminationReason('maxToolCalls');
                    workflowStatus = 'degraded';
                    shouldStop = true;
                    continue;
                }
                if (contextStepOutcome.error !== undefined) {
                    contextStepManifestFailures.push({
                        integrationName:
                            contextStepOutcome.request.integrationName,
                        requested: contextStepOutcome.request.requested,
                        status: 'failed',
                    });
                    logger.error(
                        'Context step execution failed; workflow continued fail-open without context.',
                        {
                            stepKind: 'tool',
                            reasonCode: 'tool_execution_error',
                            startedAtMs: contextStepOutcome.startedAtMs,
                            finishedAtMs: contextStepOutcome.finishedAtMs,
                            parentStepId: plannerRootStepId,
                            attempt: 1,
                            workflowName: workflowConfig.workflowName,
                            workflowId,
                            integrationName:
                                contextStepOutcome.request.integrationName,
                            error:
                                contextStepOutcome.error instanceof Error
                                    ? contextStepOutcome.error.message
                                    : String(contextStepOutcome.error),
                        }
                    );
                    captureStep({
                        stepKind: 'tool',
                        status: 'failed',
                        summary:
                            'Context step execution failed; workflow continued fail-open without context.',
                        reasonCode: 'tool_execution_error',
                        startedAtMs: contextStepOutcome.startedAtMs,
                        finishedAtMs: contextStepOutcome.finishedAtMs,
                        parentStepId: plannerRootStepId,
                        attempt: 1,
                    });
                    workflowState = applyStepExecutionToState(
                        workflowState,
                        'tool',
                        0,
                        1,
                        0
                    );
                    continue;
                }
                if (contextStepOutcome.result === undefined) {
                    continue;
                }
                const normalizedResult = contextStepOutcome.result;
                const normalizedExecutionContext =
                    normalizedResult.executionContext;
                const clarificationSignals:
                    WorkflowToolClarificationSignals | undefined =
                    normalizedResult.outcome === 'needs_clarification'
                        ? {
                              clarificationReasonCode:
                                  normalizedResult.clarification.reasonCode,
                              clarificationOptionCount:
                                  normalizedResult.clarification.options.length,
                          }
                        : undefined;
                executedContextStepResults.push(normalizedResult);
                captureStep({
                    stepKind: 'tool',
                    status: normalizedExecutionContext.status,
                    summary:
                        normalizedResult.outcome === 'failed'
                            ? 'Context step failed; workflow continued fail-open without context.'
                            : normalizedResult.outcome === 'needs_clarification'
                              ? 'Context step requires user clarification before generation.'
                              : normalizedResult.outcome === 'skipped'
                                ? 'Context step skipped without context.'
                                : 'Context step executed and emitted bounded context messages.',
                    ...(normalizedExecutionContext.reasonCode !== undefined && {
                        reasonCode: normalizedExecutionContext.reasonCode,
                    }),
                    startedAtMs: contextStepOutcome.startedAtMs,
                    finishedAtMs: contextStepOutcome.finishedAtMs,
                    parentStepId: plannerRootStepId,
                    attempt: 1,
                    ...(normalizedResult.outcome === 'executed' &&
                        normalizedResult.contextMessages !== undefined && {
                            artifacts: normalizedResult.contextMessages.map(
                                (message) =>
                                    typeof message === 'string'
                                        ? message
                                        : message.content
                            ),
                        }),
                    ...(normalizedResult.outcome === 'needs_clarification' && {
                        signals: clarificationSignals,
                    }),
                });
                workflowState = applyStepExecutionToState(
                    workflowState,
                    'tool',
                    0,
                    1,
                    0
                );
                if (normalizedResult.outcome === 'needs_clarification') {
                    terminationReason = 'goal_satisfied';
                    workflowStatus = 'completed';
                    shouldStop = true;
                }
            }
            executedContextStepResult = executedContextStepResults.at(0);
        }
    }

    let presentationMetadata: PresentationMetadata | undefined;
    let presentationStepId: string | undefined;
    let presentationCandidateId: string | undefined;
    let draftCandidateId: string | undefined;
    const presentationEnabled =
        presentation?.config.enabled === true &&
        workflowPolicy.enableGeneration !== false;
    const initialResponseStepKind: WorkflowStepKind = presentationEnabled
        ? 'presentation'
        : 'generate';
    if (!shouldStop) {
        if (
            !isWorkflowTransitionAllowed(
                workflowState.currentStepKind,
                initialResponseStepKind,
                workflowPolicy
            )
        ) {
            terminationReason = 'transition_blocked_by_policy';
            shouldStop = true;
        } else if (!stopIfOverLimits(initialResponseStepKind).stopped) {
            let initialDraftStartedAt = generationStartedAtMs;
            const selectedFollowUpSearchHint = selectFollowUpSearchHint({
                results: executedContextStepResults,
                openAiNativeSearchFromHintsEnabled,
                effectiveGenerationRequest,
            });
            const generationContextManifest = buildGenerationContextManifest({
                contextEnvelope: effectiveContextEnvelope,
                contextStepRequests: effectiveContextStepRequests ?? [],
                contextStepResults: executedContextStepResults,
                contextStepFailures: contextStepManifestFailures,
                webSearchRequested:
                    effectiveGenerationRequest.search !== undefined ||
                    selectedFollowUpSearchHint !== undefined,
                webSearchAvailable:
                    effectiveGenerationRequest.capabilities?.canUseSearch,
            });
            messagesWithContext = injectGenerationContextManifestIntoPrompt(
                effectiveMessagesWithHints,
                renderGenerationContextManifest(generationContextManifest)
            );
            messagesWithContext = injectContextMessagesIntoPrompt(
                messagesWithContext,
                // Preserve deterministic context ordering by request list order.
                [
                    ...executedContextStepResults.flatMap(
                        (contextStepResult) =>
                            contextStepResult.outcome === 'executed'
                                ? [
                                      ...(
                                          contextStepResult.trustedSystemMessages ??
                                          []
                                      ).map((content) => ({
                                          role: 'system' as const,
                                          content,
                                      })),
                                      ...(
                                          contextStepResult.contextMessages ??
                                          []
                                      ).map((message) => ({
                                          role:
                                              contextStepResult.contextMessageRole ??
                                              'system',
                                          content:
                                              typeof message === 'string'
                                                  ? message
                                                  : message.content,
                                      })),
                                  ]
                                : []
                    ),
                ]
            );
            try {
                let initialRoutingChainAttempts:
                    RoutingChainAttemptLog[] | undefined;
                let initialRoutedProfile:
                    | {
                          profileId: string;
                          provider: string;
                          model: string;
                      }
                    | undefined;
                const generationRequestForAttempt: GenerationRequest = {
                    ...effectiveGenerationRequest,
                    messages: messagesWithContext,
                    ...(selectedFollowUpSearchHint !== undefined &&
                        effectiveGenerationRequest.search === undefined && {
                            search: {
                                query: selectedFollowUpSearchHint.query,
                                intent: selectedFollowUpSearchHint.intent,
                                contextSize: 'low',
                            },
                        }),
                };
                let authoritativeGenerationRequest =
                    generationRequestForAttempt;
                const activePresentation = presentation;
                let authoritativeOutputBudget: number | undefined;
                const presentationStartedAt = Date.now();
                const presentationCaution =
                    planContinuation?.continuation === 'continue_message'
                        ? (planContinuation.plannerTemperament?.caution ??
                          planContinuation.plannerSummary.executionPlan
                              .generation.temperament?.caution ??
                          activePresentation?.caution)
                        : activePresentation?.caution;
                const presentationGenerationRequest = (() => {
                    const authorityAdmissionRequest = boundGenerationRequest(
                        authoritativeGenerationRequest
                    );
                    if (authorityAdmissionRequest === undefined) {
                        return undefined;
                    }
                    if (
                        executionLimits.maxTokensTotal >=
                        UNBOUNDED_EXECUTION_LIMIT
                    ) {
                        return boundGenerationRequest(
                            generationRequestForAttempt
                        );
                    }
                    const authorityPromptTokens =
                        estimateRuntimeMessageTokens(
                            authorityAdmissionRequest.messages
                        ) + PRESENTATION_PROMPT_OVERHEAD_TOKENS;
                    const presentationPromptTokens =
                        estimateRuntimeMessageTokens(
                            generationRequestForAttempt.messages
                        ) + PRESENTATION_PROMPT_OVERHEAD_TOKENS;
                    const requestedAuthorityOutputTokens =
                        authorityAdmissionRequest.maxOutputTokens ??
                        DEFAULT_WORKFLOW_GENERATION_MAX_OUTPUT_TOKENS;
                    const assessmentPromptTokensWithoutDraft =
                        estimateRuntimeMessageTokens(
                            generationRequestForAttempt.messages
                        ) + PRESENTATION_PROMPT_OVERHEAD_TOKENS;
                    const authorityOutputTokens =
                        calculateReviewedGenerationOutputBudget({
                            totalTokens: workflowState.totalTokens,
                            maxTokensTotal: executionLimits.maxTokensTotal,
                            requestedOutputTokens:
                                requestedAuthorityOutputTokens,
                            authoritativePromptTokens: authorityPromptTokens,
                            assessmentPromptTokensWithoutDraft,
                            assessmentOutputTokens:
                                PRESENTATION_ASSESSMENT_OUTPUT_TOKENS,
                        });
                    if (authorityOutputTokens !== undefined) {
                        authoritativeOutputBudget = authorityOutputTokens;
                    }
                    const effectiveAuthorityOutputTokens =
                        authorityOutputTokens ?? requestedAuthorityOutputTokens;
                    const assessmentPromptTokens =
                        assessmentPromptTokensWithoutDraft +
                        effectiveAuthorityOutputTokens;
                    const presentationBudget =
                        calculatePresentationOutputBudget({
                            totalTokens: workflowState.totalTokens,
                            maxTokensTotal: executionLimits.maxTokensTotal,
                            requestedCandidateOutputTokens:
                                activePresentation?.config.profile
                                    ?.maxOutputTokens ??
                                resolveDefaultGenerationMaxOutputTokens(
                                    generationRequestForAttempt
                                ),
                            candidatePromptTokens: presentationPromptTokens,
                            authoritativePromptTokens: authorityPromptTokens,
                            authoritativeOutputTokens:
                                effectiveAuthorityOutputTokens,
                            assessmentPromptTokens,
                            assessmentOutputTokens:
                                PRESENTATION_ASSESSMENT_OUTPUT_TOKENS,
                        });
                    if (presentationBudget === undefined) {
                        return undefined;
                    }
                    return {
                        ...generationRequestForAttempt,
                        maxOutputTokens:
                            presentationBudget.candidateOutputTokens,
                    };
                })();
                const presentationResult =
                    presentationEnabled && activePresentation !== undefined
                        ? activePresentation.config.profile === undefined ||
                          activePresentation.config.profileId === null
                            ? await runPresentationCandidate({
                                  generationRuntime,
                                  generationRequest:
                                      generationRequestForAttempt,
                                  config: activePresentation.config,
                                  persona: activePresentation.persona,
                                  caution: presentationCaution,
                              })
                            : presentationGenerationRequest === undefined
                              ? createPresentationFallback({
                                    config: activePresentation.config,
                                    persona: activePresentation.persona,
                                    reasonCode: 'budget_skipped',
                                    caution: presentationCaution,
                                })
                              : await runPresentationCandidate({
                                    generationRuntime,
                                    generationRequest:
                                        presentationGenerationRequest,
                                    config: activePresentation.config,
                                    persona: activePresentation.persona,
                                    caution: presentationCaution,
                                })
                        : undefined;
                if (
                    presentationResult !== undefined &&
                    activePresentation !== undefined
                ) {
                    presentationMetadata = presentationResult.metadata;
                    const candidateUsage =
                        presentationResult.draftResult !== undefined &&
                        activePresentation.config.profile !== undefined
                            ? activePresentation.captureUsage(
                                  presentationResult.draftResult,
                                  activePresentation.config.profile,
                                  'chat_presentation_draft'
                              )
                            : undefined;
                    if (candidateUsage !== undefined) {
                        presentationMetadata.backendEstimatedCostUsd =
                            candidateUsage.estimatedCost.totalCostUsd;
                    }
                    presentationCandidateId =
                        presentationResult.outcome === 'candidate_generated' &&
                        presentationResult.draftResult !== undefined
                            ? responseCandidates.record({
                                  stage: 'presentation_draft',
                                  text: presentationResult.draftResult.text,
                              })
                            : undefined;
                    if (presentationResult.outcome === 'candidate_generated') {
                        presentationStepId = captureStep({
                            stepKind: 'presentation',
                            status: 'executed',
                            summary:
                                'Generated a presentation candidate for authoritative wording.',
                            reasonCode: 'presentation_candidate_generated',
                            startedAtMs: presentationStartedAt,
                            finishedAtMs: Date.now(),
                            model: candidateUsage?.model,
                            usage:
                                candidateUsage === undefined
                                    ? undefined
                                    : {
                                          promptTokens:
                                              candidateUsage.promptTokens,
                                          completionTokens:
                                              candidateUsage.completionTokens,
                                          totalTokens:
                                              candidateUsage.totalTokens,
                                      },
                            estimatedCost: candidateUsage?.estimatedCost,
                            parentStepId: plannerRootStepId,
                            attempt: 1,
                            ...(presentationCandidateId !== undefined && {
                                artifacts: [presentationCandidateId],
                            }),
                            signals: {
                                presentationOutcome:
                                    presentationResult.metadata.outcome,
                                presentationReasonCode:
                                    presentationResult.metadata.reasonCode,
                                presentationAttempted:
                                    presentationResult.metadata.attempted,
                                draftAttemptCount:
                                    presentationResult.metadata
                                        .draftAttemptCount,
                                draftProfileId:
                                    presentationResult.metadata
                                        .draftProfileId ?? null,
                            },
                        });
                    }
                    if (
                        presentationCandidateId !== undefined &&
                        presentationResult.draftResult !== undefined &&
                        presentationStepId !== undefined
                    ) {
                        responseCandidates.linkToWorkflowStep(
                            presentationCandidateId,
                            presentationStepId
                        );
                        authoritativeGenerationRequest =
                            buildAuthoritativeGenerationRequest(
                                generationRequestForAttempt,
                                presentationResult.draftResult.text,
                                activePresentation.persona.expressionGuidance
                            );
                    }
                    if (authoritativeOutputBudget !== undefined) {
                        authoritativeGenerationRequest = {
                            ...authoritativeGenerationRequest,
                            maxOutputTokens: authoritativeOutputBudget,
                        };
                    }
                    if (presentationResult.outcome === 'candidate_generated') {
                        workflowState = applyStepExecutionToState(
                            workflowState,
                            'presentation',
                            candidateUsage?.totalTokens ?? 0,
                            0,
                            0
                        );
                        stopIfTokenBudgetExceeded();
                    }
                }
                const boundedGenerationRequest = boundGenerationRequest(
                    authoritativeGenerationRequest
                );
                if (boundedGenerationRequest === undefined) {
                    stopIfOverLimits(
                        'generate',
                        Math.max(
                            1,
                            executionLimits.maxTokensTotal -
                                workflowState.totalTokens +
                                1
                        )
                    );
                } else {
                    authoritativeGenerationRequest = boundedGenerationRequest;
                }
                initialDraftStartedAt = Date.now();
                const canRunNormalGeneration =
                    draftResult === null &&
                    isWorkflowTransitionAllowed(
                        workflowState.currentStepKind,
                        'generate',
                        workflowPolicy
                    );
                if (draftResult === null && !canRunNormalGeneration) {
                    terminationReason = 'transition_blocked_by_policy';
                    shouldStop = true;
                } else if (
                    draftResult === null &&
                    !stopIfOverLimits(
                        'generate',
                        estimateGenerationTokenBudget(
                            authoritativeGenerationRequest
                        )
                    ).stopped &&
                    stepRoutingChainSet?.generateCandidates &&
                    stepRoutingChainSet.generateCandidates.length > 0
                ) {
                    const chainResult = await executeStepRoutingChain({
                        step: 'generate',
                        candidates: stepRoutingChainSet.generateCandidates,
                        enabledProfilesById:
                            stepRoutingChainSet.enabledProfilesById,
                        requiresSearch:
                            authoritativeGenerationRequest.search !== undefined,
                        runWithProfile: async (profile) =>
                            generationRuntime.generate({
                                ...authoritativeGenerationRequest,
                                model: profile.providerModel,
                                provider: profile.provider,
                                capabilities: profile.capabilities,
                                providerRouting: profile.providerRouting,
                                reasoningEffort: resolveProfileReasoningEffort(
                                    profile,
                                    authoritativeGenerationRequest.reasoningEffort,
                                    logger
                                ),
                            }),
                    });
                    const routingResult = toRoutingChainResult(chainResult);
                    if (routingResult.isErr()) {
                        const routingFailure = routingResult.error;
                        const initialDraftFinishedAt = Date.now();
                        logger.error(
                            'Initial workflow generation routing failed; returning classified no-generation outcome.',
                            {
                                stepKind: 'generate',
                                reasonCode: routingFailure.reasonCode,
                                startedAtMs: initialDraftStartedAt,
                                finishedAtMs: initialDraftFinishedAt,
                                workflowName: workflowState.workflowName,
                                workflowId: workflowState.workflowId,
                                routingChainAttemptCount:
                                    routingFailure.attempts.length,
                            }
                        );
                        captureStep({
                            stepKind: 'generate',
                            status: 'failed',
                            summary:
                                'Initial generation routing failed; workflow returned classified no-generation outcome.',
                            reasonCode: routingFailure.reasonCode,
                            startedAtMs: initialDraftStartedAt,
                            finishedAtMs: initialDraftFinishedAt,
                            parentStepId: plannerRootStepId,
                            attempt: 1,
                            signals: buildRoutingChainSignals({
                                attempts: routingFailure.attempts,
                                selectedProfileId: null,
                                signalKeys: {
                                    profileId: 'routedProfileId',
                                    provider: 'routedProvider',
                                    model: 'routedModel',
                                },
                            }),
                        });
                        workflowState = applyStepExecutionToState(
                            workflowState,
                            'generate',
                            0,
                            0,
                            0
                        );
                        terminationReason = 'executor_error_fail_open';
                        workflowStatus = 'degraded';
                        shouldStop = true;
                    } else {
                        initialRoutingChainAttempts =
                            routingResult.value.attempts;
                        initialRoutedProfile = {
                            profileId: routingResult.value.selected.profile.id,
                            provider:
                                routingResult.value.selected.profile.provider,
                            model: routingResult.value.selected.profile
                                .providerModel,
                        };
                        draftResult = routingResult.value.value;
                    }
                } else if (
                    canRunNormalGeneration &&
                    !stopIfOverLimits(
                        'generate',
                        estimateGenerationTokenBudget(
                            authoritativeGenerationRequest
                        )
                    ).stopped
                ) {
                    draftResult = await generationRuntime.generate(
                        authoritativeGenerationRequest
                    );
                }
                if (!shouldStop && draftResult !== null) {
                    const initialDraftFinishedAt = Date.now();
                    const generationIncompleteBeforeOutput =
                        draftResult.completion?.status === 'incomplete' &&
                        draftResult.text.trim().length === 0;
                    const initialDraftUsage = captureUsage(
                        draftResult,
                        effectiveGenerationRequest.model
                    );
                    const initialDraftCandidateId = responseCandidates.record({
                        stage: 'initial_generation',
                        text: draftResult.text,
                        ...(presentationCandidateId !== undefined && {
                            parentCandidateId: presentationCandidateId,
                        }),
                    });
                    const initialDraftStepId = captureStep({
                        stepKind: 'generate',
                        status: generationIncompleteBeforeOutput
                            ? 'failed'
                            : 'executed',
                        summary: generationIncompleteBeforeOutput
                            ? 'Generation exhausted its output allowance before producing visible text.'
                            : 'Generated initial draft response.',
                        startedAtMs: initialDraftStartedAt,
                        finishedAtMs: initialDraftFinishedAt,
                        model: initialDraftUsage.model,
                        usage: draftResult.usage,
                        estimatedCost: initialDraftUsage.estimatedCost,
                        parentStepId: presentationStepId ?? plannerRootStepId,
                        attempt: 1,
                        ...(generationIncompleteBeforeOutput && {
                            reasonCode: 'generation_incomplete_before_output',
                        }),
                        ...(initialDraftCandidateId !== undefined && {
                            artifacts: [initialDraftCandidateId],
                        }),
                        ...(initialRoutingChainAttempts !== undefined && {
                            signals: {
                                ...buildRoutingChainSignals({
                                    attempts: initialRoutingChainAttempts,
                                    selectedProfileId:
                                        initialRoutedProfile?.profileId,
                                    selectedProvider:
                                        initialRoutedProfile?.provider,
                                    selectedModel: initialRoutedProfile?.model,
                                    signalKeys: {
                                        profileId: 'routedProfileId',
                                        provider: 'routedProvider',
                                        model: 'routedModel',
                                    },
                                }),
                            },
                        }),
                    });
                    if (initialDraftCandidateId !== undefined) {
                        responseCandidates.linkToWorkflowStep(
                            initialDraftCandidateId,
                            initialDraftStepId
                        );
                    }
                    draftParentStepId = initialDraftStepId;
                    draftCandidateId = initialDraftCandidateId;
                    workflowState = applyStepExecutionToState(
                        workflowState,
                        'generate',
                        initialDraftUsage.totalTokens,
                        0,
                        0
                    );
                    stopIfTokenBudgetExceeded();
                    if (generationIncompleteBeforeOutput) {
                        // Do not feed an empty provider result into assessment or
                        // revision. Preserve its usage and completion facts, then
                        // let the chat boundary surface a controlled fallback.
                        terminationReason =
                            terminationReason === 'budget_exhausted_tokens'
                                ? terminationReason
                                : 'executor_error_fail_open';
                        workflowStatus = 'degraded';
                        shouldStop = true;
                    }
                } else if (!shouldStop && draftResult === null) {
                    throw new Error(
                        'Initial generation completed without a draft result.'
                    );
                }
            } catch (error) {
                const initialDraftFinishedAt = Date.now();
                logger.error(
                    'Initial workflow generation failed; returning classified no-generation outcome.',
                    {
                        stepKind: 'generate',
                        reasonCode: 'generation_runtime_error',
                        startedAtMs: initialDraftStartedAt,
                        finishedAtMs: initialDraftFinishedAt,
                        workflowName: workflowState.workflowName,
                        workflowId: workflowState.workflowId,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    }
                );
                captureStep({
                    stepKind: 'generate',
                    status: 'failed',
                    summary:
                        'Initial generation failed; workflow returned classified no-generation outcome.',
                    reasonCode: 'generation_runtime_error',
                    startedAtMs: initialDraftStartedAt,
                    finishedAtMs: initialDraftFinishedAt,
                    parentStepId: plannerRootStepId,
                    attempt: 1,
                });
                workflowState = applyStepExecutionToState(
                    workflowState,
                    'generate',
                    0,
                    0,
                    0
                );
                terminationReason = 'executor_error_fail_open';
                workflowStatus = 'degraded';
                shouldStop = true;
            }
        }
    }
    if (!shouldStop && effectiveMaxIterations === 0) {
        terminationReason = 'goal_satisfied';
        workflowStatus = 'completed';
    }

    const reviewLoopResult = await executeReviewLoop({
        effectiveMaxIterations,
        workflowPolicy,
        stopIfOverLimits,
        stopIfTokenBudgetExceeded,
        maxTokensTotal: executionLimits.maxTokensTotal,
        selectedReviewModuleIds,
        effectiveReviewDecisionPrompt,
        personaExpressionGuidance,
        generationRuntime,
        messagesWithContext,
        draftResult,
        effectiveGenerationRequest,
        captureUsage,
        effectiveParseReviewDecision,
        captureStep,
        draftParentStepId,
        draftCandidateId,
        responseCandidates,
        terminationReason,
        workflowStatus,
        shouldStop,
        workflowState,
        exhaustedLimitKey,
        stoppedBeforeStepKind,
        plannerStepRequest,
        plannerStepExecutor,
        planContinuationBuilder,
        workflowId,
        workflowName: workflowConfig.workflowName,
        effectiveMessagesWithHints,
        effectiveContextEnvelope,
        effectiveRevisionPromptPrefix,
        stepCounterRef: workflowStepCounter,
        workflowStepsRef: { value: workflowSteps },
        planContinuation,
        stepRoutingChainSet,
    });
    draftResult = reviewLoopResult.draftResult;
    draftCandidateId = reviewLoopResult.draftCandidateId;
    terminationReason = reviewLoopResult.terminationReason;
    workflowStatus = reviewLoopResult.workflowStatus;
    workflowState = reviewLoopResult.workflowState;
    exhaustedLimitKey = reviewLoopResult.exhaustedLimitKey;
    stoppedBeforeStepKind = reviewLoopResult.stoppedBeforeStepKind;
    planContinuation = reviewLoopResult.planContinuation;

    // Presentation runs before final wording. Its receipt is serialized
    // separately, so semantic workflow limits only describe recorded steps.
    const workflowLineage: WorkflowRecord = {
        workflowId,
        workflowName: workflowConfig.workflowName,
        status: workflowStatus,
        stepCount: workflowSteps.length,
        maxSteps: executionLimits.maxWorkflowSteps,
        maxDurationMs: executionLimits.maxDurationMs,
        effectiveLimits: resolveExecutionLimits({
            limits: executionLimits,
            policy: workflowPolicy,
            exhaustedLimitKey,
        }),
        limitStop: buildExecutionLimitStop({
            terminationReason,
            exhaustedLimitKey,
            stoppedBeforeStepKind,
        }),
        terminationReason,
        steps: workflowSteps,
    };

    if (workflowTerminalAction !== undefined) {
        return {
            outcome: 'terminal_action',
            terminalAction: workflowTerminalAction,
            workflowLineage,
            ...(plannerExecutionResult !== undefined && {
                plannerStepResult: plannerExecutionResult,
            }),
            ...(planContinuation !== undefined && {
                planContinuation,
            }),
            ...(executedContextStepResult !== undefined && {
                contextStepResult: executedContextStepResult,
            }),
            ...(executedContextStepResults.length > 0 && {
                contextStepResults: executedContextStepResults,
            }),
        };
    }

    if (draftResult === null) {
        return {
            outcome: 'no_generation',
            workflowLineage,
            ...(presentationMetadata !== undefined && {
                presentation: presentationMetadata,
            }),
            ...(plannerExecutionResult !== undefined && {
                plannerStepResult: plannerExecutionResult,
            }),
            ...(planContinuation !== undefined && {
                planContinuation,
            }),
            ...(executedContextStepResult !== undefined && {
                contextStepResult: executedContextStepResult,
            }),
            ...(executedContextStepResults.length > 0 && {
                contextStepResults: executedContextStepResults,
            }),
        };
    }

    if (draftCandidateId !== undefined) {
        responseCandidates.markSelected(draftCandidateId);
    }

    return {
        outcome: 'generated',
        generationResult: draftResult,
        workflowLineage,
        responseCandidates: responseCandidates.finalize(),
        ...(presentationMetadata !== undefined && {
            presentation: presentationMetadata,
        }),
        ...(plannerExecutionResult !== undefined && {
            plannerStepResult: plannerExecutionResult,
        }),
        ...(planContinuation !== undefined && {
            planContinuation,
        }),
        ...(executedContextStepResult !== undefined && {
            contextStepResult: executedContextStepResult,
        }),
        ...(executedContextStepResults.length > 0 && {
            contextStepResults: executedContextStepResults,
        }),
    };
};
