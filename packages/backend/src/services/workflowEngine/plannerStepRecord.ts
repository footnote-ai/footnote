/**
 * @description: Maps planner execution summaries into bounded workflow lineage
 * step records.
 * @footnote-scope: core
 * @footnote-module: WorkflowEnginePlannerStepRecord
 * @footnote-risk: medium - Incorrect mapping can corrupt lineage diagnostics.
 * @footnote-ethics: medium - Accurate lineage is required for governance review.
 */
import type {
    ExecutionReasonCode,
    ExecutionStatus,
    PlannerExecutionApplyOutcome,
    PlannerExecutionContractType,
    PlannerExecutionPurpose,
    PlannerStructuredOutputOutcome,
    StepRecord,
    StepSignals,
    WorkflowPlannerAction,
    WorkflowPlannerModality,
    WorkflowPlannerStepSignals,
    WorkflowRoutingChainAttemptSignal,
    WorkflowRoutingChainSignals,
} from '@footnote/contracts/policy';
import { buildWorkflowRoutingChainSignals } from '@footnote/contracts/policy';

type PlannerStepRecordSummary = {
    status: ExecutionStatus;
    reasonCode?: ExecutionReasonCode;
    purpose: PlannerExecutionPurpose;
    contractType: PlannerExecutionContractType;
    applyOutcome: PlannerExecutionApplyOutcome;
    durationMs?: number;
    action?: WorkflowPlannerAction;
    modality?: WorkflowPlannerModality;
    requestedCapabilityProfile?: string;
    selectedCapabilityProfile?: string;
    profileId?: string;
    originalProfileId?: string;
    effectiveProfileId?: string;
    provider?: string;
    model?: string;
    usage?: StepRecord['usage'];
    cost?: StepRecord['cost'];
    mattered?: boolean;
    matteredControlIds?: string[];
    routingChainAttempts?: WorkflowRoutingChainAttemptSignal[];
    structuredOutputOutcome?: PlannerStructuredOutputOutcome;
    upstreamAttribution?: {
        resolvedModel?: string;
        inferenceProvider?: string;
        routingAttempt?: number;
        routingAttemptCount?: number;
        upstreamReportedCostUsd?: number;
    };
};

export type BuildPlannerStepRecordInput = {
    stepId: string;
    attempt: number;
    parentStepId?: string;
    startedAtMs?: number;
    finishedAtMs: number;
    summary: PlannerStepRecordSummary;
};

const toNonNegativeIntegerOrZero = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 0;
    }

    return Math.max(0, Math.floor(value));
};

const toNonNegativeNumberOrUndefined = (value: unknown): number | undefined => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return undefined;
    }

    return value;
};

const isPlannerReasonCode = (
    value: unknown
): value is Extract<
    ExecutionReasonCode,
    'planner_runtime_error' | 'planner_invalid_output'
> => value === 'planner_runtime_error' || value === 'planner_invalid_output';

