/**
 * @description: Executes runtime workflow definitions through declared transitions,
 * bounded semantic runs, and Execution Contract admission before every Attempt.
 * @footnote-scope: core
 * @footnote-module: WorkflowCoreEngine
 * @footnote-risk: high - Routing or admission mistakes can create unbounded or unauthorized execution.
 * @footnote-ethics: high - Backend-owned topology and shared limits constrain model influence.
 */
import {
    admitExecution,
    recordExecution,
    validateExecutionLimits,
} from '../workflowEngine/limits.js';
import {
    type Attempt,
    type AttemptResult,
    type ExecuteInput,
    type Result,
    type Run,
    type RunResult,
    type RunTermination,
    type Step,
    type Transition,
    type Workflow,
} from './types.js';

const DEFAULT_MAX_ATTEMPTS = 1;
const MAX_ERROR_MESSAGE_LENGTH = 256;

type StepRun = Run['steps'][number];

const isPositiveInteger = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 1;

const boundedErrorMessage = (value: string | undefined): string | undefined =>
    value === undefined
        ? undefined
        : value.trim().slice(0, MAX_ERROR_MESSAGE_LENGTH);

const createRun = (input: {
    workflow: Workflow;
    runId: string;
    startedAtMs: number;
}): Run => ({
    runId: input.runId,
    workflowId: input.workflow.id,
    workflowVersion: input.workflow.version,
    startedAtMs: input.startedAtMs,
    finishedAtMs: input.startedAtMs,
    steps: [],
    results: {},
    usage: {
        stepCount: 0,
        totalTokens: 0,
        toolCalls: 0,
        deliberationCalls: 0,
        planCalls: 0,
        reviewCalls: 0,
    },
});

const toAttempt = (input: {
    attempt: number;
    executor: Step['executor'];
    startedAtMs: number;
    finishedAtMs: number;
    result: AttemptResult;
}): Attempt => {
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
            : { errorMessage: boundedErrorMessage(input.result.errorMessage) }),
    };
};

const recordRunExecution = (input: {
    run: Run;
    step?: Step;
    usage?: AttemptResult['usage'];
    completedStep?: boolean;
}): void => {
    const state = recordExecution({
        state: {
            startedAtMs: input.run.startedAtMs,
            stepCount: input.run.usage.stepCount,
            toolCallCount: input.run.usage.toolCalls,
            planCallCount: input.run.usage.planCalls,
            reviewCallCount: input.run.usage.reviewCalls,
            deliberationCallCount: input.run.usage.deliberationCalls,
            totalTokens: input.run.usage.totalTokens,
        },
        ...(input.step === undefined ? {} : { activity: input.step.activity }),
        ...(input.usage === undefined ? {} : { usage: input.usage }),
        ...(input.completedStep === true ? { completedStep: true } : {}),
    });
    input.run.usage = {
        stepCount: state.stepCount,
        totalTokens: state.totalTokens,
        toolCalls: state.toolCallCount,
        deliberationCalls: state.deliberationCallCount,
        planCalls: state.planCallCount,
        reviewCalls: state.reviewCallCount,
    };
};

const hasDeclaredOutcome = (step: Step, outcome: string): boolean =>
    Object.prototype.hasOwnProperty.call(step.transitions, outcome);

export type TransitionResolution =
    | { kind: 'declared'; transition: Transition }
    | { kind: 'undeclared_outcome'; outcome: string };

/** Resolves only outcomes declared by the supplied Step. */
export const resolveTransition = (
    step: Step,
    outcome: string
): TransitionResolution => {
    const transition = hasDeclaredOutcome(step, outcome)
        ? step.transitions[outcome]
        : undefined;
    return transition === undefined
        ? { kind: 'undeclared_outcome', outcome }
        : { kind: 'declared', transition };
};

const validateDefinition = (workflow: Workflow): string | undefined => {
    if (workflow.steps[workflow.start] === undefined) {
        return `Workflow start step is not defined: ${workflow.start}`;
    }

    for (const [key, step] of Object.entries(workflow.steps) as [
        string,
        Step,
    ][]) {
        if (step === undefined || step.id !== key) {
            return `Workflow step key does not match step id: ${key}`;
        }
        if (!Array.isArray(step.input)) {
            return `Workflow step input is invalid: ${key}`;
        }
        if (
            (step.maxRuns !== undefined && !isPositiveInteger(step.maxRuns)) ||
            (step.maxAttempts !== undefined &&
                !isPositiveInteger(step.maxAttempts))
        ) {
            return `Workflow step bounds are invalid: ${key}`;
        }
        if (
            step.output !== undefined &&
            (typeof step.output.name !== 'string' ||
                step.output.name.length === 0)
        ) {
            return `Workflow step output is invalid: ${key}`;
        }
        for (const transition of Object.values(step.transitions)) {
            if (transition.kind === 'end') continue;
            if (
                transition.kind !== 'step' ||
                workflow.steps[transition.stepId] === undefined
            ) {
                return `Workflow transition target is not defined: ${key}`;
            }
        }
    }

    return undefined;
};

