/**
 * @description: Centralizes workflow execution-limit admission, accounting, and
 * limit metadata serialization for lineage.
 * @footnote-scope: core
 * @footnote-module: WorkflowEngineLimits
 * @footnote-risk: medium - Limit bugs can cause runaway loops or premature stops.
 * @footnote-ethics: high - Bound enforcement is core to safe deliberation control.
 */
import type {
    WorkflowEffectiveLimit,
    WorkflowLimitKey,
    WorkflowLimitStop,
    WorkflowStepKind,
    WorkflowTerminationReason,
} from '@footnote/contracts/policy';
import type { WorkflowProfileExecutionLimitsContract } from '../workflowProfileContract.js';
import type { WorkflowProfilePolicyContract } from '../workflowProfileContract.js';
import type { WorkflowState } from './state.js';

export type ExecutionLimits = WorkflowProfileExecutionLimitsContract;
export type ExhaustedExecutionLimit = WorkflowLimitKey;

/** Minimal resource facts used by the Execution Contract, independent of Step names. */
export type ExecutionActivity = {
    tool?: 'none' | 'one-or-more';
    deliberation?: 'none' | 'general' | 'plan' | 'review';
};

export type ExecutionUsage = {
    totalTokens?: number;
    toolCalls?: number;
    deliberationCalls?: number;
};

/** Conservative maximum resource capacity reserved before one Attempt starts. */
export type ExecutionReservation = {
    tokens?: number;
    toolCalls?: number;
};

/** State needed by the shared limit authority, independent of either engine. */
export type ExecutionLimitState = {
    startedAtMs: number;
    stepCount: number;
    toolCallCount: number;
    planCallCount: number;
    reviewCallCount: number;
    deliberationCallCount: number;
    totalTokens: number;
};

export type ExecutionAdmission =
    | { admitted: true }
    | { admitted: false; exhaustedBy: ExhaustedExecutionLimit }
    | { admitted: false; error: string };

const REQUIRED_LIMIT_KEYS: readonly (keyof ExecutionLimits)[] = [
    'maxWorkflowSteps',
    'maxToolCalls',
    'maxDeliberationCalls',
    'maxTokensTotal',
    'maxDurationMs',
];

const isNonNegativeInteger = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0;

const sanitizeUsageCount = (value: number | undefined): number =>
    value !== undefined && Number.isFinite(value)
        ? Math.max(0, Math.floor(value))
        : 0;

/**
 * Validates concrete Execution Contract bounds before work begins. Invalid
 * values are rejected rather than normalized, because normalization can erase
 * an intended safety boundary.
 */
export const validateExecutionLimits = (
    limits: ExecutionLimits
): string | undefined => {
    for (const key of REQUIRED_LIMIT_KEYS) {
        if (!isNonNegativeInteger(limits[key])) {
            return `Execution Contract limit is invalid: ${key}`;
        }
    }

    for (const key of ['maxPlanCycles', 'maxReviewCycles'] as const) {
        const value = limits[key];
        if (value !== undefined && !isNonNegativeInteger(value)) {
            return `Execution Contract limit is invalid: ${key}`;
        }
    }

    return undefined;
};

/**
 * Admits one Attempt through the shared Execution Contract. Resource facts are
 * intentionally generic: future verification or research Steps can consume
 * deliberation capacity without pretending to be a legacy plan or assess Step.
 */
