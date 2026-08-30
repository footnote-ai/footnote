/**
 * @description: Executes a workflow definition through declared transitions,
 * bounded semantic step runs, and first-class Attempts.
 * @footnote-scope: core
 * @footnote-module: WorkflowCoreEngine
 * @footnote-risk: high - Routing or limit mistakes can create unbounded or unauthorized execution.
 * @footnote-ethics: high - Backend-owned topology and Execution Contract limits constrain model influence.
 */
import type { ExecutionLimits } from '../workflowEngine/limits.js';
import {
    type AttemptRecord,
    type AttemptUsage,
    type ExecuteWorkflowInput,
    type ExecutionAttemptResult,
    type Result,
    type StepRecord,
    type StepExecutor,
    type Workflow,
    type WorkflowExecutionResult,
    type WorkflowRun,
    type Step,
    type WorkflowTermination,
    type WorkflowTransition,
} from './types.js';

const DEFAULT_MAX_ATTEMPTS = 1;
const MAX_ERROR_MESSAGE_LENGTH = 256;

const asSafeCounter = (value: number | undefined): number => {
    if (value === undefined || !Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.floor(value));
};

/**
 * Normalizes one Execution Contract limit. An unusable value clamps to zero so
 * malformed limits stop the relevant path instead of removing its bound.
 */
const asLimit = (value: number): number =>
    Number.isFinite(value) && value >= 0 ? value : 0;

const boundedErrorMessage = (value: string | undefined): string | undefined =>
    value === undefined
        ? undefined
        : value.trim().slice(0, MAX_ERROR_MESSAGE_LENGTH);

const createRun = <TContext>(input: {
    workflow: Workflow<TContext>;
    runId: string;
    startedAtMs: number;
}): WorkflowRun => ({
    runId: input.runId,
    workflowId: input.workflow.id,
    workflowVersion: input.workflow.version,
    startedAtMs: input.startedAtMs,
    finishedAtMs: input.startedAtMs,
    steps: [],
    results: new Map(),
    usage: {
        stepCount: 0,
        totalTokens: 0,
        toolCalls: 0,
        deliberationCalls: 0,
    },
});

const toAttemptRecord = (input: {
    attempt: number;
    executor: Step['executor'];
    startedAtMs: number;
    finishedAtMs: number;
    result: ExecutionAttemptResult;
}): AttemptRecord => {
    if (input.result.status === 'succeeded') {
        return {
            attempt: input.attempt,
            executor: input.executor,
            status: 'succeeded',
            startedAtMs: input.startedAtMs,
            finishedAtMs: input.finishedAtMs,
            ...(input.result.usage === undefined
                ? {}
                : { usage: input.result.usage }),
        };
    }

    return {
        attempt: input.attempt,
        executor: input.executor,
        status: 'failed',
        startedAtMs: input.startedAtMs,
        finishedAtMs: input.finishedAtMs,
        ...(input.result.usage === undefined
            ? {}
            : { usage: input.result.usage }),
        errorCode: input.result.errorCode,
        ...(boundedErrorMessage(input.result.errorMessage) === undefined
            ? {}
            : {
                  errorMessage: boundedErrorMessage(input.result.errorMessage),
              }),
    };
};

const addUsage = (
    usage: {
        totalTokens: number;
        toolCalls: number;
        deliberationCalls: number;
    },
    attemptUsage: AttemptUsage | undefined
): void => {
    usage.totalTokens += asSafeCounter(attemptUsage?.totalTokens);
    usage.toolCalls += asSafeCounter(attemptUsage?.toolCalls);
    usage.deliberationCalls += asSafeCounter(attemptUsage?.deliberationCalls);
};

const hasDeclaredOutcome = (step: Step, outcome: string): boolean =>
    Object.prototype.hasOwnProperty.call(step.transitions, outcome);

export type WorkflowTransitionResolution =
    | {
          kind: 'declared';
          transition: WorkflowTransition;
      }
    | {
          kind: 'undeclared_outcome';
          outcome: string;
      };