const collectStepInputs = (input: {
    step: Step;
    results: Readonly<Record<string, Result>>;
}):
    | { results: Readonly<Record<string, Result>> }
    | { missingReference: string } => {
    const selected: Record<string, Result> = {};
    for (const reference of input.step.input) {
        if (reference.kind !== 'result') continue;
        const value = input.results[reference.name];
        if (value === undefined && reference.optional !== true) {
            return { missingReference: reference.name };
        }
        if (value !== undefined) selected[reference.name] = value;
    }
    return { results: selected };
};

const buildRun = (input: {
    run: Run;
    steps: readonly StepRun[];
    results: Readonly<Record<string, Result>>;
    now: number;
}): Run => ({
    ...input.run,
    finishedAtMs: input.now,
    steps: input.steps,
    results: input.results,
});

const finish = (input: {
    run: Run;
    steps: readonly StepRun[];
    results: Readonly<Record<string, Result>>;
    now: () => number;
    status: RunResult['status'];
    termination: RunTermination;
}): RunResult => ({
    status: input.status,
    run: buildRun({
        run: input.run,
        steps: input.steps,
        results: input.results,
        now: input.now(),
    }),
    termination: input.termination,
});

const validateAttemptResult = (input: {
    step: Step;
    result: Result | undefined;
}):
    | { valid: true }
    | { valid: false; expectedName?: string; actualName?: string } => {
    if (input.step.output === undefined) {
        return input.result === undefined
            ? { valid: true }
            : { valid: false, actualName: input.result.name };
    }
    if (input.result === undefined) {
        return { valid: false, expectedName: input.step.output.name };
    }
    return input.result.name === input.step.output.name
        ? { valid: true }
        : {
              valid: false,
              expectedName: input.step.output.name,
              actualName: input.result.name,
          };
};

/**
 * Runs one complete Workflow. Definitions and Execution Contract bounds are
 * rejected before any executor starts; every executor Attempt is then admitted
 * through the shared limits authority.
 */
