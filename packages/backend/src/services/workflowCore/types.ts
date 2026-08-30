/**
 * @description: Defines the small, backend-owned runtime workflow contract.
 * Dataflow is validated from declared result names at execution time.
 * @footnote-scope: core
 * @footnote-module: WorkflowCoreTypes
 * @footnote-risk: medium - Contract drift can make later workflow cutovers unsafe.
 * @footnote-ethics: high - Explicit topology and bounded attempts keep execution authority with the backend.
 */
import type {
    ExecutionActivity,
    ExecutionLimits,
    ExecutionReservation,
    ExhaustedExecutionLimit,
} from '../workflowEngine/limits.js';

type SerializableValue =
    | boolean
    | null
    | number
    | string
    | readonly SerializableValue[]
    | { readonly [key: string]: SerializableValue };

export type ResultRef = { name: string; optional?: boolean };

export type Result = {
    readonly name: string;
    readonly value: SerializableValue;
};

export const result = (name: string, value: SerializableValue): Result => ({
    name,
    value,
});

export type Step = {
    /** Minimal resource facts consumed by shared Execution Contract authority. */
    activity?: ExecutionActivity;
    /** Results required from earlier Steps. Context is available to every handler. */
    input?: readonly ResultRef[];
    /** The sole Result name this Step may return; required by default on success. */
    output?: { name: string; requiredOn?: readonly string[] };
    next: Readonly<Record<string, string | null>>;
    /** Maximum semantic executions of this Step within one Run. */
    maxRuns?: number;
    /** Maximum Attempts for one semantic Step execution. */
    maxAttempts?: number;
};

export type Workflow = {
    id: string;
    start: string;
    steps: Readonly<Record<string, Step>>;
};

export type AttemptUsage = {
    totalTokens?: number;
    toolCalls?: number;
    deliberationCalls?: number;
};

export type AttemptResult =
    | {
          status: 'succeeded';
          outcome: string;
          result?: Result;
          usage?: AttemptUsage;
      }
    | {
          status: 'failed';
          errorCode: string;
          errorMessage?: string;
          retryable?: boolean;
          usage?: AttemptUsage;
      };

/** Input to a Step handler contains runtime data, not phantom compile-time wiring. */
export type StepHandlerInput<TContext = unknown> = {
    stepId: string;
    step: Step;
    context: TContext;
    results: Readonly<Record<string, Result>>;
    /** One-based semantic execution ordinal for this Step. */
    iteration: number;
    /** One-based handler Attempt ordinal within this Run. */
    attempt: number;
};

export type StepHandler<TContext = unknown> = (
    input: StepHandlerInput<TContext>
) => Promise<AttemptResult>;

export type StepHandlers<TContext = unknown> = Readonly<
    Record<string, StepHandler<TContext>>
>;

export type Attempt = {
    attempt: number;
    status: 'succeeded' | 'failed' | 'rejected';
    startedAtMs: number;
    finishedAtMs: number;
    usage?: AttemptUsage;
    errorCode?: string;
    errorMessage?: string;
};

export type Run = {
    runId: string;
    workflowId: string;
    startedAtMs: number;
    finishedAtMs: number;
    steps: readonly {
        stepId: string;
        iteration: number;
        input: readonly ResultRef[];
        status: 'succeeded' | 'failed';
        outcome?: string;
        result?: Result;
        attempts: readonly Attempt[];
    }[];
    results: Readonly<Record<string, Result>>;
    usage: {
        stepCount: number;
        totalTokens: number;
        toolCalls: number;
        deliberationCalls: number;
        planCalls: number;
        reviewCalls: number;
    };
};

export type RunTermination =
    | { reason: 'finished' }
    | { reason: 'step_run_limit'; stepId: string }
    | { reason: 'execution_limit'; limit: ExhaustedExecutionLimit }
    | { reason: 'execution_contract_error'; message: string }
    | { reason: 'step_failed'; stepId: string }
    | { reason: 'missing_required_input'; stepId: string; inputName: string }
    | { reason: 'undeclared_outcome'; stepId: string; outcome: string }
    | {
          reason: 'invalid_result';
          stepId: string;
          expectedName?: string;
          actualName?: string;
      }
    | { reason: 'definition_error'; message: string }
    | { reason: 'handler_unavailable'; stepId: string };

export type RunResult = {
    status: 'completed' | 'degraded' | 'limited' | 'failed' | 'rejected';
    run: Run;
    termination: RunTermination;
};

export type ExecuteInput<TContext = unknown> = {
    workflow: Workflow;
    context: TContext;
    handlers: StepHandlers<TContext>;
    /** The existing backend Execution Contract remains the outer authority. */
    executionLimits: ExecutionLimits;
    runId?: string;
    startedAtMs?: number;
    now?: () => number;
    /** Calculates conservative resource bounds for this concrete Attempt. */
    reserveAttempt?: (
        input: StepHandlerInput<TContext>
    ) => ExecutionReservation | undefined;
};