/** Resolves only outcomes declared on the supplied Step. */
export const resolveTransition = (
    step: Step,
    outcome: string
): WorkflowTransitionResolution => {
    const transition = hasDeclaredOutcome(step, outcome)
        ? step.transitions[outcome]
        : undefined;
    if (transition === undefined) {
        return {
            kind: 'undeclared_outcome',
            outcome,
        };
    }
    return {
        kind: 'declared',
        transition,
    };
};

const buildRun = (input: {
    run: WorkflowRun;
    steps: readonly StepRecord[];
    results: ReadonlyMap<string, Result<string, unknown>>;
    now: number;
}): WorkflowRun => ({
    ...input.run,
    finishedAtMs: input.now,
    steps: input.steps,
    results: input.results,
});

const finish = (input: {
    run: WorkflowRun;
    steps: readonly StepRecord[];
    results: ReadonlyMap<string, Result<string, unknown>>;
    now: () => number;
    status: WorkflowExecutionResult['status'];
    termination: WorkflowTermination;
}): WorkflowExecutionResult => ({
    status: input.status,
    run: buildRun({
        run: input.run,
        steps: input.steps,
        results: input.results,
        now: input.now(),
    }),
    termination: input.termination,
});

const findExecutionLimit = (input: {
    run: WorkflowRun;
    step: Step;
    limits: ExecutionLimits;
    nowMs: number;
}): keyof ExecutionLimits | undefined => {
    if (input.run.usage.stepCount >= asLimit(input.limits.maxWorkflowSteps)) {
        return 'maxWorkflowSteps';
    }
    if (
        input.run.usage.toolCalls > asLimit(input.limits.maxToolCalls) ||
        (input.step.resource === 'tool' &&
            input.run.usage.toolCalls >= asLimit(input.limits.maxToolCalls))
    ) {
        return 'maxToolCalls';
    }
    if (
        input.run.usage.deliberationCalls >
            asLimit(input.limits.maxDeliberationCalls) ||
        (input.step.resource === 'deliberation' &&
            input.run.usage.deliberationCalls >=
                asLimit(input.limits.maxDeliberationCalls))
    ) {
        return 'maxDeliberationCalls';
    }
    if (input.run.usage.totalTokens >= asLimit(input.limits.maxTokensTotal)) {
        return 'maxTokensTotal';
    }
    if (
        input.nowMs - input.run.startedAtMs >=
        asLimit(input.limits.maxDurationMs)
    ) {
        return 'maxDurationMs';
    }
    return undefined;
};

const collectStepInputs = (input: {
    step: Step;
    results: ReadonlyMap<string, Result<string, unknown>>;
}):
    | {
          inputs: ReadonlyMap<string, Result<string, unknown>>;
      }
    | {
          missingReference: string;
      } => {
    const selected = new Map<string, Result<string, unknown>>();
    for (const reference of input.step.input.references) {
        if (reference.kind !== 'result') {
            continue;
        }
        const value = input.results.get(reference.name);
        if (value === undefined && reference.optional !== true) {
            return { missingReference: reference.name };
        }
        if (value !== undefined) {
            selected.set(reference.name, value);
        }
    }
    return { inputs: selected };
};

/**
 * Runs one explicitly defined workflow. The executor can report an outcome,
 * but only the current Step's declared transition map can choose the path.
 */
