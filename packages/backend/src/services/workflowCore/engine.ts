/**
 * @description: Executes runtime workflow definitions through declared next outcomes,
 * bounded iterations, and Execution Contract admission before every Attempt.
 * @footnote-scope: core
 * @footnote-module: WorkflowCoreEngine
 * @footnote-risk: high - Routing or admission mistakes can create unbounded or unauthorized execution.
 * @footnote-ethics: high - Backend-owned topology and shared limits constrain model influence.
 */
import {
    admitExecution,
    findObservedExecutionLimit,
    recordAttempt,
    recordStep,
    type ExecutionLimitState,
    type ExhaustedExecutionLimit,
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
    startedAtMs: number;
    finishedAtMs: number;
    result: AttemptResult;
}): Attempt => {
    if (input.result.status === 'succeeded') {
        return {
            attempt: input.attempt,
            status: 'succeeded',
            startedAtMs: input.startedAtMs,
            finishedAtMs: input.finishedAtMs,
            ...(input.result.usage === undefined
                ? {}
                : { usage: input.result.usage }),
            ...(input.result.metadata === undefined
                ? {}
                : { metadata: input.result.metadata }),
        };
    }

    return {
        attempt: input.attempt,
        status: 'failed',
        startedAtMs: input.startedAtMs,
        finishedAtMs: input.finishedAtMs,
        ...(input.result.usage === undefined
            ? {}
            : { usage: input.result.usage }),
        ...(input.result.metadata === undefined
            ? {}
            : { metadata: input.result.metadata }),
        errorCode: input.result.errorCode,
        ...(boundedErrorMessage(input.result.errorMessage) === undefined
            ? {}
            : { errorMessage: boundedErrorMessage(input.result.errorMessage) }),
    };
};

const executionLimitStateFor = (run: Run): ExecutionLimitState => ({
    startedAtMs: run.startedAtMs,
    stepCount: run.usage.stepCount,
    toolCallCount: run.usage.toolCalls,
    planCallCount: run.usage.planCalls,
    reviewCallCount: run.usage.reviewCalls,
    deliberationCallCount: run.usage.deliberationCalls,
    totalTokens: run.usage.totalTokens,
});