export const buildPlannerStepRecord = ({
    stepId,
    attempt,
    parentStepId,
    startedAtMs,
    finishedAtMs,
    summary,
}: BuildPlannerStepRecordInput): StepRecord => {
    const coercedFinishedAtMs = Number(finishedAtMs);
    const normalizedFinishedAtMs = Number.isFinite(coercedFinishedAtMs)
        ? Math.floor(coercedFinishedAtMs)
        : Date.now();
    const coercedStartedAtMs = Number(startedAtMs);
    const normalizedDurationMs = Number.isFinite(coercedStartedAtMs)
        ? Math.max(
              0,
              Math.floor(
                  normalizedFinishedAtMs - Math.floor(coercedStartedAtMs)
              )
          )
        : toNonNegativeIntegerOrZero(summary.durationMs);
    const normalizedStartedAtMs = normalizedFinishedAtMs - normalizedDurationMs;
    const normalizedAttempt = Number.isFinite(Number(attempt))
        ? Math.max(1, Math.floor(Number(attempt)))
        : 1;
    const sanitizedReasonCode = isPlannerReasonCode(summary.reasonCode)
        ? summary.reasonCode
        : undefined;

    const signals: WorkflowPlannerStepSignals &
        StepSignals &
        Partial<WorkflowRoutingChainSignals> = {
        applyOutcome: summary.applyOutcome,
        purpose: summary.purpose,
        contractType: summary.contractType,
        ...(summary.action !== undefined && { action: summary.action }),
        ...(summary.modality !== undefined && { modality: summary.modality }),
        ...(summary.requestedCapabilityProfile !== undefined && {
            requestedCapabilityProfile: summary.requestedCapabilityProfile,
        }),
        ...(summary.selectedCapabilityProfile !== undefined && {
            selectedCapabilityProfile: summary.selectedCapabilityProfile,
        }),
        ...(summary.profileId !== undefined && {
            profileId: summary.profileId,
        }),
        ...(summary.originalProfileId !== undefined && {
            originalProfileId: summary.originalProfileId,
        }),
        ...(summary.effectiveProfileId !== undefined && {
            effectiveProfileId: summary.effectiveProfileId,
        }),
        ...(summary.provider !== undefined && { provider: summary.provider }),
        ...(summary.structuredOutputOutcome !== undefined && {
            structuredOutputOutcome: summary.structuredOutputOutcome,
        }),
        ...(summary.upstreamAttribution?.inferenceProvider !== undefined && {
            upstreamProvider: summary.upstreamAttribution.inferenceProvider,
        }),
        ...(summary.upstreamAttribution?.resolvedModel !== undefined && {
            upstreamModel: summary.upstreamAttribution.resolvedModel,
        }),
        ...(summary.upstreamAttribution?.routingAttempt !== undefined && {
            upstreamRoutingAttempt: summary.upstreamAttribution.routingAttempt,
        }),
        ...(summary.upstreamAttribution?.routingAttemptCount !== undefined && {
            upstreamRoutingAttemptCount:
                summary.upstreamAttribution.routingAttemptCount,
        }),
        ...(summary.upstreamAttribution?.upstreamReportedCostUsd !==
            undefined && {
            upstreamReportedCostUsd:
                summary.upstreamAttribution.upstreamReportedCostUsd,
        }),
        ...(summary.mattered !== undefined && { mattered: summary.mattered }),
        ...(Array.isArray(summary.matteredControlIds) && {
            matteredControlCount: summary.matteredControlIds.length,
        }),
        ...buildWorkflowRoutingChainSignals({
            attempts: summary.routingChainAttempts,
        }),
    };

    const usage = summary.usage
        ? {
              promptTokens: toNonNegativeNumberOrUndefined(
                  summary.usage.promptTokens
              ),
              cachedInputTokens: toNonNegativeNumberOrUndefined(
                  summary.usage.cachedInputTokens
              ),
              cacheWriteTokens: toNonNegativeNumberOrUndefined(
                  summary.usage.cacheWriteTokens
              ),
              completionTokens: toNonNegativeNumberOrUndefined(
                  summary.usage.completionTokens
              ),
              totalTokens: toNonNegativeNumberOrUndefined(
                  summary.usage.totalTokens
              ),
              reasoningTokens: toNonNegativeNumberOrUndefined(
                  summary.usage.reasoningTokens
              ),
          }
        : undefined;
    const hasUsage =
        usage !== undefined &&
        (usage.promptTokens !== undefined ||
            usage.cachedInputTokens !== undefined ||
            usage.cacheWriteTokens !== undefined ||
            usage.completionTokens !== undefined ||
            usage.totalTokens !== undefined ||
            usage.reasoningTokens !== undefined);
    const validatedCostInput =
        summary.cost !== undefined
            ? toNonNegativeNumberOrUndefined(summary.cost.inputCostUsd)
            : undefined;
    const validatedCostOutput =
        summary.cost !== undefined
            ? toNonNegativeNumberOrUndefined(summary.cost.outputCostUsd)
            : undefined;
    const validatedCostTotal =
        summary.cost !== undefined
            ? toNonNegativeNumberOrUndefined(summary.cost.totalCostUsd)
            : undefined;
    const normalizedCost =
        validatedCostInput !== undefined &&
        validatedCostOutput !== undefined &&
        validatedCostTotal !== undefined
            ? {
                  inputCostUsd: validatedCostInput,
                  outputCostUsd: validatedCostOutput,
                  totalCostUsd: validatedCostTotal,
              }
            : undefined;

    return {
        stepId,
        ...(parentStepId !== undefined && { parentStepId }),
        attempt: normalizedAttempt,
        stepKind: 'plan',
        ...(sanitizedReasonCode !== undefined && {
            reasonCode: sanitizedReasonCode,
        }),
        startedAt: new Date(normalizedStartedAtMs).toISOString(),
        finishedAt: new Date(normalizedFinishedAtMs).toISOString(),
        durationMs: normalizedDurationMs,
        ...(summary.model !== undefined && { model: summary.model }),
        ...(hasUsage && usage !== undefined && { usage }),
        ...(normalizedCost !== undefined && { cost: normalizedCost }),
        outcome: {
            status: summary.status,
            summary:
                summary.status === 'executed'
                    ? 'Planner step emitted bounded action-selection summary.'
                    : summary.status === 'failed'
                      ? 'Planner step failed; bounded fallback guidance remained in effect.'
                      : 'Planner step was skipped before action selection.',
            signals,
        },
    };
};
