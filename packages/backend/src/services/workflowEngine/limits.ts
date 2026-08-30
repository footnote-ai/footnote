/**
 * @description: Centralizes workflow execution-limit admission and limit metadata
 * serialization for lineage.
 * @footnote-scope: core
 * @footnote-module: WorkflowEngineLimits
 * @footnote-risk: medium - Limit bugs can cause runaway loops or premature stops.
 * @footnote-ethics: high - Bound enforcement is core to safe deliberation control.
 */
import type {
    WorkflowEffectiveLimit,
    WorkflowLimitKey,
    WorkflowLimitStop,
    WorkflowTerminationReason,
    WorkflowStepKind,
} from '@footnote/contracts/policy';
import type { WorkflowProfileExecutionLimitsContract } from '../workflowProfileContract.js';
import type { WorkflowProfilePolicyContract } from '../workflowProfileContract.js';
import type { WorkflowState } from './state.js';

export type ExecutionLimits = WorkflowProfileExecutionLimitsContract;
export type ExhaustedExecutionLimit = WorkflowLimitKey;

/** State required to admit one execution attempt. It is independent of either workflow engine. */
export type ExecutionLimitState = Pick<
    WorkflowState,
    | 'startedAtMs'
    | 'stepCount'
    | 'toolCallCount'
    | 'planCallCount'
    | 'reviewCallCount'
    | 'deliberationCallCount'
    | 'totalTokens'
>;

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

/**
 * Validates the concrete Execution Contract bounds before work begins. Invalid
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
 * Admits a single attempt against the shared Execution Contract. Both engines
 * use this neutral seam so canonical plan/review caps, token reservations,
 * tool caps, duration, and presentation accounting stay identical.
 */
export const admitExecution = (input: {
    state: ExecutionLimitState;
    limits: ExecutionLimits;
    nowMs: number;
    nextStepKind?: WorkflowStepKind;
    nextStepTokenBudget?: number;
}): ExecutionAdmission => {
    const malformedLimits = validateExecutionLimits(input.limits);
    if (malformedLimits !== undefined) {
        return { admitted: false, error: malformedLimits };
    }

    if (input.state.stepCount >= input.limits.maxWorkflowSteps) {
        return { admitted: false, exhaustedBy: 'maxWorkflowSteps' };
    }

    if (
        input.nextStepKind === 'tool' &&
        input.state.toolCallCount >= input.limits.maxToolCalls
    ) {
        return { admitted: false, exhaustedBy: 'maxToolCalls' };
    }

    // Presentation candidate usage is intentionally recorded separately; it
    // does not consume the deliberation capacity reserved for plan and review.
    const isSemanticDeliberation =
        input.nextStepKind === 'plan' || input.nextStepKind === 'assess';
    const maxPlanCycles =
        input.limits.maxPlanCycles ??
        Math.max(0, input.limits.maxDeliberationCalls);
    const maxReviewCycles =
        input.limits.maxReviewCycles ??
        Math.max(1, input.limits.maxDeliberationCalls - maxPlanCycles);
    if (
        input.nextStepKind === 'plan' &&
        input.state.planCallCount >= maxPlanCycles
    ) {
        return { admitted: false, exhaustedBy: 'maxDeliberationCalls' };
    }
    if (
        input.nextStepKind === 'assess' &&
        input.state.reviewCallCount >= maxReviewCycles
    ) {
        return { admitted: false, exhaustedBy: 'maxDeliberationCalls' };
    }
    if (
        isSemanticDeliberation &&
        input.state.deliberationCallCount >= input.limits.maxDeliberationCalls
    ) {
        return { admitted: false, exhaustedBy: 'maxDeliberationCalls' };
    }

    if (input.state.totalTokens >= input.limits.maxTokensTotal) {
        return { admitted: false, exhaustedBy: 'maxTokensTotal' };
    }

    const reservation = input.nextStepTokenBudget ?? 0;
    if (!isNonNegativeInteger(reservation)) {
        return {
            admitted: false,
            error: 'Execution token reservation is invalid',
        };
    }
    if (
        reservation > 0 &&
        input.state.totalTokens + reservation > input.limits.maxTokensTotal
    ) {
        return { admitted: false, exhaustedBy: 'maxTokensTotal' };
    }

    if (input.nowMs - input.state.startedAtMs >= input.limits.maxDurationMs) {
        return { admitted: false, exhaustedBy: 'maxDurationMs' };
    }

    return { admitted: true };
};

export const mapLimitExhaustionToTerminationReason = (
    exhaustedBy: ExhaustedExecutionLimit
): WorkflowTerminationReason => {
    if (exhaustedBy === 'maxWorkflowSteps') return 'budget_exhausted_steps';
    if (exhaustedBy === 'maxTokensTotal') return 'budget_exhausted_tokens';
    if (exhaustedBy === 'maxDurationMs') return 'budget_exhausted_time';
    if (exhaustedBy === 'maxToolCalls') return 'max_tool_calls_reached';
    if (exhaustedBy === 'maxDeliberationCalls') {
        return 'max_deliberation_calls_reached';
    }

    const exhaustiveCheck: never = exhaustedBy;
    throw new Error(
        `Unsupported exhausted execution limit: ${exhaustiveCheck}`
    );
};

/** Backward-compatible live-engine adapter over the shared neutral admission seam. */
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
        nextStepKind,
        nextStepTokenBudget,
    });
    if (admission.admitted) return { withinLimits: true };
    if ('exhaustedBy' in admission) {
        return { withinLimits: false, exhaustedBy: admission.exhaustedBy };
    }
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
