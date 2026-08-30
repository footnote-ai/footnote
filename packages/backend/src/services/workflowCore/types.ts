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

export type ExecutorKind = 'model' | 'context' | 'code' | 'agent';

type SerializableValue =
    | boolean
    | null
    | number
    | string
    | readonly SerializableValue[]
    | { readonly [key: string]: SerializableValue };

export type InputRef =
    { kind: 'context' } | { kind: 'result'; name: string; optional?: boolean };

export type Result = {
    readonly name: string;
    readonly value: SerializableValue;
};

export const result = (name: string, value: SerializableValue): Result => ({
    name,
    value,
});

export type Transition = { kind: 'step'; stepId: string } | { kind: 'end' };

export type Step = {
    id: string;
    executor: ExecutorKind;
    /** Minimal resource facts consumed by shared Execution Contract authority. */
    activity?: ExecutionActivity;
    input: readonly InputRef[];
    /** The sole Result name this Step may return; required by default on success. */
    output?: { name: string; requiredOn?: readonly string[] };
    transitions: Readonly<Record<string, Transition>>;
    /** Maximum semantic executions of this Step within one Run. */
    maxRuns?: number;
    /** Maximum Attempts for one semantic Step execution. */
    maxAttempts?: number;
};

export type Workflow = {
    id: string;
    version: 'v1';
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

/** Input to an executor contains runtime data, not phantom compile-time wiring. */
export type ExecutorInput<TContext = unknown> = {
    step: Step;
    context: TContext;
    results: Readonly<Record<string, Result>>;
    /** One-based semantic execution ordinal for this Step. */
    run: number;
    /** One-based executor Attempt ordinal within this Run. */
    attempt: number;
};

export type Executor<TContext = unknown> = (
    input: ExecutorInput<TContext>
) => Promise<AttemptResult>;

export type Executors<TContext = unknown> = Partial<
    Record<ExecutorKind, Executor<TContext>>
>;

export type Attempt = {
    attempt: number;
    executor: ExecutorKind;
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
    workflowVersion: 'v1';
    startedAtMs: number;
    finishedAtMs: number;
    steps: readonly {
        stepId: string;
        run: number;
        input: readonly InputRef[];
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
    | { reason: 'executor_unavailable'; stepId: string };

export type RunResult = {
    status: 'completed' | 'degraded' | 'limited' | 'failed' | 'rejected';
    run: Run;
    termination: RunTermination;
};

export type ExecuteInput<TContext = unknown> = {
    workflow: Workflow;
    context: TContext;
    executors: Executors<TContext>;
    /** The existing backend Execution Contract remains the outer authority. */
    executionLimits: ExecutionLimits;
    runId?: string;
    startedAtMs?: number;
    now?: () => number;
    /** Calculates conservative resource bounds for this concrete Attempt. */
    reserveAttempt?: (
        input: ExecutorInput<TContext>
    ) => ExecutionReservation | undefined;
};
