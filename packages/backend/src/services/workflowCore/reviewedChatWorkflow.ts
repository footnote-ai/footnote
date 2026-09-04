/**
 * @description: Runs the production reviewed-chat workflow through the shared
 * Workflow/Step/Attempt engine and adapts its bounded records to chat metadata.
 * @footnote-scope: core
 * @footnote-module: ReviewedChatWorkflow
 * @footnote-risk: high - This owns the live chat path, routing, fallback, and resource admission.
 * @footnote-ethics: high - Backend-owned topology and fail-open recovery determine what users are told and what evidence is retained.
 */
import type {
    GenerationRequest,
    GenerationResult,
    GenerationRuntime,
    GenerationUsage,
    RuntimeMessage,
} from '@footnote/agent-runtime';
import type { ModelProfile, TraceAxisScore } from '@footnote/contracts';
import type {
    ContextStepRequest as ContractContextStepRequest,
    ContextStepResult as ContractContextStepResult,
    ExecutionReasonCode,
    PresentationMetadata,
    StepSignals,
    StepRecord,
    WorkflowRecord,
    WorkflowStepKind,
    WorkflowTerminationReason,
} from '@footnote/contracts/policy';
import type { ResponseCandidate } from '@footnote/contracts/web';
import { logger } from '../../utils/logger.js';
import type { ConversationContextEnvelope } from '../conversationContextService.js';
import {
    buildAuthoritativeGenerationRequest,
    createPresentationFallback,
    runPresentationCandidate,
    type PresentationConfig,
    type PresentationPersona,
} from '../presentation.js';
import type {
    PlanContinuation,
    PlanContinuationBuilder,
    PlanTerminalAction,
    PlannerStepExecutor,
    PlannerStepRequest,
    PlannerStepResult,
} from '../plannerWorkflowSeams.js';
import type {
    ReviewDecision,
    ReviewDecisionParseResult,
} from '../workflowEngine/reviewDecision.js';
import {
    DEFAULT_REVIEW_DECISION_PROMPT,
    DEFAULT_REVISION_PROMPT_PREFIX,
    parseReviewDecisionOutputResult,
} from '../workflowEngine/reviewDecision.js';
import { buildAssessSignals } from '../workflowEngine/reviewLoopSignals.js';
import { buildWorkflowReviewParseFailureSignals } from '@footnote/contracts/policy';
import {
    buildAssessRoutingHintSignals,
    buildRoutingChainSignals,
} from '../workflowEngine/routingSignals.js';
import {
    decideRevisionRoutingHintLane,
    extractRoutingHintsFromAssess,
    reorderRevisionCandidatesByHintLane,
} from '../workflowEngine/revisionRoutingHints.js';
import { selectContextStepExecutor } from '../workflowEngine/contextStepHelpers.js';
import {
    buildModelInput,
    type ModelInputEvidence,
} from '../workflowEngine/modelInput.js';
import {
    boundGenerationRequestToWorkflowBudget,
    capGenerationRequestToProfileMax,
    calculatePresentationOutputBudget,
    calculateReviewedGenerationOutputBudget,
    DEFAULT_WORKFLOW_ASSESSMENT_MAX_OUTPUT_TOKENS,
    DEFAULT_WORKFLOW_GENERATION_MAX_OUTPUT_TOKENS,
    DEFAULT_WORKFLOW_PLANNER_MAX_OUTPUT_TOKENS,
    estimateGenerationTokenBudget,
    estimatePlannerInputTokens,
    estimatePlannerTokenBudget,
    estimateRuntimeMessageTokens,
    resolvePresentationOutputMaxTokens,
} from '../workflowEngine/tokenBudget.js';
import {
    executeStepRoutingChain,
    type RoutingChainAttemptLog,
} from '../stepRoutingExecutor.js';
import type { ResolvedStepRoutingCandidate } from '../stepRoutingChains.js';
import type { ProviderAvailabilityStore } from '../providerAvailability.js';
import { toRoutingChainResult } from '../routingChainResult.js';
import { resolveProfileReasoningEffort } from '../runtimeRequestControls.js';
import { createResponseCandidateCollector } from '../responseCandidates.js';
import {
    composeAssessPrompt,
    composeRefinementPrompt,
} from '../prompts/reviewPromptComposer.js';
import type { WorkflowProfilePolicyContract } from '../workflowProfileContract.js';
import {
    admitGenerationResult,
    attachGenerationAttemptEvidence,
    normalizeGenerationResultEvidence,
} from '../generationOutputAdmission.js';
import type {
    AttemptResult,
    ExecuteInput,
    Result,
    StepHandlerInput,
    Workflow,
} from './types.js';
import { executeWorkflow } from './engine.js';
import {
    activityForWorkflowStep,
    resolveExecutionLimits,
    buildExecutionLimitStop,
    type ExecutionLimits,
    type ExhaustedExecutionLimit,
    UNBOUNDED_EXECUTION_LIMIT,
} from '../workflowEngine/limits.js';

export type WorkflowRunPolicy = WorkflowProfilePolicyContract;

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

export type RunBoundedReviewWorkflowInput = {
    generationRuntime: GenerationRuntime;
    generationRequest: GenerationRequest;
    messagesWithHints: RuntimeMessage[];
    contextEnvelope: ConversationContextEnvelope;
    generationStartedAtMs: number;
    workflowConfig: ReviewWorkflowRuntimeConfig;
    workflowPolicy: WorkflowRunPolicy;
    reviewDecisionPrompt?: string;
    revisionPromptPrefix?: string;
    reviewModuleIds?: string[];
    parseReviewDecision?: (text: string) => ReviewDecisionParseResult;
    captureUsage: (
        result: GenerationResult,
        requestedModel: string | undefined
    ) => ReviewWorkflowUsageSummary;
    plannerStepRecord?: StepRecord;
    plannerStepRequest?: PlannerStepRequest;
    plannerStepExecutor?: PlannerStepExecutor;
    planContinuationBuilder?: PlanContinuationBuilder;
    contextStepRequests?: ContextStepRequest[];
    contextStepExecutor?: ContextStepExecutor;
    contextStepExecutorRegistry?: Record<string, ContextStepExecutor>;
    openAiNativeSearchFromHintsEnabled?: boolean;
    stepRoutingChainSet?: {
        enabledProfilesById: Map<string, ModelProfile>;
        generateCandidates: ResolvedStepRoutingCandidate[];
        assessCandidates: ResolvedStepRoutingCandidate[];
        providerAvailability?: ProviderAvailabilityStore;
    };
    presentation?: {
        config: PresentationConfig;
        persona: PresentationPersona;
        caution?: TraceAxisScore;
        captureUsage: (
            result: GenerationResult,
            profile: ModelProfile,
            feature: 'chat_presentation_draft'
        ) => ReviewWorkflowUsageSummary;
    };
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

type SerializableRecord = { readonly [key: string]: Result };
type ContinuePlanContinuation = Extract<
    PlanContinuation,
    { continuation: 'continue_message' }
>;
type ContextStepManifestFailure = ModelInputEvidence['failures'][number];

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

const toSerializable = (
    value: unknown,
    ancestors: ReadonlySet<object> = new Set()
): Result | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value !== 'object' || ancestors.has(value)) return undefined;

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);
    if (Array.isArray(value)) {
        const items: Result[] = [];
        for (const item of value) {
            const encoded = toSerializable(item, nextAncestors);
            if (encoded !== undefined) items.push(encoded);
        }
        return items;
    }
    if (!isPlainRecord(value)) return undefined;
    const record: Record<string, Result> = {};
    for (const [key, item] of Object.entries(value)) {
        const encoded = toSerializable(item, nextAncestors);
        if (encoded !== undefined) record[key] = encoded;
    }
    return record;
};

const resultRecord = (
    value: Result | undefined
): SerializableRecord | undefined =>
    isPlainRecord(value) ? (value as SerializableRecord) : undefined;

const readAs = <T>(value: Result | undefined): T | undefined =>
    value === undefined ? undefined : (value as unknown as T);

type ChatStepMetadata = {
    status: 'executed' | 'failed' | 'skipped';
    summary: string;
    reasonCode?: ExecutionReasonCode;
    model?: string;
    usage?: GenerationResult['usage'];
    estimatedCost?: ReviewWorkflowUsageSummary['estimatedCost'];
    signals?: StepSignals;
    recommendations?: string[];
    artifacts?: string[];
    terminationReason?: WorkflowTerminationReason;
    presentation?: PresentationMetadata;
    candidateId?: string;
};

const encodeMetadata = (metadata: ChatStepMetadata): Result | undefined =>
    toSerializable(metadata);

const usageForResult = (
    result: GenerationResult
): {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
} => {
    const promptTokens = result.usage?.promptTokens ?? 0;
    const completionTokens = result.usage?.completionTokens ?? 0;
    return {
        promptTokens,
        completionTokens,
        totalTokens:
            result.usage?.totalTokens ?? promptTokens + completionTokens,
    };
};

const normalizeNonNegativeInteger = (
    value: number,
    fallback: number
): number =>
    Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;

const normalizePositiveInteger = (value: number, fallback: number): number =>
    Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;

const mergeContextRequests = (
    current: ContextStepRequest[] | undefined,
    additions: ContextStepRequest[] | undefined
): ContextStepRequest[] => {
    const merged = [...(current ?? [])];
    const seen = new Set(merged.map((request) => request.integrationName));
    for (const request of additions ?? []) {
        if (!seen.has(request.integrationName)) {
            seen.add(request.integrationName);
            merged.push(request);
        }
    }
    return merged;
};

const firstDefined = <T>(...values: Array<T | undefined>): T | undefined =>
    values.find((value) => value !== undefined);

const workflowStepKind = (stepId: string): WorkflowStepKind => {
    if (stepId === 'plan' || stepId === 'defaultPlan' || stepId === 'replan') {
        return 'plan';
    }
    if (stepId === 'retrieve' || stepId === 'tool') return 'tool';
    if (stepId === 'presentation') return 'presentation';
    if (stepId === 'generate') return 'generate';
    if (stepId === 'assess') return 'assess';
    return 'finalize';
};

const suppressAdmissionBlockedStep = (step: {
    stepId: string;
    attempts: readonly { exhaustedLimit?: ExhaustedExecutionLimit }[];
}): boolean =>
    workflowStepKind(step.stepId) !== 'tool' &&
    step.attempts.some((attempt) => attempt.exhaustedLimit !== undefined);

const metadataFromAttempt = (
    step: { attempts: readonly { metadata?: Result }[] },
    fallback: ChatStepMetadata
): ChatStepMetadata => {
    for (let index = step.attempts.length - 1; index >= 0; index -= 1) {
        const metadata = readAs<ChatStepMetadata>(
            step.attempts[index]?.metadata
        );
        if (metadata !== undefined) return metadata;
    }
    return fallback;
};