export const admitExecution = (input: {
    state: ExecutionLimitState;
    limits: ExecutionLimits;
    nowMs: number;
    activity?: ExecutionActivity;
    reservation?: ExecutionReservation;
}): ExecutionAdmission => {
    const malformedLimits = validateExecutionLimits(input.limits);
    if (malformedLimits !== undefined) {
        return { admitted: false, error: malformedLimits };
    }

    if (input.state.stepCount >= input.limits.maxWorkflowSteps) {
        return { admitted: false, exhaustedBy: 'maxWorkflowSteps' };
    }

    const requestedToolCalls = input.reservation?.toolCalls ?? 0;
    if (!isNonNegativeInteger(requestedToolCalls)) {
        return {
            admitted: false,
            error: 'Execution Attempt reservation is invalid: toolCalls',
        };
    }
    const reservedToolCalls = Math.max(
        input.activity?.tool === 'one-or-more' ? 1 : 0,
        requestedToolCalls
    );
    if (
        input.state.toolCallCount + reservedToolCalls >
        input.limits.maxToolCalls
    ) {
        return { admitted: false, exhaustedBy: 'maxToolCalls' };
    }

    const deliberation = input.activity?.deliberation;
    const maxPlanCycles =
        input.limits.maxPlanCycles ??
        Math.max(0, input.limits.maxDeliberationCalls);
    const maxReviewCycles =
        input.limits.maxReviewCycles ??
        Math.max(1, input.limits.maxDeliberationCalls - maxPlanCycles);
    if (deliberation === 'plan' && input.state.planCallCount >= maxPlanCycles) {
        return { admitted: false, exhaustedBy: 'maxDeliberationCalls' };
    }
    if (
        deliberation === 'review' &&
        input.state.reviewCallCount >= maxReviewCycles
    ) {
        return { admitted: false, exhaustedBy: 'maxDeliberationCalls' };
    }
    if (
        deliberation !== undefined &&
        deliberation !== 'none' &&
        input.state.deliberationCallCount >= input.limits.maxDeliberationCalls
    ) {
        return { admitted: false, exhaustedBy: 'maxDeliberationCalls' };
    }

    if (input.state.totalTokens >= input.limits.maxTokensTotal) {
        return { admitted: false, exhaustedBy: 'maxTokensTotal' };
    }

    const reservedTokens = input.reservation?.tokens ?? 0;
    if (!isNonNegativeInteger(reservedTokens)) {
        return {
            admitted: false,
            error: 'Execution Attempt reservation is invalid: tokens',
        };
    }
    if (
        reservedTokens > 0 &&
        input.state.totalTokens + reservedTokens > input.limits.maxTokensTotal
    ) {
        return { admitted: false, exhaustedBy: 'maxTokensTotal' };
    }

    if (input.nowMs - input.state.startedAtMs >= input.limits.maxDurationMs) {
        return { admitted: false, exhaustedBy: 'maxDurationMs' };
    }

    return { admitted: true };
};

/**
 * Records one Attempt or completed semantic Step in the same authority that
 * admits it. Presentation has no deliberation activity, so its candidate work
 * remains outside the plan/review deliberation budget without core-specific
 * exceptions.
 */
export const recordExecution = (input: {
    state: ExecutionLimitState;
    activity?: ExecutionActivity;
    usage?: ExecutionUsage;
    completedStep?: boolean;
}): ExecutionLimitState => {
    const reportedToolCalls = sanitizeUsageCount(input.usage?.toolCalls);
    const reportedDeliberationCalls = sanitizeUsageCount(
        input.usage?.deliberationCalls
    );
    const toolCalls =
        input.activity?.tool === 'none'
            ? 0
            : input.activity?.tool === 'one-or-more'
              ? Math.max(1, reportedToolCalls)
              : reportedToolCalls;
    const deliberationCalls =
        input.activity?.deliberation === 'none'
            ? 0
            : input.activity?.deliberation !== undefined
              ? Math.max(1, reportedDeliberationCalls)
              : reportedDeliberationCalls;

    return {
        ...input.state,
        stepCount:
            input.state.stepCount + (input.completedStep === true ? 1 : 0),
        toolCallCount: input.state.toolCallCount + toolCalls,
        planCallCount:
            input.state.planCallCount +
            (input.activity?.deliberation === 'plan' ? 1 : 0),
        reviewCallCount:
            input.state.reviewCallCount +
            (input.activity?.deliberation === 'review' ? 1 : 0),
        deliberationCallCount:
            input.state.deliberationCallCount + deliberationCalls,
        totalTokens:
            input.state.totalTokens +
            sanitizeUsageCount(input.usage?.totalTokens),
    };
};

/** Adapts the live engine's legacy taxonomy at its boundary to generic resource facts. */
export const activityForWorkflowStep = (
    stepKind: WorkflowStepKind | undefined
): ExecutionActivity | undefined => {
    if (stepKind === 'tool') return { tool: 'one-or-more' };
    if (stepKind === 'plan') return { deliberation: 'plan' };
    if (stepKind === 'assess') return { deliberation: 'review' };
    return undefined;
};