const recordRunAttempt = (input: {
    run: Run;
    step?: Step;
    usage?: AttemptResult['usage'];
}): void => {
    const state = recordAttempt({
        state: executionLimitStateFor(input.run),
        ...(input.step === undefined ? {} : { activity: input.step.activity }),
        ...(input.usage === undefined ? {} : { usage: input.usage }),
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

const recordRunStep = (run: Run, step?: Step, successful = true): void => {
    if (
        step?.countsAsWorkflowStep === 'never' ||
        (step?.countsAsWorkflowStep === 'successful' && !successful)
    ) {
        return;
    }
    const state = recordStep({
        state: executionLimitStateFor(run),
        ...(step === undefined ? {} : { activity: step.activity }),
    });
    run.usage = {
        stepCount: state.stepCount,
        totalTokens: state.totalTokens,
        toolCalls: state.toolCallCount,
        deliberationCalls: state.deliberationCallCount,
        planCalls: state.planCallCount,
        reviewCalls: state.reviewCallCount,
    };
};

const canRecoverFromAdmissionLimit = (
    limit: ExhaustedExecutionLimit
): boolean => limit !== 'maxDurationMs' && limit !== 'maxWorkflowSteps';

const hasDeclaredOutcome = (step: Step, outcome: string): boolean =>
    Object.prototype.hasOwnProperty.call(step.next, outcome);

type NextResolution = { next: string | null } | { outcome: string };

/** Resolves only outcomes declared by the supplied Step. */
const resolveNext = (step: Step, outcome: string): NextResolution => {
    const next = hasDeclaredOutcome(step, outcome)
        ? step.next[outcome]
        : undefined;
    return next === undefined ? { outcome } : { next };
};

const validateDefinition = (workflow: Workflow): string | undefined => {
    if (workflow.steps[workflow.start] === undefined) {
        return `Workflow start step is not defined: ${workflow.start}`;
    }

    for (const [key, step] of Object.entries(workflow.steps) as [
        string,
        Step,
    ][]) {
        if (step.input !== undefined && !Array.isArray(step.input)) {
            return `Workflow step input is invalid: ${key}`;
        }
        if (
            (step.maxIterations !== undefined &&
                !isPositiveInteger(step.maxIterations)) ||
            (step.maxAttempts !== undefined &&
                !isPositiveInteger(step.maxAttempts))
        ) {
            return `Workflow step bounds are invalid: ${key}`;
        }
        if (
            step.countsAsWorkflowStep !== undefined &&
            step.countsAsWorkflowStep !== 'always' &&
            step.countsAsWorkflowStep !== 'successful' &&
            step.countsAsWorkflowStep !== 'never'
        ) {
            return `Workflow step counting mode is invalid: ${key}`;
        }
        if (
            step.output !== undefined &&
            (typeof step.output.name !== 'string' ||
                step.output.name.length === 0)
        ) {
            return `Workflow step output is invalid: ${key}`;
        }
        if (
            step.output?.on !== undefined &&
            (!Array.isArray(step.output.on) ||
                step.output.on.length === 0 ||
                step.output.on.some(
                    (outcome) =>
                        typeof outcome !== 'string' ||
                        !Object.prototype.hasOwnProperty.call(
                            step.next,
                            outcome
                        )
                ))
        ) {
            return `Workflow step output requirements are invalid: ${key}`;
        }
        for (const next of Object.values(step.next)) {
            if (next !== null && workflow.steps[next] === undefined) {
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
    for (const reference of input.step.input ?? []) {
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

const isSerializableValue = (
    value: unknown,
    ancestors: ReadonlySet<object> = new Set()
): value is Result => {
    if (
        value === null ||
        typeof value === 'boolean' ||
        typeof value === 'string'
    ) {
        return true;
    }
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object' || ancestors.has(value)) return false;

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);
    if (Array.isArray(value)) {
        return value.every((item) => isSerializableValue(item, nextAncestors));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.values(value).every((item) =>
        isSerializableValue(item, nextAncestors)
    );
};

const validateAttemptResult = (input: {
    step: Step;
    outcome: string;
    result: Result | undefined;
}): boolean => {
    if (input.result !== undefined && !isSerializableValue(input.result)) {
        return false;
    }
    if (input.step.output === undefined) {
        return input.result === undefined;
    }
    const producesResult =
        input.step.output.on === undefined ||
        input.step.output.on.includes(input.outcome);
    return producesResult
        ? input.result !== undefined
        : input.result === undefined;
};

/**
 * Runs one complete Workflow. Definitions and Execution Contract bounds are
 * rejected before any Step handler starts; every Attempt is then admitted
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

        const priorIterations = steps.filter(
            (record) => record.stepId === currentStepId
        ).length;
        if (
            step.maxIterations !== undefined &&
            priorIterations >= step.maxIterations
        ) {
            return finish({
                run,
                steps,
                results,
                now,
                status: 'limited',
                termination: {
                    reason: 'step_iteration_limit',
                    stepId: currentStepId,
                },
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
                    stepId: currentStepId,
                    inputName: collected.missingReference,
                },
            });
        }

        const handler = input.handlers[currentStepId];
        if (handler === undefined) {
            return finish({
                run,
                steps,
                results,
                now,
                status: 'rejected',
                termination: {
                    reason: 'handler_unavailable',
                    stepId: currentStepId,
                },
            });
        }

        const stepRunNumber = priorIterations + 1;
        const maxAttempts = step.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        const attempts: Attempt[] = [];
        let successfulResult: Result | undefined;
        let successfulOutcome: string | undefined;
        let failed = false;
        let observedLimit: ExhaustedExecutionLimit | undefined;
        let admissionBlocked = false;

        for (
            let attemptNumber = 1;
            attemptNumber <= maxAttempts;
            attemptNumber += 1
        ) {
            const handlerInput = {
                stepId: currentStepId,
                context: input.context,
                results: collected.results,
                execution: executionLimitStateFor(run),
                iteration: stepRunNumber,
                attempt: attemptNumber,
            };
            const executionBeforeAttempt = executionLimitStateFor(run);
            const reservation = input.reserveAttempt?.(
                handlerInput,
                executionBeforeAttempt
            );
            const admission = admitExecution({
                state: executionLimitStateFor(run),
                limits: input.executionLimits,
                nowMs: now(),
                ...(step.activity === undefined
                    ? {}
                    : { activity: step.activity }),
                ...(step.countsAsWorkflowStep === 'never'
                    ? { countsAsWorkflowStep: 'never' as const }
                    : {}),
                ...(reservation === undefined ? {} : { reservation }),
            });
            if (!admission.admitted) {
                if ('error' in admission) {
                    if (attempts.length > 0) {
                        recordRunStep(run, step);
                        steps.push({
                            stepId: currentStepId,
                            iteration: stepRunNumber,
                            status: 'failed',
                            attempts,
                        });
                    }
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
                if (canRecoverFromAdmissionLimit(admission.exhaustedBy)) {
                    if (
                        attempts.length === 0 &&
                        step.countsAsWorkflowStep === 'successful'
                    ) {
                        observedLimit = admission.exhaustedBy;
                        break;
                    }
                    const admissionAtMs = now();
                    attempts.push({
                        attempt: attemptNumber,
                        status: 'rejected',
                        startedAtMs: admissionAtMs,
                        finishedAtMs: admissionAtMs,
                        errorCode: 'execution_limit',
                        exhaustedLimit: admission.exhaustedBy,
                        errorMessage: `Execution Contract limit blocks Attempt: ${admission.exhaustedBy}`,
                    });
                    failed = true;
                    admissionBlocked = true;
                    observedLimit = admission.exhaustedBy;
                    break;
                }
                if (attempts.length > 0) {
                    recordRunStep(run, step);
                    steps.push({
                        stepId: currentStepId,
                        iteration: stepRunNumber,
                        status: 'failed',
                        attempts,
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
                attemptResult = await handler(handlerInput);
            } catch (error) {
                attemptResult = {
                    status: 'failed',
                    errorCode: 'handler_error',
                    errorMessage:
                        error instanceof Error ? error.message : String(error),
                    retryable: true,
                };
            }
            const attemptFinishedAtMs = now();
            recordRunAttempt({
                run,
                step,
                ...(attemptResult.usage === undefined
                    ? {}
                    : { usage: attemptResult.usage }),
            });
            observedLimit = findObservedExecutionLimit({
                state: executionLimitStateFor(run),
                limits: input.executionLimits,
                nowMs: now(),
            });
            const attempt = toAttempt({
                attempt: attemptNumber,
                startedAtMs: attemptStartedAtMs,
                finishedAtMs: attemptFinishedAtMs,
                result: attemptResult,
            });

            if (attemptResult.status === 'succeeded') {
                const transition = resolveNext(step, attemptResult.outcome);
                if ('outcome' in transition) {
                    attempts.push({
                        ...attempt,
                        status: 'rejected',
                        errorCode: 'undeclared_outcome',
                        errorMessage: `Outcome is not declared by step: ${attemptResult.outcome}`,
                    });
                    recordRunStep(run);
                    steps.push({
                        stepId: currentStepId,
                        iteration: stepRunNumber,
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
                            stepId: currentStepId,
                            outcome: transition.outcome,
                        },
                    });
                }

                const resultValidation = validateAttemptResult({
                    step,
                    outcome: attemptResult.outcome,
                    result: attemptResult.result,
                });
                if (!resultValidation) {
                    attempts.push({
                        ...attempt,
                        status: 'rejected',
                        errorCode: 'invalid_result',
                        errorMessage:
                            'Result does not satisfy the Step output declaration',
                    });
                    recordRunStep(run);
                    steps.push({
                        stepId: currentStepId,
                        iteration: stepRunNumber,
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
                            stepId: currentStepId,
                        },
                    });
                }

                attempts.push(attempt);
                successfulOutcome = attemptResult.outcome;
                successfulResult = attemptResult.result;
                break;
            }

            attempts.push(attempt);
            if (observedLimit !== undefined) {
                failed = true;
                break;
            }
            if (
                attemptResult.retryable === false ||
                attemptNumber === maxAttempts
            ) {
                failed = true;
                break;
            }
        }

        if (observedLimit !== undefined && attempts.length === 0) {
            return finish({
                run,
                steps,
                results,
                now,
                status: 'limited',
                termination: {
                    reason: 'execution_limit',
                    limit: observedLimit,
                },
            });
        }
        recordRunStep(run, step, !failed);
        steps.push({
            stepId: currentStepId,
            iteration: stepRunNumber,
            status: failed ? 'failed' : 'succeeded',
            ...(successfulOutcome === undefined
                ? {}
                : { outcome: successfulOutcome }),
            ...(successfulResult === undefined
                ? {}
                : { result: successfulResult }),
            attempts,
        });

        if (successfulResult !== undefined) {
            if (step.output !== undefined)
                results[step.output.name] = successfulResult;
        } else if (
            successfulOutcome !== undefined &&
            step.output !== undefined
        ) {
            // A successful outcome that omits this output clears the previous value.
            delete results[step.output.name];
        }
        if (observedLimit !== undefined && !admissionBlocked) {
            return finish({
                run,
                steps,
                results,
                now,
                status: 'limited',
                termination: {
                    reason: 'execution_limit',
                    limit: observedLimit,
                },
            });
        }

        const transition = failed
            ? resolveNext(step, 'failed')
            : resolveNext(step, successfulOutcome ?? '');
        if ('outcome' in transition) {
            return finish({
                run,
                steps,
                results,
                now,
                status: failed ? 'failed' : 'rejected',
                termination: failed
                    ? { reason: 'step_failed', stepId: currentStepId }
                    : {
                          reason: 'undeclared_outcome',
                          stepId: currentStepId,
                          outcome: transition.outcome,
                      },
            });
        }

        // A retried Attempt can recover normally. Degrade only once this Step
        // has exhausted Attempts and follows its declared failure route.
        if (failed) degraded = true;

        if (transition.next === null) {
            return finish({
                run,
                steps,
                results,
                now,
                status: degraded ? 'degraded' : 'completed',
                termination: { reason: 'finished' },
            });
        }
        currentStepId = transition.next;
    }
};