const toWorkflowCost = (
    estimatedCost: ReviewWorkflowUsageSummary['estimatedCost']
): ReviewWorkflowUsageSummary['estimatedCost'] => ({
    inputCostUsd: estimatedCost.inputCostUsd,
    outputCostUsd: estimatedCost.outputCostUsd,
    totalCostUsd: estimatedCost.totalCostUsd,
});

const buildWorkflowLineage = (input: {
    execution: Awaited<ReturnType<typeof executeWorkflow>>;
    workflowName: string;
    maxDurationMs: number;
    executionLimits: ExecutionLimits;
    workflowPolicy: WorkflowRunPolicy;
    terminationReason: WorkflowTerminationReason;
    exhaustedLimitKey?: ExhaustedExecutionLimit;
    stoppedBeforeStepKind?: WorkflowStepKind;
    hiddenPresentationStep?: boolean;
    preExistingPlannerStep?: StepRecord;
}): WorkflowRecord => {
    const records: StepRecord[] = [];
    const semanticSteps = input.execution.run.steps.filter(
        (step) =>
            step.stepId !== 'finish' &&
            !(input.hiddenPresentationStep && step.stepId === 'presentation') &&
            !suppressAdmissionBlockedStep(step)
    );
    for (let index = 0; index < semanticSteps.length; index += 1) {
        const step = semanticSteps[index];
        const kind = workflowStepKind(step.stepId);
        const fallback: ChatStepMetadata = {
            status: step.status === 'failed' ? 'failed' : 'executed',
            summary: `Workflow ${step.stepId} step completed.`,
        };
        const metadata = metadataFromAttempt(step, fallback);
        const priorOfKind = (
            candidate: WorkflowStepKind
        ): StepRecord | undefined =>
            [...records]
                .reverse()
                .find((record) => record.stepKind === candidate);
        const parent =
            kind === 'assess'
                ? priorOfKind('generate')
                : kind === 'plan' && step.stepId === 'replan'
                  ? priorOfKind('assess')
                  : kind === 'generate'
                    ? firstDefined(
                          priorOfKind('assess'),
                          priorOfKind('presentation'),
                          priorOfKind('plan'),
                          priorOfKind('tool')
                      )
                    : kind === 'presentation' || kind === 'tool'
                      ? priorOfKind('plan')
                      : undefined;
        const successfulAttempt = [...step.attempts]
            .reverse()
            .find((attempt) => attempt.status === 'succeeded');
        const executionAttempt = successfulAttempt ?? step.attempts.at(-1);
        const exhaustedLimit = executionAttempt?.exhaustedLimit;
        if (exhaustedLimit === 'maxToolCalls') {
            fallback.reasonCode = 'max_tool_calls_reached';
        }
        records.push({
            stepId: `step_${index + 1}`,
            ...(parent === undefined ? {} : { parentStepId: parent.stepId }),
            attempt:
                kind === 'generate'
                    ? Math.max(1, step.iteration - 1)
                    : step.iteration,
            stepKind: kind,
            ...(metadata.reasonCode === undefined
                ? {}
                : { reasonCode: metadata.reasonCode }),
            startedAt: new Date(
                executionAttempt?.startedAtMs ?? input.execution.run.startedAtMs
            ).toISOString(),
            finishedAt: new Date(
                executionAttempt?.finishedAtMs ??
                    input.execution.run.finishedAtMs
            ).toISOString(),
            durationMs: Math.max(
                0,
                (executionAttempt?.finishedAtMs ??
                    input.execution.run.finishedAtMs) -
                    (executionAttempt?.startedAtMs ??
                        input.execution.run.startedAtMs)
            ),
            ...(metadata.model === undefined ? {} : { model: metadata.model }),
            ...(metadata.usage === undefined ? {} : { usage: metadata.usage }),
            ...(metadata.estimatedCost === undefined
                ? {}
                : { cost: toWorkflowCost(metadata.estimatedCost) }),
            outcome: {
                status: metadata.status,
                summary: metadata.summary,
                ...(metadata.signals === undefined
                    ? {}
                    : { signals: metadata.signals }),
                ...(metadata.recommendations === undefined
                    ? {}
                    : { recommendations: metadata.recommendations }),
                ...(metadata.artifacts === undefined
                    ? {}
                    : { artifacts: metadata.artifacts }),
                ...(metadata.candidateId === undefined
                    ? {}
                    : { artifacts: [metadata.candidateId] }),
            },
        });
    }
    if (input.preExistingPlannerStep !== undefined) {
        records.unshift(input.preExistingPlannerStep);
    }
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (record?.outcome.signals?.refinementSourceStepId !== 'assess') {
            continue;
        }
        const source = records
            .slice(0, index)
            .reverse()
            .find((candidate) => candidate.stepKind === 'assess');
        if (source === undefined || record === undefined) continue;
        records[index] = {
            ...record,
            outcome: {
                ...record.outcome,
                signals: {
                    ...record.outcome.signals,
                    refinementSourceStepId: source.stepId,
                },
            },
        };
    }
    return {
        workflowId: input.execution.run.workflowId,
        workflowName: input.workflowName,
        status:
            input.terminationReason === 'goal_satisfied' &&
            input.execution.status === 'completed' &&
            records.every((record) => record.outcome.status !== 'failed')
                ? 'completed'
                : 'degraded',
        terminationReason: input.terminationReason,
        stepCount: records.length,
        maxSteps: input.executionLimits.maxWorkflowSteps,
        maxDurationMs: input.maxDurationMs,
        effectiveLimits: resolveExecutionLimits({
            limits: input.executionLimits,
            policy: input.workflowPolicy,
            exhaustedLimitKey: input.exhaustedLimitKey,
        }),
        limitStop: buildExecutionLimitStop({
            terminationReason: input.terminationReason,
            exhaustedLimitKey: input.exhaustedLimitKey,
            stoppedBeforeStepKind: input.stoppedBeforeStepKind,
        }),
        steps: records,
    };
};