export const mapLimitExhaustionToTerminationReason = (
    exhaustedBy: ExhaustedExecutionLimit
): WorkflowTerminationReason => {
    if (exhaustedBy === 'maxWorkflowSteps') return 'budget_exhausted_steps';
    if (exhaustedBy === 'maxTokensTotal') return 'budget_exhausted_tokens';
    if (exhaustedBy === 'maxDurationMs') return 'budget_exhausted_time';
    if (exhaustedBy === 'maxToolCalls') return 'max_tool_calls_reached';
    if (exhaustedBy === 'maxDeliberationCalls')
        return 'max_deliberation_calls_reached';

    const exhaustiveCheck: never = exhaustedBy;
    throw new Error(
        `Unsupported exhausted execution limit: ${exhaustiveCheck}`
    );
};

/** Live-engine adapter over the shared neutral admission seam. */
export const checkExecutionLimits = (
    state: WorkflowState,
    limits: ExecutionLimits,
    nowMs: number,
    nextStepKind?: WorkflowStepKind,
    nextStepTokenBudget = 0
): {
    withinLimits: boolean;
    exhaustedBy?: ExhaustedExecutionLimit;
    error?: string;
} => {
    const admission = admitExecution({
        state,
        limits,
        nowMs,
        activity: activityForWorkflowStep(nextStepKind),
        reservation: { tokens: nextStepTokenBudget },
    });
    if (admission.admitted) return { withinLimits: true };
    if ('exhaustedBy' in admission)
        return { withinLimits: false, exhaustedBy: admission.exhaustedBy };
    return { withinLimits: false, error: admission.error };
};

const UNBOUNDED_EXECUTION_LIMIT_SENTINEL = Number.MAX_SAFE_INTEGER;

const isUnavailableExecutionLimit = (value: number): boolean =>
    !Number.isFinite(value) || value >= UNBOUNDED_EXECUTION_LIMIT_SENTINEL;

const isExecutionLimitPathActive = (
    key: WorkflowLimitKey,
    policy: WorkflowProfilePolicyContract
): boolean => {
    if (key === 'maxToolCalls') return policy.enableToolUse;
    if (key === 'maxDeliberationCalls') {
        return (
            policy.enablePlanning ||
            policy.enableAssessment ||
            policy.enableRevision
        );
    }
    return true;
};

export const resolveExecutionLimits = (input: {
    limits: ExecutionLimits;
    policy: WorkflowProfilePolicyContract;
    exhaustedLimitKey?: WorkflowLimitKey;
}): WorkflowEffectiveLimit[] => {
    const orderedKeys: WorkflowLimitKey[] = [
        'maxWorkflowSteps',
        'maxToolCalls',
        'maxDeliberationCalls',
        'maxTokensTotal',
        'maxDurationMs',
    ];

    return orderedKeys.map((key) => {
        const value = input.limits[key];
        const limitAvailable = !isUnavailableExecutionLimit(value);
        const pathActive = isExecutionLimitPathActive(key, input.policy);
        const state = !limitAvailable
            ? 'unavailable'
            : !pathActive
              ? 'configured_inactive'
              : 'enforced';
        return {
            key,
            state,
            ...(limitAvailable && { value }),
            stoppedRun: input.exhaustedLimitKey === key,
        };
    });
};

export const buildExecutionLimitStop = (input: {
    terminationReason: WorkflowTerminationReason;
    exhaustedLimitKey?: WorkflowLimitKey;
    stoppedBeforeStepKind?: WorkflowStepKind;
}): WorkflowLimitStop => ({
    stoppedByLimit: input.exhaustedLimitKey !== undefined,
    terminationReason: input.terminationReason,
    ...(input.exhaustedLimitKey !== undefined && {
        exhaustedLimitKey: input.exhaustedLimitKey,
    }),
    ...(input.exhaustedLimitKey !== undefined &&
        input.stoppedBeforeStepKind !== undefined && {
            stoppedBeforeStepKind: input.stoppedBeforeStepKind,
        }),
});

export const UNBOUNDED_EXECUTION_LIMIT = UNBOUNDED_EXECUTION_LIMIT_SENTINEL;