export const executeWorkflow = async <TContext>(
    input: ExecuteWorkflowInput<TContext>
): Promise<WorkflowExecutionResult> => {
    const now = input.now ?? (() => Date.now());
    const startedAtMs = input.startedAtMs ?? now();
    const run = createRun({
        workflow: input.workflow,
        runId: input.runId ?? `${input.workflow.id}-${startedAtMs}`,
        startedAtMs,
    });
    const steps: StepRecord[] = [];
    const results = new Map<string, Result<string, unknown>>();
    let currentStepId = input.workflow.start;

    if (input.workflow.steps[currentStepId] === undefined) {
        return finish({
            run,
            steps,
            results,
            now,
            status: 'rejected',
            termination: {
                reason: 'definition_error',
                message: `Workflow start step is not defined: ${currentStepId}`,
            },
        });
    }

    while (true) {
        const step = input.workflow.steps[currentStepId];
        if (step === undefined) {
            return finish({
                run,
                steps,
                results,
                now,
                status: 'rejected',
                termination: {
                    reason: 'definition_error',
                    message: `Workflow step is not defined: ${currentStepId}`,
                },
            });
        }

        const executionLimit = findExecutionLimit({
            run,
            step,
            limits: input.executionLimits,
            nowMs: now(),
        });
        if (executionLimit !== undefined) {
            return finish({
                run,
                steps,
                results,
                now,
                status: 'limited',
                termination: {
                    reason: 'execution_limit',
                    limit: executionLimit,
                },
            });
        }

        const priorRuns = steps.filter(
            (record) => record.stepId === step.id
        ).length;
        if (
            step.maxRuns !== undefined &&
            priorRuns >= asSafeCounter(step.maxRuns)
        ) {
            return finish({
                run,
                steps,
                results,
                now,
                status: 'limited',
                termination: { reason: 'step_run_limit', stepId: step.id },
            });
        }

        const stepRunNumber = priorRuns + 1;
        const stepAttempts: AttemptRecord[] = [];
        const collectedStepInputs = collectStepInputs({ step, results });
        const executor: StepExecutor<TContext> | undefined =
            input.executors[step.executor];
        if ('missingReference' in collectedStepInputs) {
            return finish({
                run,
                steps,
                results,
                now,
                status: 'rejected',
                termination: {
                    reason: 'missing_required_input',
                    stepId: step.id,
                    inputName: collectedStepInputs.missingReference,
                },
            });
        }
        if (executor === undefined) {
            return finish({
                run,
                steps,
                results,
                now,
                status: 'rejected',
                termination: {
                    reason: 'executor_unavailable',
                    stepId: step.id,
                },
            });
        }
        const maximumAttempts = Math.max(
            1,
            asSafeCounter(step.maxAttempts) || DEFAULT_MAX_ATTEMPTS
        );
        let successfulResult: Result<string, unknown> | undefined;
        let successfulOutcome: string | undefined;
        let stepFailed = false;

        for (let attemptNumber = 1; attemptNumber <= maximumAttempts;) {
            const attemptExecutionLimit = findExecutionLimit({
                run,
                step,
                limits: input.executionLimits,
                nowMs: now(),
            });
            if (attemptExecutionLimit !== undefined) {
                if (stepAttempts.length > 0) {
                    run.usage.stepCount += 1;
                    steps.push({
                        stepId: step.id,
                        runNumber: stepRunNumber,
                        inputReferences: step.input.references,
                        status: 'failed',
                        attempts: stepAttempts,
                    });
                }
                return finish({
                    run,
                    steps,
                    results,
                    now,
                    status: 'limited',
                    termination: {
                        reason: 'execution_limit',
                        limit: attemptExecutionLimit,
                    },
                });
            }
            const attemptStartedAtMs = now();
            let attemptResult: ExecutionAttemptResult;
            try {
                attemptResult = await executor({
                    context: input.context,
                    stepId: step.id,
                    runNumber: stepRunNumber,
                    inputs: collectedStepInputs.inputs,
                });
            } catch (error) {
                attemptResult = {
                    status: 'failed',
                    errorCode: 'executor_error',
                    errorMessage:
                        error instanceof Error ? error.message : String(error),
                    retryable: true,
                };
            }
            const attemptFinishedAtMs = now();
            addUsage(run.usage, attemptResult.usage);
            const attemptRecord = toAttemptRecord({
                attempt: attemptNumber,
                executor: step.executor,
                startedAtMs: attemptStartedAtMs,
                finishedAtMs: attemptFinishedAtMs,
                result: attemptResult,
            });

            if (attemptResult.status === 'succeeded') {
                const transition = resolveTransition(
                    step,
                    attemptResult.outcome
                );
                if (transition.kind === 'undeclared_outcome') {
                    stepAttempts.push({
                        ...attemptRecord,
                        status: 'rejected',
                        errorCode: 'undeclared_outcome',
                        errorMessage: boundedErrorMessage(
                            `Outcome is not declared by step: ${attemptResult.outcome}`
                        ),
                    });
                    const rejectedStep: StepRecord = {
                        stepId: step.id,
                        runNumber: stepRunNumber,
                        inputReferences: step.input.references,
                        status: 'failed',
                        attempts: stepAttempts,
                    };
                    steps.push(rejectedStep);
                    run.usage.stepCount += 1;
                    return finish({
                        run,
                        steps,
                        results,
                        now,
                        status: 'rejected',
                        termination: {
                            reason: 'undeclared_outcome',
                            stepId: step.id,
                            outcome: transition.outcome,
                        },
                    });
                }

                if (
                    attemptResult.result !== undefined &&
                    attemptResult.result.name !== step.output.name
                ) {
                    stepAttempts.push({
                        ...attemptRecord,
                        status: 'rejected',
                        errorCode: 'invalid_result',
                        errorMessage: boundedErrorMessage(
                            `Result name does not match step output: ${attemptResult.result.name}`
                        ),
                    });
                    const rejectedStep: StepRecord = {
                        stepId: step.id,
                        runNumber: stepRunNumber,
                        inputReferences: step.input.references,
                        status: 'failed',
                        attempts: stepAttempts,
                    };
                    steps.push(rejectedStep);
                    run.usage.stepCount += 1;
                    return finish({
                        run,
                        steps,
                        results,
                        now,
                        status: 'rejected',
                        termination: {
                            reason: 'invalid_result',
                            stepId: step.id,
                            expectedName: step.output.name,
                            actualName: attemptResult.result.name,
                        },
                    });
                }

                stepAttempts.push(attemptRecord);
                successfulOutcome = attemptResult.outcome;
                successfulResult = attemptResult.result;
                break;
            }

            stepAttempts.push(attemptRecord);
            const shouldRetry =
                attemptResult.retryable !== false &&
                attemptNumber < maximumAttempts;
            if (!shouldRetry) {
                stepFailed = true;
                break;
            }
            attemptNumber += 1;
        }

        run.usage.stepCount += 1;
        const stepRecord: StepRecord = {
            stepId: step.id,
            runNumber: stepRunNumber,
            inputReferences: step.input.references,
            status: stepFailed ? 'failed' : 'succeeded',
            ...(successfulOutcome === undefined
                ? {}
                : { outcome: successfulOutcome }),
            ...(successfulResult === undefined
                ? {}
                : { result: successfulResult }),
            attempts: stepAttempts,
        };
        steps.push(stepRecord);

        if (stepFailed) {
            const failureTransition = resolveTransition(step, 'failed');
            if (failureTransition.kind === 'undeclared_outcome') {
                return finish({
                    run,
                    steps,
                    results,
                    now,
                    status: 'failed',
                    termination: {
                        reason: 'step_failed',
                        stepId: step.id,
                    },
                });
            }
            if (failureTransition.transition.kind === 'finish') {
                return finish({
                    run,
                    steps,
                    results,
                    now,
                    status: 'completed',
                    termination: { reason: 'finished' },
                });
            }
            currentStepId = failureTransition.transition.stepId;
            continue;
        }

        if (successfulResult !== undefined) {
            results.set(successfulResult.name, successfulResult);
        }

        const transition = resolveTransition(step, successfulOutcome ?? '');
        if (transition.kind === 'undeclared_outcome') {
            return finish({
                run,
                steps,
                results,
                now,
                status: 'rejected',
                termination: {
                    reason: 'undeclared_outcome',
                    stepId: step.id,
                    outcome: transition.outcome,
                },
            });
        }
        if (transition.transition.kind === 'finish') {
            return finish({
                run,
                steps,
                results,
                now,
                status: 'completed',
                termination: { reason: 'finished' },
            });
        }
        currentStepId = transition.transition.stepId;
    }
};