const makePlanDefault = (): PlannerStepResult => ({
    plan: {
        action: 'message',
        modality: 'text',
        safetyTier: 'Low',
        reasoning:
            'Planner unavailable; continue with the backend default message path.',
        generation: { reasoningEffort: 'low', verbosity: 'low' },
    },
    execution: {
        status: 'failed',
        reasonCode: 'planner_runtime_error',
        purpose: 'chat_orchestrator_action_selection',
        contractType: 'fallback',
        durationMs: 0,
    },
    ingestion: {
        outputApplyOutcome: 'rejected',
        fallbackTier: 'safe_default_plan',
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
});

/** Combines every provider Attempt used while routing one logical generation. */
const combineGenerationUsage = (
    summaries: readonly ReviewWorkflowUsageSummary[]
): ReviewWorkflowUsageSummary => {
    const last = summaries.at(-1);
    return {
        model: last?.model ?? 'unknown',
        promptTokens: summaries.reduce(
            (total, summary) => total + summary.promptTokens,
            0
        ),
        completionTokens: summaries.reduce(
            (total, summary) => total + summary.completionTokens,
            0
        ),
        totalTokens: summaries.reduce(
            (total, summary) => total + summary.totalTokens,
            0
        ),
        estimatedCost: {
            inputCostUsd: summaries.reduce(
                (total, summary) => total + summary.estimatedCost.inputCostUsd,
                0
            ),
            outputCostUsd: summaries.reduce(
                (total, summary) => total + summary.estimatedCost.outputCostUsd,
                0
            ),
            totalCostUsd: summaries.reduce(
                (total, summary) => total + summary.estimatedCost.totalCostUsd,
                0
            ),
        },
    };
};

const combineGenerationResultUsage = (
    results: readonly GenerationResult[]
): GenerationUsage | undefined => {
    if (!results.some((result) => result.usage !== undefined)) {
        return undefined;
    }

    const sum = (
        selector: (usage: GenerationUsage) => number | undefined
    ): number | undefined => {
        const values = results
            .map((result) =>
                result.usage === undefined ? undefined : selector(result.usage)
            )
            .filter((value): value is number => value !== undefined);
        return values.length === 0
            ? undefined
            : values.reduce((total, value) => total + value, 0);
    };

    return {
        promptTokens: sum((value) => value.promptTokens),
        cachedInputTokens: sum((value) => value.cachedInputTokens),
        cacheWriteTokens: sum((value) => value.cacheWriteTokens),
        completionTokens: sum((value) => value.completionTokens),
        reasoningTokens: sum((value) => value.reasoningTokens),
        totalTokens: sum((value) => value.totalTokens),
    };
};

const readPlanEnvelope = (
    value: Result | undefined
):
    | { plannerStepResult: PlannerStepResult; continuation?: PlanContinuation }
    | undefined => {
    const record = resultRecord(value);
    if (record === undefined) return undefined;
    const plannerStepResult = readAs<PlannerStepResult>(
        record.plannerStepResult
    );
    if (plannerStepResult === undefined) return undefined;
    return {
        plannerStepResult,
        continuation: readAs<PlanContinuation>(record.continuation),
    };
};

const readContinuePlanContinuation = (
    continuation: PlanContinuation | undefined
): ContinuePlanContinuation | undefined =>
    continuation?.continuation === 'continue_message'
        ? continuation
        : undefined;

const readGenerationResult = (
    value: Result | undefined
): GenerationResult | undefined => readAs<GenerationResult>(value);

type PresentationWorkflowResult = {
    draftResult?: GenerationResult;
    authoritativeOutputTokens?: number;
};

const readEvidenceEnvelope = (
    value: Result | undefined
): ModelInputEvidence => {
    const record = resultRecord(value);
    return {
        results: readAs<ContextStepResult[]>(record?.results) ?? [],
        failures: readAs<ContextStepManifestFailure[]>(record?.failures) ?? [],
    };
};

/** Executes the production reviewed-chat topology through `executeWorkflow`. */
export const runBoundedReviewWorkflow = async (
    input: RunBoundedReviewWorkflowInput
): Promise<RunBoundedReviewWorkflowResult> => {
    const {
        generationRuntime,
        generationRequest,
        messagesWithHints,
        contextEnvelope,
        generationStartedAtMs,
        workflowConfig,
        workflowPolicy,
        captureUsage,
        plannerStepRequest,
        plannerStepExecutor,
        planContinuationBuilder,
        contextStepRequests,
        contextStepExecutor,
        contextStepExecutorRegistry,
        stepRoutingChainSet,
        presentation,
    } = input;
    const normalizedMaxIterations = normalizeNonNegativeInteger(
        workflowConfig.maxIterations,
        0
    );
    const defaultDuration = normalizePositiveInteger(
        workflowConfig.maxDurationMs,
        15_000
    );
    const suppliedExecutionLimits = workflowConfig.executionLimits;
    const executionLimits: ExecutionLimits = {
        maxWorkflowSteps: normalizePositiveInteger(
            workflowConfig.executionLimits?.maxWorkflowSteps ??
                Math.max(1, normalizedMaxIterations * 2),
            Math.max(1, normalizedMaxIterations * 2)
        ),
        maxToolCalls: normalizeNonNegativeInteger(
            workflowConfig.executionLimits?.maxToolCalls ??
                UNBOUNDED_EXECUTION_LIMIT,
            UNBOUNDED_EXECUTION_LIMIT
        ),
        maxPlanCycles: normalizeNonNegativeInteger(
            workflowConfig.executionLimits?.maxPlanCycles ?? 1,
            1
        ),
        maxReviewCycles: normalizeNonNegativeInteger(
            suppliedExecutionLimits?.maxReviewCycles ??
                (suppliedExecutionLimits === undefined
                    ? Math.max(0, normalizedMaxIterations * 2 - 1)
                    : Math.max(
                          1,
                          (suppliedExecutionLimits.maxDeliberationCalls ??
                              Math.max(1, normalizedMaxIterations * 2)) -
                              (suppliedExecutionLimits.maxPlanCycles ?? 1)
                      )),
            suppliedExecutionLimits === undefined
                ? Math.max(0, normalizedMaxIterations * 2 - 1)
                : Math.max(
                      1,
                      (suppliedExecutionLimits.maxDeliberationCalls ??
                          Math.max(1, normalizedMaxIterations * 2)) -
                          (suppliedExecutionLimits.maxPlanCycles ?? 1)
                  )
        ),
        maxDeliberationCalls: normalizeNonNegativeInteger(
            workflowConfig.executionLimits?.maxDeliberationCalls ??
                Math.max(1, normalizedMaxIterations * 2),
            Math.max(1, normalizedMaxIterations * 2)
        ),
        maxTokensTotal: normalizeNonNegativeInteger(
            workflowConfig.executionLimits?.maxTokensTotal ??
                UNBOUNDED_EXECUTION_LIMIT,
            UNBOUNDED_EXECUTION_LIMIT
        ),
        maxDurationMs: normalizePositiveInteger(
            workflowConfig.executionLimits?.maxDurationMs ?? defaultDuration,
            defaultDuration
        ),
    };
    const effectiveMaxIterations = Math.max(
        0,
        Math.min(
            suppliedExecutionLimits === undefined
                ? normalizedMaxIterations
                : Math.ceil(executionLimits.maxDeliberationCalls / 2),
            executionLimits.maxReviewCycles ??
                Math.ceil(executionLimits.maxDeliberationCalls / 2),
            Math.ceil(Math.max(0, executionLimits.maxWorkflowSteps - 1) / 2)
        )
    );
    const workflowId = `wf_${generationStartedAtMs.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const initialContextRequests = contextStepRequests ?? [];
    const hasContextExecutor = initialContextRequests.some(
        (request) =>
            selectContextStepExecutor(
                request,
                contextStepExecutor,
                contextStepExecutorRegistry
            ) !== undefined
    );
    const hasPlannerStep =
        workflowPolicy.enablePlanning &&
        plannerStepRequest !== undefined &&
        plannerStepExecutor !== undefined;
    // Planner continuations can add context requests after the static topology
    // is built, so reserve the declared tool step when that late path is wired.
    const hasPlannerContextExecutor =
        workflowPolicy.enableToolUse &&
        hasPlannerStep &&
        planContinuationBuilder !== undefined &&
        (contextStepExecutor !== undefined ||
            Object.values(contextStepExecutorRegistry ?? {}).some(
                (executor) => executor !== undefined
            ));
    const hasToolStep =
        (initialContextRequests.some(
            (request) => request.requested && request.eligible
        ) &&
            hasContextExecutor) ||
        hasPlannerContextExecutor;
    const hasPresentationStep =
        presentation?.config.enabled === true &&
        workflowPolicy.enableGeneration !== false;
    const hasAssessmentStep =
        workflowPolicy.enableAssessment && effectiveMaxIterations > 0;
    const afterPlan = hasToolStep
        ? 'retrieve'
        : hasPresentationStep
          ? 'presentation'
          : workflowPolicy.enableGeneration === false
            ? 'finish'
            : 'generate';
    const start = hasPlannerStep ? 'plan' : afterPlan;
    const nextGenerate = hasAssessmentStep ? 'assess' : 'finish';
    const workflow: Workflow = {
        id: 'reviewed-chat',
        start,
        steps: {
            ...(hasPlannerStep && {
                plan: {
                    activity: { deliberation: 'plan' },
                    output: { name: 'plan', on: ['continue', 'terminal'] },
                    next: {
                        continue: afterPlan,
                        terminal: 'finish',
                        failed: 'defaultPlan',
                    },
                    maxIterations: 1,
                    maxAttempts: 2,
                },
                defaultPlan: {
                    activity: { deliberation: 'plan' },
                    output: { name: 'plan', on: ['continue'] },
                    next: { continue: afterPlan, failed: 'finish' },
                    maxIterations: 1,
                },
            }),
            ...(hasToolStep && {
                retrieve: {
                    input: hasPlannerStep ? [{ name: 'plan' }] : undefined,
                    output: {
                        name: 'evidence',
                        on: ['available', 'clarification'],
                    },
                    activity: { tool: 'one-or-more' },
                    next: {
                        available: hasPresentationStep
                            ? 'presentation'
                            : workflowPolicy.enableGeneration === false
                              ? 'finish'
                              : 'generate',
                        clarification: 'finish',
                        failed:
                            workflowPolicy.enableGeneration === false
                                ? 'finish'
                                : 'generate',
                    },
                    maxIterations: 1,
                },
            }),
            ...(hasPresentationStep && {
                presentation: {
                    input: [
                        ...(hasPlannerStep ? [{ name: 'plan' }] : []),
                        ...(hasToolStep
                            ? [{ name: 'evidence', optional: true }]
                            : []),
                    ],
                    output: { name: 'presentation', on: ['admitted'] },
                    countsAsWorkflowStep: 'successful',
                    next: {
                        admitted: 'generate',
                        skipped: 'generate',
                        failed: 'generate',
                    },
                    maxIterations: 1,
                },
            }),
            generate: {
                input: [
                    ...(hasPlannerStep
                        ? [{ name: 'plan', optional: true }]
                        : []),
                    ...(hasToolStep
                        ? [{ name: 'evidence', optional: true }]
                        : []),
                    ...(hasPresentationStep
                        ? [{ name: 'presentation', optional: true }]
                        : []),
                    { name: 'draft', optional: true },
                    ...(hasAssessmentStep
                        ? [
                              { name: 'review', optional: true },
                              { name: 'revisionPlan', optional: true },
                          ]
                        : []),
                ],
                output: { name: 'draft', on: ['generated', 'incomplete'] },
                next: {
                    generated: nextGenerate,
                    incomplete: 'finish',
                    failed: 'finish',
                },
                maxIterations: Math.max(1, effectiveMaxIterations + 1),
                maxAttempts: 2,
            },
            ...(hasAssessmentStep && {
                assess: {
                    input: [
                        { name: 'draft' },
                        ...(hasToolStep
                            ? [{ name: 'evidence', optional: true }]
                            : []),
                    ],
                    output: { name: 'review', on: ['done', 'revise', 'limit'] },
                    next: {
                        done: 'finish',
                        revise: workflowPolicy.enableRevision
                            ? 'replan'
                            : 'finish',
                        limit: 'finish',
                        failed: 'finish',
                    },
                    maxIterations: Math.max(1, effectiveMaxIterations),
                    maxAttempts: 2,
                    activity: { deliberation: 'review' },
                },
                replan: {
                    input: [
                        { name: 'plan', optional: !hasPlannerStep },
                        { name: 'draft' },
                        { name: 'review' },
                        { name: 'revisionPlan', optional: true },
                    ],
                    output: { name: 'revisionPlan', on: ['continue'] },
                    next: {
                        continue: 'generate',
                        skipped: 'generate',
                        failed: 'finish',
                    },
                    maxIterations: Math.max(1, effectiveMaxIterations),
                    maxAttempts: 2,
                    activity: hasPlannerStep
                        ? { deliberation: 'plan' }
                        : undefined,
                },
            }),
            finish: {
                input: [
                    { name: 'draft', optional: true },
                    ...(hasPlannerStep
                        ? [{ name: 'plan', optional: true }]
                        : []),
                    ...(hasToolStep
                        ? [{ name: 'evidence', optional: true }]
                        : []),
                ],
                // Finish is also the fail-open route for clarification and
                // unavailable generation, so it deliberately emits no Result.
                countsAsWorkflowStep: 'never',
                next: { done: null },
                maxIterations: 1,
            },
        },
    };

    const candidates = createResponseCandidateCollector();
    const baseContinuation = (
        resultValues: Readonly<Record<string, Result>>
    ): PlanContinuation | undefined => {
        const revision = readPlanEnvelope(resultValues.revisionPlan);
        const plan = readPlanEnvelope(resultValues.plan);
        return revision?.continuation ?? plan?.continuation;
    };
    const messagesFor = (
        resultValues: Readonly<Record<string, Result>>
    ): {
        request: GenerationRequest;
        messages: RuntimeMessage[];
        envelope: ConversationContextEnvelope;
    } => {
        const continuation = readContinuePlanContinuation(
            baseContinuation(resultValues)
        );
        const request = continuation?.generationRequest ?? generationRequest;
        const messages = continuation?.messagesWithHints ?? messagesWithHints;
        const envelope = continuation?.contextEnvelope ?? contextEnvelope;
        const evidence = readEvidenceEnvelope(resultValues.evidence);
        const plan =
            readPlanEnvelope(resultValues.revisionPlan) ??
            readPlanEnvelope(resultValues.plan);
        const projected = buildModelInput({
            baseRequest: request,
            context: { messages, envelope },
            results: {
                ...(plan?.continuation?.continuation === 'continue_message'
                    ? {
                          plan: {
                              plan: plan.continuation.plannerSummary
                                  .executionPlan,
                              ...(plan.continuation.plannerSummary
                                  .surfacePolicy === undefined
                                  ? {}
                                  : {
                                        surfacePolicy:
                                            plan.continuation.plannerSummary
                                                .surfacePolicy,
                                    }),
                          },
                      }
                    : {}),
                evidence,
            },
            contextStepRequests: mergeContextRequests(
                initialContextRequests,
                continuation?.contextStepRequests
            ),
            openAiNativeSearchFromHintsEnabled:
                input.openAiNativeSearchFromHintsEnabled,
        });
        return {
            request: projected,
            messages: projected.messages,
            envelope,
        };
    };

    const planHandler = async (
        handlerInput: StepHandlerInput<RunBoundedReviewWorkflowInput>
    ): Promise<AttemptResult> => {
        if (
            plannerStepExecutor === undefined ||
            plannerStepRequest === undefined
        ) {
            return {
                status: 'failed',
                errorCode: 'planner_unavailable',
                retryable: false,
            };
        }
        const startedAt = Date.now();
        try {
            const plannerResult = await plannerStepExecutor({
                ...plannerStepRequest,
                workflowId,
                workflowName: workflowConfig.workflowName,
                attempt: handlerInput.attempt,
                invocationContext: {
                    ...plannerStepRequest.invocationContext,
                    maxOutputTokens: Math.min(
                        DEFAULT_WORKFLOW_PLANNER_MAX_OUTPUT_TOKENS,
                        Math.max(
                            1,
                            executionLimits.maxTokensTotal >=
                                UNBOUNDED_EXECUTION_LIMIT
                                ? DEFAULT_WORKFLOW_PLANNER_MAX_OUTPUT_TOKENS
                                : Math.max(
                                      1,
                                      executionLimits.maxTokensTotal -
                                          handlerInput.execution.totalTokens -
                                          estimatePlannerInputTokens(
                                              plannerStepRequest.request
                                          )
                                  )
                        )
                    ),
                },
            });
            let continuation: PlanContinuation | undefined;
            if (planContinuationBuilder !== undefined) {
                try {
                    continuation = planContinuationBuilder({
                        plannerStepResult: plannerResult,
                        workflowId,
                        workflowName: workflowConfig.workflowName,
                        attempt: handlerInput.attempt,
                        baseMessagesWithHints: messagesWithHints,
                        baseGenerationRequest: generationRequest,
                        contextEnvelope,
                    });
                } catch (error) {
                    logger.warn(
                        'Plan continuation builder failed; using base generation input.',
                        {
                            workflowId,
                            workflowName: workflowConfig.workflowName,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        }
                    );
                }
            }
            const plannerUsage = plannerResult.execution.usage;
            return {
                status: 'succeeded',
                outcome:
                    continuation?.continuation === 'terminal_action'
                        ? 'terminal'
                        : 'continue',
                result: toSerializable({
                    plannerStepResult: plannerResult,
                    continuation,
                }),
                usage:
                    plannerUsage === undefined
                        ? undefined
                        : { totalTokens: plannerUsage.totalTokens },
                metadata: encodeMetadata({
                    status:
                        plannerResult.execution.status === 'failed'
                            ? 'failed'
                            : 'executed',
                    summary:
                        plannerResult.execution.status === 'failed'
                            ? 'Planner failed open to a backend-safe plan.'
                            : 'Planner selected the next declared workflow outcome.',
                    reasonCode: plannerResult.execution.reasonCode,
                    model: plannerResult.execution.model,
                    usage: plannerResult.execution.usage,
                    estimatedCost: plannerResult.execution.cost,
                    signals: {
                        action: plannerResult.plan.action,
                        purpose: plannerResult.execution.purpose,
                        contractType: plannerResult.execution.contractType,
                        applyOutcome:
                            plannerResult.ingestion.outputApplyOutcome ===
                            'accepted'
                                ? 'applied'
                                : plannerResult.ingestion.outputApplyOutcome ===
                                    'partially_applied'
                                  ? 'adjusted_by_policy'
                                  : 'not_applied',
                        ...(plannerResult.execution.structuredOutputOutcome !==
                        undefined
                            ? {
                                  structuredOutputOutcome:
                                      plannerResult.execution
                                          .structuredOutputOutcome,
                              }
                            : {}),
                        ...(plannerResult.execution.upstreamAttribution
                            ?.inferenceProvider !== undefined
                            ? {
                                  upstreamProvider:
                                      plannerResult.execution
                                          .upstreamAttribution
                                          .inferenceProvider,
                              }
                            : {}),
                        ...(plannerResult.execution.upstreamAttribution
                            ?.resolvedModel !== undefined
                            ? {
                                  upstreamModel:
                                      plannerResult.execution
                                          .upstreamAttribution.resolvedModel,
                              }
                            : {}),
                        ...(plannerResult.execution.reasonCode !== undefined
                            ? {
                                  plannerReasonCode:
                                      plannerResult.execution.reasonCode,
                              }
                            : {}),
                    },
                }),
            };
        } catch (error) {
            return {
                status: 'failed',
                errorCode: 'planner_runtime_error',
                errorMessage:
                    error instanceof Error ? error.message : String(error),
                retryable: true,
                metadata: encodeMetadata({
                    status: 'failed',
                    summary:
                        'Planner execution failed; workflow used the declared default-plan recovery route.',
                    reasonCode: 'planner_runtime_error',
                    terminationReason: 'executor_error_fail_open',
                    signals: {
                        durationMs: Math.max(0, Date.now() - startedAt),
                        purpose: 'chat_orchestrator_action_selection',
                        contractType: 'fallback',
                        applyOutcome: 'not_applied',
                    },
                }),
            };
        }
    };

    const defaultPlanHandler = async (): Promise<AttemptResult> => {
        const plannerResult = makePlanDefault();
        let continuation: PlanContinuation | undefined;
        if (
            planContinuationBuilder !== undefined &&
            plannerStepRequest !== undefined
        ) {
            try {
                continuation = planContinuationBuilder({
                    plannerStepResult: plannerResult,
                    workflowId,
                    workflowName: workflowConfig.workflowName,
                    attempt: 1,
                    baseMessagesWithHints: messagesWithHints,
                    baseGenerationRequest: generationRequest,
                    contextEnvelope,
                });
            } catch {
                continuation = undefined;
            }
        }
        return {
            status: 'succeeded',
            outcome: 'continue',
            result: toSerializable({
                plannerStepResult: plannerResult,
                continuation,
            }),
            metadata: encodeMetadata({
                status: 'failed',
                summary:
                    'Planner failed; workflow continued with the backend default plan.',
                reasonCode: 'planner_runtime_error',
                terminationReason: 'executor_error_fail_open',
                signals: {
                    purpose: 'chat_orchestrator_action_selection',
                    contractType: 'fallback',
                    applyOutcome: 'not_applied',
                },
            }),
        };
    };

    const toolHandler = async (
        handlerInput: StepHandlerInput<RunBoundedReviewWorkflowInput>
    ): Promise<AttemptResult> => {
        const plan = readPlanEnvelope(handlerInput.results.plan);
        const requests = mergeContextRequests(
            initialContextRequests,
            readContinuePlanContinuation(plan?.continuation)
                ?.contextStepRequests
        ).filter((request) => request.requested && request.eligible);
        const failures: ContextStepManifestFailure[] = [];
        const executable = requests.filter((request) => {
            const available =
                selectContextStepExecutor(
                    request,
                    contextStepExecutor,
                    contextStepExecutorRegistry
                ) !== undefined;
            if (!available) {
                failures.push({
                    integrationName: request.integrationName,
                    requested: request.requested,
                    status: 'unavailable',
                });
            }
            return available;
        });
        const runBatch = async (
            requests: ContextStepRequest[]
        ): Promise<
            Array<{
                request: ContextStepRequest;
                result?: ContextStepResult;
                error?: unknown;
            }>
        > =>
            Promise.all(
                requests.map(async (request) => {
                    const executor = selectContextStepExecutor(
                        request,
                        contextStepExecutor,
                        contextStepExecutorRegistry
                    );
                    if (executor === undefined) {
                        return {
                            request,
                            error: new Error('Context executor unavailable.'),
                        };
                    }
                    try {
                        return {
                            request,
                            result: await executor({
                                request,
                                workflowId,
                                workflowName: workflowConfig.workflowName,
                                attempt: handlerInput.attempt,
                            }),
                        };
                    } catch (error) {
                        return { request, error };
                    }
                })
            );
        const hasExplicitGitHubObject = executable.some(
            (request) =>
                request.integrationName === 'github_context' &&
                request.input?.reference !== undefined
        );
        const contextStepBatches = hasExplicitGitHubObject
            ? [
                  executable.filter(
                      (request) =>
                          request.integrationName === 'github_context' &&
                          request.input?.reference !== undefined
                  ),
                  executable.filter(
                      (request) =>
                          !(
                              request.integrationName === 'github_context' &&
                              request.input?.reference !== undefined
                          ) && request.integrationName !== 'web_search'
                  ),
                  executable.filter(
                      (request) => request.integrationName === 'web_search'
                  ),
              ]
            : [executable];
        const outcomes: Array<{
            request: ContextStepRequest;
            result?: ContextStepResult;
            error?: unknown;
        }> = [];
        for (const batch of contextStepBatches) {
            if (batch.length > 0) outcomes.push(...(await runBatch(batch)));
        }
        const evidenceResults: ContextStepResult[] = [];
        for (const outcome of outcomes) {
            if (outcome.result !== undefined)
                evidenceResults.push(outcome.result);
            if (outcome.error !== undefined) {
                failures.push({
                    integrationName: outcome.request.integrationName,
                    requested: outcome.request.requested,
                    status: 'failed',
                });
                logger.error(
                    'Context step execution failed; workflow continued fail-open.',
                    {
                        workflowId,
                        workflowName: workflowConfig.workflowName,
                        integrationName: outcome.request.integrationName,
                        error:
                            outcome.error instanceof Error
                                ? outcome.error.message
                                : String(outcome.error),
                    }
                );
            }
        }
        const clarification = evidenceResults.some(
            (result) => result.outcome === 'needs_clarification'
        );
        const clarificationResult = evidenceResults.find(
            (result) => result.outcome === 'needs_clarification'
        );
        const failedResult = evidenceResults.find(
            (result) => result.outcome === 'failed'
        );
        const evidenceArtifacts = evidenceResults.flatMap((result) =>
            result.outcome === 'executed'
                ? (result.evidence?.content ?? [])
                : []
        );
        const toolCalls = executable.length;
        return {
            status: 'succeeded',
            outcome: clarification ? 'clarification' : 'available',
            result: toSerializable({
                results: evidenceResults,
                failures,
            }),
            usage: { toolCalls },
            metadata: encodeMetadata({
                status:
                    clarification ||
                    (failedResult === undefined && failures.length === 0)
                        ? 'executed'
                        : 'failed',
                summary: clarification
                    ? 'Context step requires clarification before generation.'
                    : failedResult !== undefined || failures.length > 0
                      ? 'Context step failed; workflow continued fail-open without context.'
                      : 'Context steps completed; failed integrations were retained as unavailable evidence.',
                ...(failedResult?.executionContext.reasonCode !== undefined
                    ? { reasonCode: failedResult.executionContext.reasonCode }
                    : failures.length > 0
                      ? { reasonCode: 'tool_execution_error' as const }
                      : {}),
                ...(evidenceArtifacts.length === 0
                    ? {}
                    : { artifacts: evidenceArtifacts }),
                signals: clarification
                    ? {
                          clarification: true,
                          clarificationReasonCode:
                              clarificationResult?.outcome ===
                              'needs_clarification'
                                  ? clarificationResult.clarification.reasonCode
                                  : 'ambiguous_location',
                      }
                    : { contextStepCount: evidenceResults.length },
            }),
        };
    };

    const presentationHandler = async (
        handlerInput: StepHandlerInput<RunBoundedReviewWorkflowInput>
    ): Promise<AttemptResult> => {
        if (presentation === undefined) {
            return { status: 'succeeded', outcome: 'skipped' };
        }
        const projected = messagesFor(handlerInput.results);
        const authorityAdmissionRequest =
            boundGenerationRequestToWorkflowBudget({
                request: projected.request,
                totalTokens: handlerInput.execution.totalTokens,
                maxTokensTotal: executionLimits.maxTokensTotal,
            });
        // Presentation adds a second generation and copies its text into the
        // authoritative prompt. Use the ordinary bounded generation ceiling
        // for that handoff so a reasoning-aware 256k default cannot consume
        // the entire finite workflow allowance before the candidate runs.
        const requestedAuthorityOutputTokens = Math.min(
            authorityAdmissionRequest?.maxOutputTokens ??
                DEFAULT_WORKFLOW_GENERATION_MAX_OUTPUT_TOKENS,
            DEFAULT_WORKFLOW_GENERATION_MAX_OUTPUT_TOKENS
        );
        let effectiveAuthorityOutputTokens: number | undefined;
        const presentationRequest =
            executionLimits.maxTokensTotal >= UNBOUNDED_EXECUTION_LIMIT
                ? projected.request
                : authorityAdmissionRequest === undefined
                  ? undefined
                  : (() => {
                        const authorityPromptTokens =
                            estimateRuntimeMessageTokens(
                                authorityAdmissionRequest.messages
                            ) + 128;
                        const presentationPromptTokens =
                            estimateRuntimeMessageTokens(
                                projected.request.messages
                            ) + 128;
                        const authorityOutputTokens =
                            calculateReviewedGenerationOutputBudget({
                                totalTokens: handlerInput.execution.totalTokens,
                                maxTokensTotal: executionLimits.maxTokensTotal,
                                requestedOutputTokens:
                                    requestedAuthorityOutputTokens,
                                authoritativePromptTokens:
                                    authorityPromptTokens,
                                assessmentPromptTokensWithoutDraft:
                                    presentationPromptTokens,
                                assessmentOutputTokens:
                                    DEFAULT_WORKFLOW_ASSESSMENT_MAX_OUTPUT_TOKENS,
                            });
                        const resolvedAuthorityOutputTokens =
                            authorityOutputTokens ??
                            requestedAuthorityOutputTokens;
                        effectiveAuthorityOutputTokens =
                            resolvedAuthorityOutputTokens;
                        const budget = calculatePresentationOutputBudget({
                            totalTokens: handlerInput.execution.totalTokens,
                            maxTokensTotal: executionLimits.maxTokensTotal,
                            requestedCandidateOutputTokens:
                                resolvePresentationOutputMaxTokens({
                                    sourcePromptTokens:
                                        presentationPromptTokens,
                                    profileMaxOutputTokens:
                                        presentation.config.profile
                                            ?.maxOutputTokens,
                                }),
                            candidatePromptTokens: presentationPromptTokens,
                            authoritativePromptTokens: authorityPromptTokens,
                            authoritativeOutputTokens:
                                resolvedAuthorityOutputTokens,
                            assessmentPromptTokens:
                                presentationPromptTokens +
                                resolvedAuthorityOutputTokens,
                            assessmentOutputTokens:
                                DEFAULT_WORKFLOW_ASSESSMENT_MAX_OUTPUT_TOKENS,
                        });
                        return budget === undefined
                            ? undefined
                            : {
                                  ...projected.request,
                                  maxOutputTokens: budget.candidateOutputTokens,
                              };
                    })();
        const result =
            presentationRequest === undefined
                ? createPresentationFallback({
                      config: presentation.config,
                      persona: presentation.persona,
                      reasonCode: 'budget_skipped',
                      caution: presentation.caution,
                  })
                : await runPresentationCandidate({
                      generationRuntime,
                      generationRequest: presentationRequest,
                      config: presentation.config,
                      persona: presentation.persona,
                      caution: presentation.caution,
                  });
        const workflowResult: PresentationWorkflowResult = {
            ...result,
            ...(result.outcome === 'candidate_generated' &&
            effectiveAuthorityOutputTokens !== undefined
                ? { authoritativeOutputTokens: effectiveAuthorityOutputTokens }
                : {}),
        };
        let candidateId: string | undefined;
        let usage: GenerationResult['usage'] | undefined;
        let estimatedCost:
            ReviewWorkflowUsageSummary['estimatedCost'] | undefined;
        if (
            result.draftResult !== undefined &&
            presentation.config.profile !== undefined
        ) {
            const captured = presentation.captureUsage(
                result.draftResult,
                presentation.config.profile,
                'chat_presentation_draft'
            );
            usage = result.draftResult.usage;
            estimatedCost = captured.estimatedCost;
        }
        if (
            result.outcome === 'candidate_generated' &&
            result.draftResult !== undefined
        ) {
            candidateId = candidates.record({
                stage: 'presentation_draft',
                text: result.draftResult.text,
            });
        }
        const metadata = encodeMetadata({
            status:
                result.outcome === 'candidate_generated'
                    ? 'executed'
                    : 'skipped',
            summary:
                result.outcome === 'candidate_generated'
                    ? 'Generated a presentation candidate for authoritative wording.'
                    : 'Presentation candidate was unavailable; authoritative generation continued.',
            model: result.draftResult?.model,
            usage,
            estimatedCost,
            candidateId,
            presentation: result.metadata,
            signals: {
                presentationOutcome: result.metadata.outcome,
                presentationReasonCode: result.metadata.reasonCode,
                presentationAttempted: result.metadata.attempted,
                draftAttemptCount: result.metadata.draftAttemptCount,
                draftProfileId: result.metadata.draftProfileId ?? null,
            },
        });
        if (result.outcome !== 'candidate_generated') {
            return {
                status: 'failed',
                errorCode: 'presentation_unavailable',
                retryable: false,
                ...(usage === undefined
                    ? {}
                    : {
                          usage: {
                              totalTokens: usageForResult(
                                  result.draftResult as GenerationResult
                              ).totalTokens,
                          },
                      }),
                metadata,
            };
        }
        return {
            status: 'succeeded',
            outcome: 'admitted',
            ...(result.draftResult === undefined
                ? {}
                : { result: toSerializable(workflowResult) }),
            ...(usage === undefined
                ? {}
                : {
                      usage: {
                          totalTokens: usageForResult(
                              result.draftResult as GenerationResult
                          ).totalTokens,
                      },
                  }),
            metadata,
        };
    };

    const generationHandler = async (
        handlerInput: StepHandlerInput<RunBoundedReviewWorkflowInput>
    ): Promise<AttemptResult> => {
        if (workflowPolicy.enableGeneration === false) {
            return {
                status: 'failed',
                errorCode: 'generation_disabled',
                retryable: false,
                metadata: encodeMetadata({
                    status: 'failed',
                    summary:
                        'Generation was disabled by the resolved workflow profile.',
                    terminationReason: 'transition_blocked_by_policy',
                }),
            };
        }
        const projected = messagesFor(handlerInput.results);
        const previousDraft = readGenerationResult(handlerInput.results.draft);
        let request = projected.request;
        let refinementPromptResult:
            ReturnType<typeof composeRefinementPrompt> | undefined;
        let revisionHintLane: ReturnType<typeof decideRevisionRoutingHintLane> =
            decideRevisionRoutingHintLane([]);
        const refinementStepSignals = (): StepSignals =>
            refinementPromptResult === undefined
                ? {}
                : {
                      refinementApplied: true,
                      refinementSourceStepId: 'assess',
                      appliedModuleCount:
                          refinementPromptResult.appliedModuleIds.length,
                      ...(refinementPromptResult.appliedModuleIds.length > 0
                          ? {
                                appliedModuleIdsCsv:
                                    refinementPromptResult.appliedModuleIds.join(
                                        ','
                                    ),
                            }
                          : {}),
                      ...(revisionHintLane.lane !== 'none'
                          ? { routingHintApplied: revisionHintLane.lane }
                          : {}),
                      ...(revisionHintLane.conflictResolved === undefined
                          ? {}
                          : {
                                routingHintConflictResolved:
                                    revisionHintLane.conflictResolved,
                            }),
                  };
        if (previousDraft !== undefined) {
            const review = readAs<{ decision: ReviewDecision }>(
                handlerInput.results.review
            );
            refinementPromptResult = composeRefinementPrompt({
                revisionPromptPrefix:
                    input.revisionPromptPrefix ??
                    DEFAULT_REVISION_PROMPT_PREFIX,
                revisionInstruction: review?.decision.revisionInstruction,
                moduleIds:
                    review?.decision.moduleHints ?? input.reviewModuleIds,
                personaExpressionGuidance: input.personaExpressionGuidance,
            });
            const revisionHints =
                review === undefined
                    ? []
                    : extractRoutingHintsFromAssess({
                          assessRawText: JSON.stringify(review.decision),
                          reviewDecision: review.decision,
                      });
            revisionHintLane = decideRevisionRoutingHintLane(revisionHints);
            request = {
                ...request,
                messages: [
                    ...request.messages,
                    { role: 'assistant', content: previousDraft.text },
                    {
                        role: 'system',
                        content: refinementPromptResult.prompt,
                    },
                ],
            };
        }
        const presentationResult = readAs<PresentationWorkflowResult>(
            handlerInput.results.presentation
        );
        if (
            previousDraft === undefined &&
            presentationResult?.draftResult !== undefined
        ) {
            request = {
                ...buildAuthoritativeGenerationRequest(
                    request,
                    presentationResult.draftResult.text,
                    presentation?.persona.expressionGuidance ??
                        input.personaExpressionGuidance ??
                        '',
                    presentation?.config.handoffVariant
                ),
                ...(presentationResult.authoritativeOutputTokens === undefined
                    ? {}
                    : {
                          maxOutputTokens:
                              presentationResult.authoritativeOutputTokens,
                      }),
            };
        }
        const boundedRequest = boundGenerationRequestToWorkflowBudget({
            request,
            totalTokens: handlerInput.execution.totalTokens,
            maxTokensTotal: executionLimits.maxTokensTotal,
        });
        if (boundedRequest === undefined) {
            return {
                status: 'failed',
                errorCode: 'execution_limit',
                retryable: false,
                metadata: encodeMetadata({
                    status: 'failed',
                    summary:
                        'Generation was blocked by the cumulative token limit.',
                    reasonCode:
                        'budget_exhausted_tokens' as ExecutionReasonCode,
                    terminationReason: 'budget_exhausted_tokens',
                }),
            };
        }
        let generationResult: GenerationResult;
        const generationAttempts: GenerationResult[] = [];
        const generationAttemptsByIndex = new Map<number, GenerationResult>();
        let routingAttempts: RoutingChainAttemptLog[] | undefined;
        let selectedProfile: ModelProfile | undefined;
        try {
            const chainResult = stepRoutingChainSet?.generateCandidates.length
                ? await executeStepRoutingChain({
                      step: 'generate',
                      candidates:
                          previousDraft === undefined
                              ? stepRoutingChainSet.generateCandidates
                              : reorderRevisionCandidatesByHintLane({
                                    candidates:
                                        stepRoutingChainSet.generateCandidates,
                                    enabledProfilesById:
                                        stepRoutingChainSet.enabledProfilesById,
                                    lane: revisionHintLane.lane,
                                }),
                      enabledProfilesById:
                          stepRoutingChainSet.enabledProfilesById,
                      requiresSearch: boundedRequest.search !== undefined,
                      providerAvailability:
                          stepRoutingChainSet.providerAvailability,
                      runWithProfile: async (profile, attemptIndex) => {
                          const result = normalizeGenerationResultEvidence(
                              await generationRuntime.generate({
                                  ...capGenerationRequestToProfileMax({
                                      request: boundedRequest,
                                      profile,
                                  }),
                                  model: profile.providerModel,
                                  provider: profile.provider,
                                  capabilities: profile.capabilities,
                                  providerRouting: profile.providerRouting,
                                  reasoningEffort:
                                      resolveProfileReasoningEffort(
                                          profile,
                                          boundedRequest.reasoningEffort,
                                          logger
                                      ),
                              })
                          );
                          generationAttempts.push(result);
                          generationAttemptsByIndex.set(attemptIndex, result);
                          return result;
                      },
                      retryReasonCode: (result) => {
                          const admission = admitGenerationResult(result);
                          return admission.admitted
                              ? undefined
                              : admission.reasonCode;
                      },
                  })
                : undefined;
            const routed =
                chainResult === undefined
                    ? undefined
                    : toRoutingChainResult(chainResult);
            if (routed?.isErr()) {
                const lastAttempt = generationAttempts.at(-1);
                if (lastAttempt === undefined) {
                    return {
                        status: 'failed',
                        errorCode: routed.error.reasonCode,
                        retryable: false,
                        metadata: encodeMetadata({
                            status: 'failed',
                            summary:
                                'Generation routing failed; workflow returned the latest valid draft when available.',
                            reasonCode: routed.error.reasonCode,
                            terminationReason: 'executor_error_fail_open',
                            signals: {
                                ...refinementStepSignals(),
                                ...buildRoutingChainSignals({
                                    attempts: routed.error.attempts,
                                    selectedProfileId: null,
                                    signalKeys: {
                                        profileId: 'routedProfileId',
                                        provider: 'routedProvider',
                                        model: 'routedModel',
                                    },
                                }),
                            },
                        }),
                    };
                }
                generationResult = lastAttempt;
                routingAttempts = attachGenerationAttemptEvidence(
                    routed.error.attempts,
                    generationAttemptsByIndex
                );
            } else if (routed?.isOk()) {
                generationResult = routed.value.value;
                routingAttempts = attachGenerationAttemptEvidence(
                    routed.value.attempts,
                    generationAttemptsByIndex
                );
                selectedProfile = routed.value.selected.profile;
            } else {
                generationResult = normalizeGenerationResultEvidence(
                    await generationRuntime.generate(boundedRequest)
                );
                generationAttempts.push(generationResult);
            }
        } catch (error) {
            return {
                status: 'failed',
                errorCode: 'generation_runtime_error',
                errorMessage:
                    error instanceof Error ? error.message : String(error),
                retryable: false,
                metadata: encodeMetadata({
                    status: 'failed',
                    summary:
                        'Generation failed; workflow returned the latest valid draft when available.',
                    reasonCode: 'generation_runtime_error',
                    terminationReason: 'executor_error_fail_open',
                    signals: {
                        ...refinementStepSignals(),
                        ...(routingAttempts === undefined
                            ? {}
                            : buildRoutingChainSignals({
                                  attempts: routingAttempts,
                                  selectedProfileId:
                                      selectedProfile?.id ?? null,
                                  selectedProvider: selectedProfile?.provider,
                                  selectedModel: selectedProfile?.providerModel,
                              })),
                    },
                }),
            };
        }
        const usage = combineGenerationUsage(
            generationAttempts.map((attempt) =>
                captureUsage(attempt, boundedRequest.model)
            )
        );
        const generationAdmission = admitGenerationResult(generationResult);
        const admitted = generationAdmission.admitted;
        const parentCandidateId = candidates.latestCandidateId();
        const candidateId = !admitted
            ? undefined
            : candidates.record({
                  stage:
                      previousDraft === undefined
                          ? 'initial_generation'
                          : 'revision',
                  text: generationResult.text,
                  ...(parentCandidateId === undefined
                      ? {}
                      : { parentCandidateId }),
              });
        const metadata = encodeMetadata({
            status: admitted ? 'executed' : 'failed',
            summary: !admitted
                ? 'Generation result was rejected before candidate admission.'
                : previousDraft === undefined
                  ? 'Generated initial draft response.'
                  : 'Generated refinement draft from assessment guidance.',
            reasonCode: admitted ? undefined : generationAdmission.reasonCode,
            model: usage.model,
            usage: combineGenerationResultUsage(generationAttempts),
            estimatedCost: usage.estimatedCost,
            candidateId,
            terminationReason: !admitted
                ? 'executor_error_fail_open'
                : undefined,
            signals: {
                ...refinementStepSignals(),
                ...(routingAttempts === undefined
                    ? {}
                    : buildRoutingChainSignals({
                          attempts: routingAttempts,
                          selectedProfileId: selectedProfile?.id ?? null,
                          selectedProvider: selectedProfile?.provider,
                          selectedModel: selectedProfile?.providerModel,
                          signalKeys: {
                              profileId: 'routedProfileId',
                              provider: 'routedProvider',
                              model: 'routedModel',
                          },
                      })),
            },
        });
        if (!admitted) {
            return {
                status: 'failed',
                errorCode: generationAdmission.reasonCode,
                retryable: false,
                usage: { totalTokens: usage.totalTokens },
                metadata,
            };
        }
        return {
            status: 'succeeded',
            outcome: 'generated',
            result: toSerializable(generationResult),
            usage: { totalTokens: usage.totalTokens },
            metadata,
        };
    };

    const assessHandler = async (
        handlerInput: StepHandlerInput<RunBoundedReviewWorkflowInput>
    ): Promise<AttemptResult> => {
        const draft = readGenerationResult(handlerInput.results.draft);
        if (draft === undefined) {
            return {
                status: 'failed',
                errorCode: 'missing_draft',
                retryable: false,
                metadata: encodeMetadata({
                    status: 'failed',
                    summary:
                        'Assessment could not run because no valid draft existed.',
                    terminationReason: 'executor_error_fail_open',
                }),
            };
        }
        const projected = messagesFor(handlerInput.results);
        const assessPrompt = composeAssessPrompt({
            moduleIds: input.reviewModuleIds,
            basePromptOverride:
                input.reviewDecisionPrompt?.trim() ||
                DEFAULT_REVIEW_DECISION_PROMPT,
            personaExpressionGuidance: input.personaExpressionGuidance,
        });
        const request: GenerationRequest = {
            ...projected.request,
            messages: [
                ...projected.messages,
                { role: 'assistant', content: draft.text },
                { role: 'system', content: assessPrompt.prompt },
            ],
            maxOutputTokens: DEFAULT_WORKFLOW_ASSESSMENT_MAX_OUTPUT_TOKENS,
            reasoningEffort: 'low',
            verbosity: 'low',
        };
        const bounded = boundGenerationRequestToWorkflowBudget({
            request,
            totalTokens: handlerInput.execution.totalTokens,
            maxTokensTotal: executionLimits.maxTokensTotal,
        });
        if (bounded === undefined) {
            return {
                status: 'failed',
                errorCode: 'execution_limit',
                retryable: false,
                metadata: encodeMetadata({
                    status: 'failed',
                    summary:
                        'Assessment was blocked by the cumulative token limit; the latest draft was preserved.',
                    terminationReason: 'budget_exhausted_tokens',
                }),
            };
        }
        let reviewResult: GenerationResult;
        let routingAttempts: RoutingChainAttemptLog[] | undefined;
        let selectedProfile: ModelProfile | undefined;
        try {
            const chain = stepRoutingChainSet?.assessCandidates.length
                ? await executeStepRoutingChain({
                      step: 'assess',
                      candidates: stepRoutingChainSet.assessCandidates,
                      enabledProfilesById:
                          stepRoutingChainSet.enabledProfilesById,
                      requiresSearch: false,
                      providerAvailability:
                          stepRoutingChainSet.providerAvailability,
                      runWithProfile: async (profile) =>
                          generationRuntime.generate({
                              ...capGenerationRequestToProfileMax({
                                  request: bounded,
                                  profile,
                              }),
                              model: profile.providerModel,
                              provider: profile.provider,
                              capabilities: profile.capabilities,
                              providerRouting: profile.providerRouting,
                              reasoningEffort: resolveProfileReasoningEffort(
                                  profile,
                                  request.reasoningEffort,
                                  logger
                              ),
                          }),
                  })
                : undefined;
            const routed =
                chain === undefined ? undefined : toRoutingChainResult(chain);
            if (routed?.isErr()) {
                return {
                    status: 'failed',
                    errorCode: routed.error.reasonCode,
                    retryable: false,
                    metadata: encodeMetadata({
                        status: 'failed',
                        summary:
                            'Assessment routing failed; the latest valid draft was preserved.',
                        reasonCode: routed.error.reasonCode,
                        terminationReason: 'executor_error_fail_open',
                        signals: buildRoutingChainSignals({
                            attempts: routed.error.attempts,
                            selectedProfileId: null,
                        }),
                    }),
                };
            }
            if (routed?.isOk()) {
                reviewResult = routed.value.value;
                routingAttempts = routed.value.attempts;
                selectedProfile = routed.value.selected.profile;
            } else {
                reviewResult = await generationRuntime.generate(bounded);
            }
        } catch (error) {
            return {
                status: 'failed',
                errorCode: 'assessment_runtime_error',
                errorMessage:
                    error instanceof Error ? error.message : String(error),
                retryable: false,
                metadata: encodeMetadata({
                    status: 'failed',
                    summary:
                        'Assessment failed; the latest valid draft was preserved.',
                    reasonCode: 'generation_runtime_error',
                    terminationReason: 'executor_error_fail_open',
                }),
            };
        }
        const usage = captureUsage(reviewResult, bounded.model);
        const parsed = (
            input.parseReviewDecision ?? parseReviewDecisionOutputResult
        )(reviewResult.text);
        if (parsed.isErr()) {
            return {
                status: 'failed',
                errorCode: 'review_parse_error',
                retryable: false,
                usage: { totalTokens: usage.totalTokens },
                metadata: encodeMetadata({
                    status: 'failed',
                    summary:
                        'Assessment returned invalid decision output; the latest valid draft was preserved.',
                    reasonCode: 'generation_runtime_error',
                    model: usage.model,
                    usage: reviewResult.usage,
                    estimatedCost: usage.estimatedCost,
                    terminationReason: 'executor_error_fail_open',
                    signals: {
                        ...buildWorkflowReviewParseFailureSignals(parsed.error),
                        ...(routingAttempts === undefined
                            ? {}
                            : buildRoutingChainSignals({
                                  attempts: routingAttempts,
                                  selectedProfileId:
                                      selectedProfile?.id ?? null,
                                  selectedProvider: selectedProfile?.provider,
                                  selectedModel: selectedProfile?.providerModel,
                              })),
                    },
                }),
            };
        }
        const decision = parsed.value;
        const hints = extractRoutingHintsFromAssess({
            assessRawText: reviewResult.text,
            reviewDecision: decision,
        });
        const hintDecision = decideRevisionRoutingHintLane(hints);
        const signals: StepSignals = {
            ...buildAssessSignals(decision),
            ...buildAssessRoutingHintSignals({
                assessRoutingHintsCsv:
                    hints.length > 0 ? hints.join(',') : undefined,
                routingHintApplied: hintDecision.lane,
                routingHintConflictResolved: hintDecision.conflictResolved,
            }),
            ...(routingAttempts === undefined
                ? {}
                : buildRoutingChainSignals({
                      attempts: routingAttempts,
                      selectedProfileId: selectedProfile?.id ?? null,
                      selectedProvider: selectedProfile?.provider,
                      selectedModel: selectedProfile?.providerModel,
                  })),
        };
        const outcome =
            decision.reviewDecision === 'finalize'
                ? 'done'
                : handlerInput.iteration >= effectiveMaxIterations
                  ? 'limit'
                  : 'revise';
        return {
            status: 'succeeded',
            outcome,
            result: toSerializable({ decision }),
            usage: { totalTokens: usage.totalTokens },
            metadata: encodeMetadata({
                status: 'executed',
                summary:
                    'Assessment evaluated draft quality and emitted a declared workflow outcome.',
                model: usage.model,
                usage: reviewResult.usage,
                estimatedCost: usage.estimatedCost,
                signals,
                ...(decision.reviewDecision === 'revise' &&
                !workflowPolicy.enableRevision
                    ? {
                          terminationReason:
                              'transition_blocked_by_policy' as const,
                      }
                    : {}),
                ...(outcome === 'limit'
                    ? { terminationReason: 'budget_exhausted_steps' as const }
                    : {}),
            }),
        };
    };

    const replanHandler = async (
        handlerInput: StepHandlerInput<RunBoundedReviewWorkflowInput>
    ): Promise<AttemptResult> => {
        if (
            plannerStepRequest === undefined ||
            plannerStepExecutor === undefined ||
            planContinuationBuilder === undefined
        ) {
            return {
                status: 'succeeded',
                outcome: 'skipped',
                metadata: encodeMetadata({
                    status: 'skipped',
                    summary:
                        'Planner re-entry was not configured; refinement used the prior plan.',
                }),
            };
        }
        const review = readAs<{ decision: ReviewDecision }>(
            handlerInput.results.review
        );
        const prior = readContinuePlanContinuation(
            baseContinuation(handlerInput.results)
        );
        if (review?.decision === undefined) {
            return {
                status: 'failed',
                errorCode: 'missing_review',
                retryable: false,
                metadata: encodeMetadata({
                    status: 'failed',
                    summary:
                        'Planner re-entry could not run without a review decision.',
                    terminationReason: 'executor_error_fail_open',
                }),
            };
        }
        try {
            const plannerResult = await plannerStepExecutor({
                ...plannerStepRequest,
                workflowId,
                workflowName: workflowConfig.workflowName,
                attempt: handlerInput.iteration + 1,
                invocationContext: {
                    ...plannerStepRequest.invocationContext,
                    maxOutputTokens: Math.min(
                        DEFAULT_WORKFLOW_PLANNER_MAX_OUTPUT_TOKENS,
                        Math.max(
                            1,
                            executionLimits.maxTokensTotal >=
                                UNBOUNDED_EXECUTION_LIMIT
                                ? DEFAULT_WORKFLOW_PLANNER_MAX_OUTPUT_TOKENS
                                : Math.max(
                                      1,
                                      executionLimits.maxTokensTotal -
                                          handlerInput.execution.totalTokens -
                                          estimatePlannerInputTokens(
                                              plannerStepRequest.request
                                          )
                                  )
                        )
                    ),
                },
            });
            const continuation = planContinuationBuilder({
                plannerStepResult: plannerResult,
                workflowId,
                workflowName: workflowConfig.workflowName,
                attempt: handlerInput.iteration + 1,
                baseMessagesWithHints:
                    prior?.messagesWithHints ?? messagesWithHints,
                baseGenerationRequest:
                    prior?.generationRequest ?? generationRequest,
                contextEnvelope: prior?.contextEnvelope ?? contextEnvelope,
            });
            if (continuation.continuation !== 'continue_message') {
                return {
                    status: 'failed',
                    errorCode: 'planner_terminal_reentry',
                    retryable: false,
                    metadata: encodeMetadata({
                        status: 'failed',
                        summary:
                            'Planner re-entry produced a terminal action during revision; prior draft was preserved.',
                        terminationReason: 'executor_error_fail_open',
                    }),
                };
            }
            return {
                status: 'succeeded',
                outcome: 'continue',
                result: toSerializable({
                    plannerStepResult: plannerResult,
                    continuation,
                }),
                usage:
                    plannerResult.execution.usage === undefined
                        ? undefined
                        : {
                              totalTokens:
                                  plannerResult.execution.usage.totalTokens,
                          },
                metadata: encodeMetadata({
                    status:
                        plannerResult.execution.status === 'failed'
                            ? 'failed'
                            : 'executed',
                    summary:
                        'Planner re-entry produced the declared refinement plan.',
                    reasonCode: plannerResult.execution.reasonCode,
                    model: plannerResult.execution.model,
                    usage: plannerResult.execution.usage,
                    estimatedCost: plannerResult.execution.cost,
                    signals: {
                        purpose: plannerResult.execution.purpose,
                        contractType: plannerResult.execution.contractType,
                        applyOutcome:
                            plannerResult.ingestion.outputApplyOutcome ===
                            'accepted'
                                ? 'applied'
                                : plannerResult.ingestion.outputApplyOutcome ===
                                    'partially_applied'
                                  ? 'adjusted_by_policy'
                                  : 'not_applied',
                        ...(plannerResult.execution.structuredOutputOutcome !==
                        undefined
                            ? {
                                  structuredOutputOutcome:
                                      plannerResult.execution
                                          .structuredOutputOutcome,
                              }
                            : {}),
                        ...(plannerResult.execution.upstreamAttribution
                            ?.inferenceProvider !== undefined
                            ? {
                                  upstreamProvider:
                                      plannerResult.execution
                                          .upstreamAttribution
                                          .inferenceProvider,
                              }
                            : {}),
                        ...(plannerResult.execution.upstreamAttribution
                            ?.resolvedModel !== undefined
                            ? {
                                  upstreamModel:
                                      plannerResult.execution
                                          .upstreamAttribution.resolvedModel,
                              }
                            : {}),
                    },
                }),
            };
        } catch (error) {
            return {
                status: 'failed',
                errorCode: 'planner_runtime_error',
                errorMessage:
                    error instanceof Error ? error.message : String(error),
                retryable: false,
                metadata: encodeMetadata({
                    status: 'failed',
                    summary:
                        'Planner re-entry failed; the latest valid draft was preserved.',
                    reasonCode: 'planner_runtime_error',
                    terminationReason: 'executor_error_fail_open',
                    signals: {
                        purpose: 'chat_orchestrator_action_selection',
                        contractType: 'fallback',
                        applyOutcome: 'not_applied',
                    },
                }),
            };
        }
    };

    const finishHandler = async (
        handlerInput: StepHandlerInput<RunBoundedReviewWorkflowInput>
    ): Promise<AttemptResult> => {
        const draft = readGenerationResult(handlerInput.results.draft);
        return {
            status: 'succeeded',
            outcome: 'done',
            metadata: encodeMetadata({
                status: 'executed',
                summary:
                    draft === undefined
                        ? 'Workflow finished without a generated draft.'
                        : 'Workflow finalized the latest valid draft.',
            }),
        };
    };

    const handlers: Record<
        string,
        (
            handlerInput: StepHandlerInput<RunBoundedReviewWorkflowInput>
        ) => Promise<AttemptResult>
    > = {
        ...(hasPlannerStep
            ? { plan: planHandler, defaultPlan: defaultPlanHandler }
            : {}),
        ...(hasToolStep ? { retrieve: toolHandler } : {}),
        ...(hasPresentationStep ? { presentation: presentationHandler } : {}),
        generate: generationHandler,
        ...(hasAssessmentStep
            ? { assess: assessHandler, replan: replanHandler }
            : {}),
        finish: finishHandler,
    };
    const reserveAttempt = (
        handlerInput: StepHandlerInput<RunBoundedReviewWorkflowInput>
    ): { tokens?: number; toolCalls?: number } | undefined => {
        const step = handlerInput.stepId;
        if (step === 'finish') return { tokens: 0 };
        if (step === 'retrieve') {
            const requests = mergeContextRequests(
                initialContextRequests,
                readContinuePlanContinuation(
                    readPlanEnvelope(handlerInput.results.plan)?.continuation
                )?.contextStepRequests
            ).filter((request) => request.requested && request.eligible);
            return { toolCalls: requests.length };
        }
        if (step === 'plan' || step === 'replan') {
            if (executionLimits.maxTokensTotal >= UNBOUNDED_EXECUTION_LIMIT)
                return undefined;
            const output = Math.min(
                DEFAULT_WORKFLOW_PLANNER_MAX_OUTPUT_TOKENS,
                Math.max(
                    1,
                    executionLimits.maxTokensTotal -
                        handlerInput.execution.totalTokens -
                        estimatePlannerInputTokens(
                            plannerStepRequest?.request ?? {
                                surface: 'web',
                                trigger: { kind: 'submit' },
                                latestUserInput: '',
                                conversation: [],
                            }
                        )
                )
            );
            return {
                tokens: estimatePlannerTokenBudget({
                    request: plannerStepRequest?.request ?? {
                        surface: 'web',
                        trigger: { kind: 'submit' },
                        latestUserInput: '',
                        conversation: [],
                    },
                    maxOutputTokens: output,
                }),
            };
        }
        if (step === 'generate' || step === 'assess') {
            const projected = messagesFor(handlerInput.results);
            const request =
                step === 'assess'
                    ? {
                          ...projected.request,
                          messages: [
                              ...projected.messages,
                              {
                                  role: 'assistant' as const,
                                  content:
                                      readGenerationResult(
                                          handlerInput.results.draft
                                      )?.text ?? '',
                              },
                              {
                                  role: 'system' as const,
                                  content:
                                      input.reviewDecisionPrompt?.trim() ||
                                      DEFAULT_REVIEW_DECISION_PROMPT,
                              },
                          ],
                          maxOutputTokens:
                              DEFAULT_WORKFLOW_ASSESSMENT_MAX_OUTPUT_TOKENS,
                      }
                    : projected.request;
            if (step === 'generate') {
                const presentationResult = readAs<PresentationWorkflowResult>(
                    handlerInput.results.presentation
                );
                if (
                    readGenerationResult(handlerInput.results.draft) ===
                        undefined &&
                    presentationResult?.draftResult !== undefined
                ) {
                    const authoritativeRequest =
                        buildAuthoritativeGenerationRequest(
                            request,
                            presentationResult.draftResult.text,
                            presentation?.persona.expressionGuidance ??
                                input.personaExpressionGuidance ??
                                '',
                            presentation?.config.handoffVariant
                        );
                    request.messages = authoritativeRequest.messages;
                    if (
                        presentationResult.authoritativeOutputTokens !==
                        undefined
                    ) {
                        request.maxOutputTokens =
                            presentationResult.authoritativeOutputTokens;
                    }
                }
            }
            const bounded = boundGenerationRequestToWorkflowBudget({
                request,
                totalTokens: handlerInput.execution.totalTokens,
                maxTokensTotal: executionLimits.maxTokensTotal,
            });
            return bounded === undefined
                ? {
                      tokens: Math.max(
                          1,
                          executionLimits.maxTokensTotal -
                              handlerInput.execution.totalTokens +
                              1
                      ),
                  }
                : { tokens: estimateGenerationTokenBudget(bounded) };
        }
        return undefined;
    };

    const executeInput: ExecuteInput<RunBoundedReviewWorkflowInput> = {
        workflow,
        context: input,
        handlers,
        executionLimits,
        runId: workflowId,
        startedAtMs: generationStartedAtMs,
        now: () => Date.now(),
        reserveAttempt,
    };
    const execution = await executeWorkflow(executeInput);
    const lastMetadata = [...execution.run.steps]
        .reverse()
        .flatMap((step) => [...step.attempts].reverse())
        .map((attempt) => readAs<ChatStepMetadata>(attempt.metadata))
        .find(
            (metadata) =>
                metadata !== undefined &&
                metadata.terminationReason !== undefined
        );
    const admissionLimit = execution.run.steps
        .flatMap((step) =>
            step.attempts.map((attempt) => ({
                stepId: step.stepId,
                limit: attempt.exhaustedLimit,
            }))
        )
        .find((attempt) => attempt.limit !== undefined);
    const genericLimit =
        execution.termination.reason === 'execution_limit'
            ? execution.termination.limit
            : admissionLimit?.limit;
    const exhaustedLimitKey =
        genericLimit ??
        (lastMetadata?.terminationReason === 'budget_exhausted_tokens'
            ? 'maxTokensTotal'
            : lastMetadata?.terminationReason === 'budget_exhausted_steps'
              ? 'maxWorkflowSteps'
              : undefined);
    const terminationReason: WorkflowTerminationReason =
        genericLimit === 'maxWorkflowSteps' ||
        lastMetadata?.terminationReason === 'budget_exhausted_steps'
            ? 'budget_exhausted_steps'
            : genericLimit === 'maxTokensTotal' ||
                lastMetadata?.terminationReason === 'budget_exhausted_tokens'
              ? 'budget_exhausted_tokens'
              : genericLimit === 'maxDurationMs'
                ? 'budget_exhausted_time'
                : genericLimit === 'maxToolCalls'
                  ? 'max_tool_calls_reached'
                  : genericLimit === 'maxDeliberationCalls'
                    ? 'max_deliberation_calls_reached'
                    : (lastMetadata?.terminationReason ??
                      (workflowPolicy.enableGeneration === false
                          ? 'transition_blocked_by_policy'
                          : 'goal_satisfied'));
    const hiddenPresentationStep =
        hasPresentationStep &&
        !execution.run.results.presentation &&
        execution.run.steps.some((step) => step.stepId === 'presentation');
    const providerExceededTokenLimit =
        genericLimit === 'maxTokensTotal' &&
        execution.run.usage.totalTokens > executionLimits.maxTokensTotal;
    const limitStepIndex =
        admissionLimit === undefined
            ? -1
            : execution.run.steps.findIndex((step) =>
                  step.attempts.some(
                      (attempt) => attempt.exhaustedLimit !== undefined
                  )
              );
    const lastExecutedStepId =
        limitStepIndex >= 0
            ? execution.run.steps[limitStepIndex - 1]?.stepId
            : execution.run.steps.at(-1)?.stepId;
    const blockedStepKind =
        admissionLimit === undefined
            ? undefined
            : workflowStepKind(admissionLimit.stepId);
    const stoppedBeforeStepKind =
        lastMetadata?.terminationReason === 'budget_exhausted_steps'
            ? 'generate'
            : genericLimit === undefined || providerExceededTokenLimit
              ? undefined
              : genericLimit === 'maxTokensTotal' &&
                  lastExecutedStepId === 'generate'
                ? hasAssessmentStep
                    ? 'assess'
                    : 'finalize'
                : lastExecutedStepId === undefined
                  ? blockedStepKind
                  : workflowStepKind(lastExecutedStepId);
    const workflowLineage = buildWorkflowLineage({
        execution,
        workflowName: workflowConfig.workflowName,
        maxDurationMs: executionLimits.maxDurationMs,
        executionLimits,
        workflowPolicy,
        terminationReason,
        exhaustedLimitKey,
        stoppedBeforeStepKind,
        hiddenPresentationStep,
        preExistingPlannerStep: input.plannerStepRecord,
    });
    const semanticExecutionSteps = execution.run.steps.filter(
        (step) =>
            step.stepId !== 'finish' &&
            !(hiddenPresentationStep && step.stepId === 'presentation') &&
            !suppressAdmissionBlockedStep(step)
    );
    const lineageOffset = input.plannerStepRecord === undefined ? 0 : 1;
    semanticExecutionSteps.forEach((step, index) => {
        const candidateId = [...step.attempts]
            .reverse()
            .map(
                (attempt) =>
                    readAs<ChatStepMetadata>(attempt.metadata)?.candidateId
            )
            .find((value): value is string => value !== undefined);
        const lineageStep = workflowLineage.steps[index + lineageOffset];
        if (candidateId !== undefined && lineageStep !== undefined) {
            candidates.linkToWorkflowStep(candidateId, lineageStep.stepId);
        }
    });
    const plan = readPlanEnvelope(execution.run.results.plan);
    const revisionPlan = readPlanEnvelope(execution.run.results.revisionPlan);
    const continuation = revisionPlan?.continuation ?? plan?.continuation;
    const evidence = readEvidenceEnvelope(execution.run.results.evidence);
    const presentationMetadata = [...execution.run.steps]
        .reverse()
        .flatMap((step) => step.attempts)
        .map(
            (attempt) =>
                readAs<ChatStepMetadata>(attempt.metadata)?.presentation
        )
        .find(
            (metadata): metadata is PresentationMetadata =>
                metadata !== undefined
        );
    const terminalAction =
        continuation?.continuation === 'terminal_action'
            ? continuation.terminalAction
            : undefined;
    const generationResult =
        readGenerationResult(execution.run.results.answer) ??
        readGenerationResult(execution.run.results.draft);
    const plannerStepResult = plan?.plannerStepResult;
    const contextStepResult = evidence.results.at(0);
    if (terminalAction !== undefined) {
        return {
            outcome: 'terminal_action',
            terminalAction,
            workflowLineage,
            ...(plannerStepResult === undefined ? {} : { plannerStepResult }),
            ...(continuation === undefined
                ? {}
                : { planContinuation: continuation }),
            ...(contextStepResult === undefined ? {} : { contextStepResult }),
            ...(evidence.results.length === 0
                ? {}
                : { contextStepResults: [...evidence.results] }),
        };
    }
    if (generationResult === undefined) {
        return {
            outcome: 'no_generation',
            workflowLineage,
            ...(presentationMetadata === undefined
                ? {}
                : { presentation: presentationMetadata }),
            ...(plannerStepResult === undefined ? {} : { plannerStepResult }),
            ...(continuation === undefined
                ? {}
                : { planContinuation: continuation }),
            ...(contextStepResult === undefined ? {} : { contextStepResult }),
            ...(evidence.results.length === 0
                ? {}
                : { contextStepResults: [...evidence.results] }),
        };
    }
    const selectedCandidateId = semanticExecutionSteps
        .filter((step) => step.stepId === 'generate')
        .reverse()
        .flatMap((step) => [...step.attempts].reverse())
        .map(
            (attempt) => readAs<ChatStepMetadata>(attempt.metadata)?.candidateId
        )
        .find((value): value is string => value !== undefined);
    if (selectedCandidateId !== undefined) {
        candidates.markSelected(selectedCandidateId);
    }
    return {
        outcome: 'generated',
        generationResult,
        workflowLineage,
        responseCandidates: candidates.finalize(),
        ...(presentationMetadata === undefined
            ? {}
            : { presentation: presentationMetadata }),
        ...(plannerStepResult === undefined ? {} : { plannerStepResult }),
        ...(continuation === undefined
            ? {}
            : { planContinuation: continuation }),
        ...(contextStepResult === undefined ? {} : { contextStepResult }),
        ...(evidence.results.length === 0
            ? {}
            : { contextStepResults: [...evidence.results] }),
    };
};

export { activityForWorkflowStep };
export type { BuildPlannerStepRecordInput } from '../workflowEngine/plannerStepRecord.js';
export { buildPlannerStepRecord } from '../workflowEngine/plannerStepRecord.js';
export {
    DEFAULT_REVIEW_DECISION_PROMPT,
    DEFAULT_REVISION_PROMPT_PREFIX,
    parseReviewDecisionOutputResult,
};
