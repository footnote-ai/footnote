/**
 * @description: Shared workflow step signal builders and conservative readers.
 * @footnote-scope: interface
 * @footnote-module: WorkflowStepSignals
 * @footnote-risk: medium - Signal drift can misstate workflow lineage and receipts.
 * @footnote-ethics: high - Accurate step interpretation affects user-facing trust cues.
 */
import type {
    PlannerExecutionContractType,
    StepRecord,
    StepSignals,
    WorkflowAssessRoutingHintSignals,
    WorkflowReviewParseFailureSignals,
    WorkflowRoutingChainAttemptSignal,
    WorkflowRoutingChainSignals,
    WorkflowRoutingHintConflictResolution,
    WorkflowRoutingHintLane,
} from './types.js';

const PLANNER_CONTRACT_TYPES = new Set<PlannerExecutionContractType>([
    'structured',
    'text_json',
    'fallback',
]);

/**
 * Builds routing-chain signals while preserving the generic signal-bag shape.
 *
 * Callers may rename selected-profile keys for older lineage conventions. The
 * attempt array is JSON-encoded because public step signals stay primitive.
 */
export const buildWorkflowRoutingChainSignals = (input: {
    attempts?: WorkflowRoutingChainAttemptSignal[];
    selectedProfileId?: string | null;
    selectedProvider?: string | null;
    selectedModel?: string | null;
    signalKeys?: {
        profileId?: string;
        provider?: string;
        model?: string;
    };
}): StepSignals => {
    if (!Array.isArray(input.attempts)) {
        return {};
    }

    const profileIdKey = input.signalKeys?.profileId ?? 'selectedProfileId';
    const providerKey = input.signalKeys?.provider ?? 'selectedProvider';
    const modelKey = input.signalKeys?.model ?? 'selectedModel';
    const signals: WorkflowRoutingChainSignals = {
        routingChainAttemptCount: input.attempts.length,
        routingChainAttemptsJson: JSON.stringify(input.attempts),
    };

    if (input.selectedProfileId !== undefined) {
        signals[profileIdKey] = input.selectedProfileId;
    }
    if (input.selectedProvider !== undefined) {
        signals[providerKey] = input.selectedProvider;
    }
    if (input.selectedModel !== undefined) {
        signals[modelKey] = input.selectedModel;
    }

    return signals;
};

/**
 * Builds the small assess hint record carried across review-loop steps.
 *
 * Missing hints are represented as `routingHintApplied: "none"` so readers do
 * not need to infer absence from an omitted object.
 */
export const buildWorkflowAssessRoutingHintSignals = (input: {
    assessRoutingHintsCsv?: string;
    routingHintApplied?: WorkflowRoutingHintLane;
    routingHintConflictResolved?: WorkflowRoutingHintConflictResolution;
}): WorkflowAssessRoutingHintSignals => ({
    ...(input.assessRoutingHintsCsv !== undefined && {
        assessRoutingHintsCsv: input.assessRoutingHintsCsv,
    }),
    routingHintApplied: input.routingHintApplied ?? 'none',
    ...(input.routingHintConflictResolved !== undefined && {
        routingHintConflictResolved: input.routingHintConflictResolved,
    }),
});

/**
 * Converts a backend parse failure into public fail-open lineage signals.
 *
 * This keeps the reason inspectable without exposing raw model output or parser
 * internals beyond bounded issue counts and first-issue hints.
 */
export const buildWorkflowReviewParseFailureSignals = (input: {
    reason: WorkflowReviewParseFailureSignals['reviewParseFailureReason'];
    message: string;
    outputLength: number;
    issueCount?: number;
    firstIssuePath?: string;
    firstIssueCode?: string;
}): WorkflowReviewParseFailureSignals => ({
    reviewParseStatus: 'failed',
    reviewParseFailureReason: input.reason,
    reviewParseFailureMessage: input.message,
    reviewParseOutputLength: input.outputLength,
    ...(input.issueCount !== undefined && {
        reviewParseIssueCount: input.issueCount,
    }),
    ...(input.firstIssuePath !== undefined && {
        reviewParseFirstIssuePath: input.firstIssuePath,
    }),
    ...(input.firstIssueCode !== undefined && {
        reviewParseFirstIssueCode: input.firstIssueCode,
    }),
});

/**
 * Reads the planner contract type from a workflow plan step.
 *
 * Returns `null` for non-plan steps and malformed signal values. Readers should
 * treat `null` as "not recorded", not as a fallback or failure.
 */
export const getPlannerStepContractType = (
    step: StepRecord
): PlannerExecutionContractType | null => {
    if (step.stepKind !== 'plan') {
        return null;
    }

    const contractType = step.outcome.signals?.contractType;
    if (
        typeof contractType === 'string' &&
        PLANNER_CONTRACT_TYPES.has(contractType as PlannerExecutionContractType)
    ) {
        return contractType as PlannerExecutionContractType;
    }

    return null;
};

/**
 * Returns true only for explicit planner fallback lineage.
 *
 * Runtime planner failures count as fallback because backend workflow records
 * them as fail-open planner steps. Other step kinds are ignored even if a
 * malformed signal bag happens to contain `contractType`.
 */
export const isPlannerFallbackStep = (step: StepRecord): boolean => {
    if (step.stepKind !== 'plan') {
        return false;
    }

    if (
        step.reasonCode === 'planner_runtime_error' ||
        step.reasonCode === 'planner_invalid_output'
    ) {
        return true;
    }

    return getPlannerStepContractType(step) === 'fallback';
};

/**
 * Returns true only for executed generate steps that actually produced a
 * refinement draft. Failed or merely requested revision paths are excluded.
 */
export const isRefinementGenerateStep = (step: StepRecord): boolean =>
    step.stepKind === 'generate' &&
    step.outcome.status === 'executed' &&
    step.outcome.signals?.refinementApplied === true;

/**
 * Returns the best profile-like signal for compact timeline display.
 *
 * The lookup order prefers direct profile ids, then effective/selected/routed
 * ids. Invalid or blank values return `null` so callers can fall back cleanly.
 */
export const getWorkflowStepProfileIdSignal = (
    step: StepRecord
): string | null => {
    const candidateKeys: Array<
        keyof NonNullable<StepRecord['outcome']['signals']>
    > = [
        'profileId',
        'effectiveProfileId',
        'selectedProfileId',
        'routedProfileId',
    ];

    for (const key of candidateKeys) {
        const value = step.outcome.signals?.[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value;
        }
    }

    return null;
};
