/**
 * @description: Defines the small, backend-owned vocabulary for explicit
 * workflows without coupling the foundation to a provider or runtime.
 * @footnote-scope: core
 * @footnote-module: WorkflowCoreTypes
 * @footnote-risk: medium - Contract drift can make later workflow cutovers unsafe.
 * @footnote-ethics: high - Typed topology and bounded attempts keep execution authority with the backend.
 */
import type { ExecutionLimits } from '../workflowEngine/limits.js';

export type WorkflowExecutorKind = 'model' | 'context' | 'code' | 'agent';

export type WorkflowStepResource = 'none' | 'tool' | 'deliberation';

export type WorkflowInputReference =
    | {
          kind: 'context';
      }
    | {
          kind: 'result';
          name: string;
          optional?: boolean;
      };

/**
 * A semantic input declaration. The optional phantom type preserves the
 * compile-time input seam while the runtime definition remains serializable.
 */
export type StepInput<TInput = unknown> = {
    references: readonly WorkflowInputReference[];
    inputType?: string;
    readonly __input?: TInput;
};

/**
 * A named output contract. The value itself stays in bounded in-memory Run
 * data; no durable artifact store is implied by this type.
 */
export type ResultContract<TOutput = unknown> = {
    name: string;
    outputType?: string;
    readonly __output?: TOutput;
};

export type Result<TName extends string, TValue> = {
    readonly name: TName;
    readonly value: TValue;
    readonly reference?: string;
};

export const result = <TName extends string, TValue>(
    name: TName,
    value: TValue,
    reference?: string
): Result<TName, TValue> => ({
    name,
    value,
    ...(reference === undefined ? {} : { reference }),
});

export type WorkflowTransition =
    | {
          kind: 'step';
          stepId: string;
      }
    | {
          kind: 'finish';
      };

export type Step<
    TInput = unknown,
    TOutput = unknown,
    TOutcome extends string = string,
> = {
    id: string;
    executor: WorkflowExecutorKind;
    resource?: WorkflowStepResource;
    input: StepInput<TInput>;
    output: ResultContract<TOutput>;
    transitions: Readonly<Record<TOutcome, WorkflowTransition>>;
    /** Maximum semantic executions of this step within one Run. */
    maxRuns?: number;
    /** Maximum Attempts for one semantic Step execution. */
    maxAttempts?: number;
};

export type WorkflowLimitsReference = {
    source: 'execution-contract';
};

export type Workflow<TContext = unknown> = {
    id: string;
    version: 'v1';
    start: string;
    steps: Readonly<Record<string, Step>>;
    limits: WorkflowLimitsReference;
    readonly __context?: TContext;
};

export type AttemptUsage = {
    totalTokens?: number;
    toolCalls?: number;
    deliberationCalls?: number;
};

export type ExecutionAttemptResult<TOutput = unknown> =
    | {
          status: 'succeeded';
          outcome: string;
          result?: Result<string, TOutput>;
          usage?: AttemptUsage;
      }
    | {
          status: 'failed';
          errorCode: string;
          errorMessage?: string;
          retryable?: boolean;
          usage?: AttemptUsage;
      };

export type StepExecutionInput<TContext> = {
    context: TContext;
    stepId: string;
    runNumber: number;
    inputs: ReadonlyMap<string, Result<string, unknown>>;
};

export type StepExecutor<TContext> = (
    input: StepExecutionInput<TContext>
) => Promise<ExecutionAttemptResult>;

/**
 * Typed adapter seam for a semantic Step. The heterogeneous runtime registry
 * intentionally erases this shape at the engine boundary.
 */
export type TypedStepExecutor<TContext, TInput, TOutput> = (input: {
    context: TContext;
    input: TInput;
    stepId: string;
    runNumber: number;
}) => Promise<ExecutionAttemptResult<TOutput>>;

export type ExecutorRegistry<TContext> = Partial<
    Record<WorkflowExecutorKind, StepExecutor<TContext>>
>;

export type AttemptRecord = {
    attempt: number;
    executor: WorkflowExecutorKind;
    status: 'succeeded' | 'failed' | 'rejected';
    startedAtMs: number;
    finishedAtMs: number;
    usage?: AttemptUsage;
    errorCode?: string;
    errorMessage?: string;
};

export type StepRecord = {
    stepId: string;
    runNumber: number;
    inputReferences: readonly WorkflowInputReference[];
    status: 'succeeded' | 'failed';
    outcome?: string;
    result?: Result<string, unknown>;
    attempts: readonly AttemptRecord[];
};

export type WorkflowRun = {
    runId: string;
    workflowId: string;
    workflowVersion: 'v1';
    startedAtMs: number;
    finishedAtMs: number;
    steps: readonly StepRecord[];
    results: ReadonlyMap<string, Result<string, unknown>>;
    usage: {
        stepCount: number;
        totalTokens: number;
        toolCalls: number;
        deliberationCalls: number;
    };
};

export type WorkflowTermination =
    | { reason: 'finished' }
    | { reason: 'step_run_limit'; stepId: string }
    | { reason: 'execution_limit'; limit: keyof ExecutionLimits }
    | { reason: 'step_failed'; stepId: string }
    | {
          reason: 'missing_required_input';
          stepId: string;
          inputName: string;
      }
    | { reason: 'undeclared_outcome'; stepId: string; outcome: string }
    | {
          reason: 'invalid_result';
          stepId: string;
          expectedName: string;
          actualName: string;
      }
    | { reason: 'definition_error'; message: string }
    | { reason: 'executor_unavailable'; stepId: string };

export type WorkflowExecutionResult = {
    status: 'completed' | 'limited' | 'failed' | 'rejected';
    run: WorkflowRun;
    termination: WorkflowTermination;
};

export type ExecuteWorkflowInput<TContext> = {
    workflow: Workflow<TContext>;
    context: TContext;
    executors: ExecutorRegistry<TContext>;
    /** The existing backend Execution Contract limits are the outer authority. */
    executionLimits: ExecutionLimits;
    runId?: string;
    startedAtMs?: number;
    now?: () => number;
};