export const executeWorkflow = async <TContext>(
    input: ExecuteInput<TContext>
): Promise<RunResult> => {
    const now = input.now ?? (() => Date.now());
    const startedAtMs = input.startedAtMs ?? now();
    const run = createRun({
        workflow: input.workflow,
        runId: input.runId ?? `${input.workflow.id}-${startedAtMs}`,
        startedAtMs,
    });
    const steps: StepRun[] = [];
    const results: Record<string, Result> = {};
    let degraded = false;

    const definitionError = validateDefinition(input.workflow);
    if (definitionError !== undefined) {
        return finish({
            run,
            steps,
            results,
            now,
            status: 'rejected',
            termination: {
                reason: 'definition_error',
                message: definitionError,
            },
        });
    }

    const contractError = validateExecutionLimits(input.executionLimits);
    if (contractError !== undefined) {
        return finish({
            run,
            steps,
            results,
            now,
            status: 'rejected',
            termination: {
                reason: 'execution_contract_error',
                message: contractError,
            },
        });
    }

    let currentStepId = input.workflow.start;
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

        const priorRuns = steps.filter(
            (record) => record.stepId === step.id
        ).length;
        if (step.maxRuns !== undefined && priorRuns >= step.maxRuns) {
            return finish({
                run,
                steps,
                results,
                now,
                status: 'limited',
                termination: { reason: 'step_run_limit', stepId: step.id },
            });
        }

        const collected = collectStepInputs({ step, results });
        if ('missingReference' in collected) {
            return finish({
                run,
                steps,
                results,
                now,
                status: 'rejected',
                termination: {
                    reason: 'missing_required_input',
                    stepId: step.id,
                    inputName: collected.missingReference,
                },
            });
        }

        const executor = input.executors[step.executor];
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

        const stepRunNumber = priorRuns + 1;
        const maxAttempts = step.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        const attempts: Attempt[] = [];
        let successfulResult: Result | undefined;
        let successfulOutcome: string | undefined;
        let failed = false;

        for (
            let attemptNumber = 1;
            attemptNumber <= maxAttempts;
            attemptNumber += 1
        ) {
            const executorInput = {
                step,
                context: input.context,
                results: collected.results,
                run: stepRunNumber,
                attempt: attemptNumber,
            };
            const admission = admitExecution({
                state: {
                    startedAtMs: run.startedAtMs,
                    stepCount: run.usage.stepCount,
                    toolCallCount: run.usage.toolCalls,
                    planCallCount: run.usage.planCalls,
                    reviewCallCount: run.usage.reviewCalls,
                    deliberationCallCount: run.usage.deliberationCalls,
                    totalTokens: run.usage.totalTokens,
                },
                limits: input.executionLimits,
                nowMs: now(),
                ...(step.activity === undefined
                    ? {}
                    : { activity: step.activity }),
                tokenReservation: input.reserveTokens?.(executorInput),
            });
            if (!admission.admitted) {
                if (attempts.length > 0) {
                    recordRunExecution({ run, completedStep: true });
                    steps.push({
                        stepId: step.id,
                        run: stepRunNumber,
                        input: step.input,
                        status: 'failed',
                        attempts,
                    });
                }
                if ('error' in admission) {
                    return finish({
                        run,
                        steps,
                        results,
                        now,
                        status: 'rejected',
                        termination: {
                            reason: 'execution_contract_error',
                            message: admission.error,
                        },
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
                        limit: admission.exhaustedBy,
                    },
                });
            }

            const attemptStartedAtMs = now();
            let attemptResult: AttemptResult;
            try {
                attemptResult = await executor(executorInput);
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
            recordRunExecution({
                run,
                step,
                ...(attemptResult.usage === undefined
                    ? {}
                    : { usage: attemptResult.usage }),
            });
            const attempt = toAttempt({
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
                    attempts.push({
                        ...attempt,
                        status: 'rejected',
                        errorCode: 'undeclared_outcome',
                        errorMessage: `Outcome is not declared by step: ${attemptResult.outcome}`,
                    });
                    recordRunExecution({ run, completedStep: true });
                    steps.push({
                        stepId: step.id,
                        run: stepRunNumber,
                        input: step.input,
                        status: 'failed',
                        attempts,
                    });
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

                const resultValidation = validateAttemptResult({
                    step,
                    result: attemptResult.result,
                });
                if (!resultValidation.valid) {
                    attempts.push({
                        ...attempt,
                        status: 'rejected',
                        errorCode: 'invalid_result',
                        errorMessage:
                            'Result does not satisfy the Step output declaration',
                    });
                    recordRunExecution({ run, completedStep: true });
                    steps.push({
                        stepId: step.id,
                        run: stepRunNumber,
                        input: step.input,
                        status: 'failed',
                        attempts,
                    });
                    return finish({
                        run,
                        steps,
                        results,
                        now,
                        status: 'rejected',
                        termination: {
                            reason: 'invalid_result',
                            stepId: step.id,
                            ...(resultValidation.expectedName === undefined
                                ? {}
                                : {
                                      expectedName:
                                          resultValidation.expectedName,
                                  }),
                            ...(resultValidation.actualName === undefined
                                ? {}
                                : { actualName: resultValidation.actualName }),
                        },
                    });
                }

                attempts.push(attempt);
                successfulOutcome = attemptResult.outcome;
                successfulResult = attemptResult.result;
                break;
            }

            degraded = true;
            attempts.push(attempt);
            if (
                attemptResult.retryable === false ||
                attemptNumber === maxAttempts
            ) {
                failed = true;
                break;
            }
        }

        recordRunExecution({ run, completedStep: true });
        steps.push({
            stepId: step.id,
            run: stepRunNumber,
            input: step.input,
            status: failed ? 'failed' : 'succeeded',
            ...(successfulOutcome === undefined
                ? {}
                : { outcome: successfulOutcome }),
            ...(successfulResult === undefined
                ? {}
                : { result: successfulResult }),
            attempts,
        });

        const transition = failed
            ? resolveTransition(step, 'failed')
            : resolveTransition(step, successfulOutcome ?? '');
        if (transition.kind === 'undeclared_outcome') {
            return finish({
                run,
                steps,
                results,
                now,
                status: failed ? 'failed' : 'rejected',
                termination: failed
                    ? { reason: 'step_failed', stepId: step.id }
                    : {
                          reason: 'undeclared_outcome',
                          stepId: step.id,
                          outcome: transition.outcome,
                      },
            });
        }

        if (successfulResult !== undefined)
            results[successfulResult.name] = successfulResult;
        if (transition.transition.kind === 'end') {
            return finish({
                run,
                steps,
                results,
                now,
                status: degraded ? 'degraded' : 'completed',
                termination: { reason: 'finished' },
            });
        }
        currentStepId = transition.transition.stepId;
    }
};
