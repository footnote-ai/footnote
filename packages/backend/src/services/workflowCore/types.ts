/**
 * @description: Defines backend-only Workflow execution inputs and records.
 * Workflow topology is shared from the contracts package.
 * @footnote-scope: core
 * @footnote-module: WorkflowCoreTypes
 * @footnote-risk: medium - Contract drift can make later workflow cutovers unsafe.
 * @footnote-ethics: high - Explicit topology and bounded attempts keep execution authority with the backend.
 */
import type {
    ExecutionLimits,
    ExecutionReservation,
    ExhaustedExecutionLimit,
} from '../workflowEngine/limits.js';
import type { Workflow } from '@footnote/contracts';

export type { ResultRef, Step, Workflow } from '@footnote/contracts';

type SerializableValue =
    | boolean
    | null
    | number
    | string
    | readonly SerializableValue[]
    | { readonly [key: string]: SerializableValue };

export type Result = SerializableValue;

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

export type StepHandlerInput<TContext = unknown> = {
    stepId: string;
    context: TContext;
    results: Readonly<Record<string, Result>>;
    /** How many times this Step has run, starting at 1. */
    iteration: number;
    /** This Step's current Attempt, starting at 1. */
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
    | { reason: 'step_iteration_limit'; stepId: string }
    | { reason: 'execution_limit'; limit: ExhaustedExecutionLimit }
    | { reason: 'execution_contract_error'; message: string }
    | { reason: 'step_failed'; stepId: string }
    | { reason: 'missing_required_input'; stepId: string; inputName: string }
    | { reason: 'undeclared_outcome'; stepId: string; outcome: string }
    | { reason: 'invalid_result'; stepId: string }
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
