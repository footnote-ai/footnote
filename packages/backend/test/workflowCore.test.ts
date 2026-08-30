/**
 * @description: Verifies the non-live workflow foundation's runtime dataflow,
 * explicit transitions, bounded attempts, and shared Execution Contract admission.
 * @footnote-scope: test
 * @footnote-module: WorkflowCoreTests
 * @footnote-risk: medium - Missing core coverage can permit unbounded or model-routed workflows.
 * @footnote-ethics: high - Explicit backend-owned topology prevents model output from gaining execution authority.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CURRENT_REVIEWED_CHAT_WORKFLOW,
    executeWorkflow,
    result,
    type AttemptResult,
    type ExecutionLimits,
    type Executors,
    type InputRef,
    type Step,
    type Transition,
    type Workflow,
} from '../src/services/workflowCore/index.js';

type TestContext = { requestId: string };

const limits: ExecutionLimits = {
    maxWorkflowSteps: 20,
    maxToolCalls: 2,
    maxDeliberationCalls: 10,
    maxTokensTotal: 1_000,
    maxDurationMs: 10_000,
};

const step = (input: {
    id: string;
    transitions: Readonly<Record<string, Transition>>;
    input?: readonly InputRef[];
    output?: string;
    outputRequiredOn?: readonly string[];
    activity?: Step['activity'];
    maxRuns?: number;
    maxAttempts?: number;
    executor?: Step['executor'];
}): Step => ({
    id: input.id,
    executor: input.executor ?? 'code',
    ...(input.activity === undefined ? {} : { activity: input.activity }),
    input: input.input ?? [],
    ...(input.output === undefined
        ? {}
        : {
              output: {
                  name: input.output,
                  ...(input.outputRequiredOn === undefined
                      ? {}
                      : { requiredOn: input.outputRequiredOn }),
              },
          }),
    transitions: input.transitions,
    ...(input.maxRuns === undefined ? {} : { maxRuns: input.maxRuns }),
    ...(input.maxAttempts === undefined
        ? {}
        : { maxAttempts: input.maxAttempts }),
});

const workflow = (
    steps: Readonly<Record<string, Step>>,
    start = Object.keys(steps)[0] ?? 'missing'
): Workflow => ({
    id: `test-${start}`,
    version: 'v1',
    start,
    steps,
});

const runWith = async (input: {
    definition: Workflow;
    behavior: Readonly<Record<string, readonly AttemptResult[]>>;
    executionLimits?: ExecutionLimits;
    executors?: Executors<TestContext>;
    now?: () => number;
    reserveAttempt?: () => { tokens?: number; toolCalls?: number };
}) => {
    const remaining = new Map(
        Object.entries(input.behavior).map(([stepId, outcomes]) => [
            stepId,
            [...outcomes],
        ])
    );
    const executors: Executors<TestContext> = {
        code: async ({ step: executingStep }) =>
            remaining.get(executingStep.id)?.shift() ?? {
                status: 'succeeded',
                outcome: 'done',
            },
        ...input.executors,
    };
    return executeWorkflow({
        workflow: input.definition,
        context: { requestId: 'req-1' },
        executors,
        executionLimits: input.executionLimits ?? limits,
        startedAtMs: 0,
        now: input.now ?? (() => 1),
        reserveAttempt: input.reserveAttempt,
    });
};

test('runs declared dataflow and gives executors the full Step, Results, and one-based ordinals', async () => {
    const definition = workflow({
        plan: step({
            id: 'plan',
            output: 'plan',
            transitions: { done: { kind: 'step', stepId: 'write' } },
        }),
        write: step({
            id: 'write',
            input: [{ kind: 'result', name: 'plan' }],
            output: 'draft',
            transitions: { done: { kind: 'end' } },
        }),
    });
    const seen: Array<{
        stepId: string;
        resultNames: string[];
        run: number;
        attempt: number;
    }> = [];

    const execution = await runWith({
        definition,
        behavior: {},
        executors: {
            code: async ({ step: executingStep, results, run, attempt }) => {
                seen.push({
                    stepId: executingStep.id,
                    resultNames: Object.keys(results),
                    run,
                    attempt,
                });
                return executingStep.id === 'plan'
                    ? {
                          status: 'succeeded',
                          outcome: 'done',
                          result: result('plan', { route: 'write' }),
                      }
                    : {
                          status: 'succeeded',
                          outcome: 'done',
                          result: result('draft', { text: 'answer' }),
                      };
            },
        },
    });

    assert.equal(execution.status, 'completed');
    assert.deepEqual(seen, [
        { stepId: 'plan', resultNames: [], run: 1, attempt: 1 },
        { stepId: 'write', resultNames: ['plan'], run: 1, attempt: 1 },
    ]);
    assert.deepEqual(execution.run.results.plan?.value, { route: 'write' });
});

test('supports a bounded generic style -> check -> retry cycle without special engine branches', async () => {
    const definition = workflow(
        {
            style: step({
                id: 'style',
                maxRuns: 2,
                transitions: { done: { kind: 'step', stepId: 'check' } },
            }),
            check: step({
                id: 'check',
                transitions: { retry: { kind: 'step', stepId: 'style' } },
            }),
        },
        'style'
    );

    const execution = await runWith({
        definition,
        behavior: {
            style: [
                { status: 'succeeded', outcome: 'done' },
                { status: 'succeeded', outcome: 'done' },
            ],
            check: [
                { status: 'succeeded', outcome: 'retry' },
                { status: 'succeeded', outcome: 'retry' },
            ],
        },
    });

    assert.equal(execution.status, 'limited');
    assert.deepEqual(
        execution.run.steps.map((record) => record.stepId),
        ['style', 'check', 'style', 'check']
    );
    assert.deepEqual(execution.termination, {
        reason: 'step_run_limit',
        stepId: 'style',
    });
});

test('rejects undeclared executor outcomes', async () => {
    const execution = await runWith({
        definition: workflow({
            plan: step({
                id: 'plan',
                transitions: { done: { kind: 'end' } },
            }),
        }),
        behavior: { plan: [{ status: 'succeeded', outcome: 'secret' }] },
    });

    assert.equal(execution.status, 'rejected');
    assert.equal(execution.termination.reason, 'undeclared_outcome');
    assert.equal(execution.run.steps[0]?.attempts[0]?.status, 'rejected');
});

test('routes an optional Step failure as degraded while preserving earlier Results', async () => {
    const execution = await runWith({
        definition: workflow({
            plan: step({
                id: 'plan',
                output: 'plan',
                transitions: { done: { kind: 'step', stepId: 'style' } },
            }),
            style: step({
                id: 'style',
                maxAttempts: 2,
                input: [{ kind: 'result', name: 'plan' }],
                transitions: { failed: { kind: 'step', stepId: 'write' } },
            }),
            write: step({
                id: 'write',
                input: [
                    { kind: 'result', name: 'plan' },
                    { kind: 'result', name: 'style', optional: true },
                ],
                transitions: { done: { kind: 'end' } },
            }),
        }),
        behavior: {
            plan: [
                {
                    status: 'succeeded',
                    outcome: 'done',
                    result: result('plan', { route: 'write' }),
                },
            ],
            style: [
                { status: 'failed', errorCode: 'temporary', retryable: true },
                { status: 'failed', errorCode: 'temporary', retryable: false },
            ],
            write: [{ status: 'succeeded', outcome: 'done' }],
        },
    });

    assert.equal(execution.status, 'degraded');
    assert.deepEqual(execution.run.results.plan?.value, { route: 'write' });
    assert.equal(execution.run.results.style, undefined);
    assert.equal(execution.run.steps[1]?.attempts.length, 2);
});

test('marks explicit default-plan recovery as degraded', async () => {
    const execution = await runWith({
        definition: workflow({
            plan: step({
                id: 'plan',
                transitions: {
                    failed: { kind: 'step', stepId: 'defaultPlan' },
                },
            }),
            defaultPlan: step({
                id: 'defaultPlan',
                output: 'plan',
                transitions: { done: { kind: 'step', stepId: 'finish' } },
            }),
            finish: step({
                id: 'finish',
                input: [{ kind: 'result', name: 'plan' }],
                transitions: { done: { kind: 'end' } },
            }),
        }),
        behavior: {
            plan: [
                {
                    status: 'failed',
                    errorCode: 'planner_unavailable',
                    retryable: false,
                },
            ],
            defaultPlan: [
                {
                    status: 'succeeded',
                    outcome: 'done',
                    result: result('plan', { fallback: true }),
                },
            ],
            finish: [{ status: 'succeeded', outcome: 'done' }],
        },
    });

    assert.equal(execution.status, 'degraded');
    assert.deepEqual(
        execution.run.steps.map((record) => record.stepId),
        ['plan', 'defaultPlan', 'finish']
    );
});

test('keeps a Run completed when a retryable Attempt succeeds within its Step', async () => {
    const execution = await runWith({
        definition: workflow({
            write: step({
                id: 'write',
                maxAttempts: 2,
                transitions: { done: { kind: 'end' } },
            }),
        }),
        behavior: {
            write: [
                { status: 'failed', errorCode: 'temporary', retryable: true },
                { status: 'succeeded', outcome: 'done' },
            ],
        },
    });

    assert.equal(execution.status, 'completed');
    assert.deepEqual(
        execution.run.steps[0]?.attempts.map((attempt) => attempt.status),
        ['failed', 'succeeded']
    );
});

test('counts a retried plan or review Step once against its semantic cycle cap', async () => {
    for (const [stepId, activity, cycleLimit] of [
        ['plan', { deliberation: 'plan' }, { maxPlanCycles: 1 }],
        ['review', { deliberation: 'review' }, { maxReviewCycles: 1 }],
    ] as const) {
        const execution = await runWith({
            definition: workflow({
                [stepId]: step({
                    id: stepId,
                    activity,
                    maxAttempts: 2,
                    transitions: { done: { kind: 'end' } },
                }),
            }),
            behavior: {
                [stepId]: [
                    {
                        status: 'failed',
                        errorCode: 'temporary',
                        retryable: true,
                    },
                    { status: 'succeeded', outcome: 'done' },
                ],
            },
            executionLimits: { ...limits, ...cycleLimit },
        });

        assert.equal(execution.status, 'completed', stepId);
        assert.equal(execution.run.usage.planCalls, stepId === 'plan' ? 1 : 0);
        assert.equal(
            execution.run.usage.reviewCalls,
            stepId === 'review' ? 1 : 0
        );
        assert.equal(execution.run.usage.deliberationCalls, 2);
    }
});

test('allows declared skipped outcomes to omit Results while retaining required output outcomes', async () => {
    const definition = workflow({
        presentation: step({
            id: 'presentation',
            output: 'presentation',
            outputRequiredOn: ['admitted'],
            transitions: {
                admitted: { kind: 'end' },
                skipped: { kind: 'end' },
            },
        }),
    });

    const skipped = await runWith({
        definition,
        behavior: {
            presentation: [{ status: 'succeeded', outcome: 'skipped' }],
        },
    });
    const admittedWithoutResult = await runWith({
        definition,
        behavior: {
            presentation: [{ status: 'succeeded', outcome: 'admitted' }],
        },
    });

    assert.equal(skipped.status, 'completed');
    assert.equal(skipped.run.results.presentation, undefined);
    assert.deepEqual(admittedWithoutResult.termination, {
        reason: 'invalid_result',
        stepId: 'presentation',
        expectedName: 'presentation',
    });
});

test('rejects invalid definitions before any executor runs', async () => {
    const invalidDefinitions: readonly Workflow[] = [
        workflow({}, 'missing'),
        workflow(
            {
                key: step({
                    id: 'different',
                    transitions: { done: { kind: 'end' } },
                }),
            },
            'key'
        ),
        workflow({
            first: step({
                id: 'first',
                transitions: { done: { kind: 'step', stepId: 'missing' } },
            }),
        }),
    ];

    for (const definition of invalidDefinitions) {
        let calls = 0;
        const execution = await runWith({
            definition,
            behavior: {},
            executors: {
                code: async () => {
                    calls += 1;
                    return { status: 'succeeded', outcome: 'done' };
                },
            },
        });
        assert.equal(execution.status, 'rejected');
        assert.equal(execution.termination.reason, 'definition_error');
        assert.equal(calls, 0);
    }
});

test('requires the declared Result and accepts outputless Steps only without Results', async () => {
    const cases: ReadonlyArray<{
        name: string;
        definition: Workflow;
        response: AttemptResult;
        expected: { expectedName?: string; actualName?: string } | 'completed';
    }> = [
        {
            name: 'required Result',
            definition: workflow({
                write: step({
                    id: 'write',
                    output: 'draft',
                    transitions: { done: { kind: 'end' } },
                }),
            }),
            response: {
                status: 'succeeded',
                outcome: 'done',
                result: result('draft', 'ok'),
            },
            expected: 'completed',
        },
        {
            name: 'missing Result',
            definition: workflow({
                write: step({
                    id: 'write',
                    output: 'draft',
                    transitions: { done: { kind: 'end' } },
                }),
            }),
            response: { status: 'succeeded', outcome: 'done' },
            expected: { expectedName: 'draft' },
        },
        {
            name: 'mismatched Result',
            definition: workflow({
                write: step({
                    id: 'write',
                    output: 'draft',
                    transitions: { done: { kind: 'end' } },
                }),
            }),
            response: {
                status: 'succeeded',
                outcome: 'done',
                result: result('other', 'bad'),
            },
            expected: { expectedName: 'draft', actualName: 'other' },
        },
        {
            name: 'undeclared Result',
            definition: workflow({
                write: step({
                    id: 'write',
                    transitions: { done: { kind: 'end' } },
                }),
            }),
            response: {
                status: 'succeeded',
                outcome: 'done',
                result: result('unexpected', 'bad'),
            },
            expected: { actualName: 'unexpected' },
        },
        {
            name: 'outputless Step',
            definition: workflow({
                write: step({
                    id: 'write',
                    transitions: { done: { kind: 'end' } },
                }),
            }),
            response: { status: 'succeeded', outcome: 'done' },
            expected: 'completed',
        },
    ];

    for (const item of cases) {
        const execution = await runWith({
            definition: item.definition,
            behavior: { write: [item.response] },
        });
        if (item.expected === 'completed') {
            assert.equal(execution.status, 'completed', item.name);
            continue;
        }
        assert.equal(execution.status, 'rejected', item.name);
        assert.deepEqual(
            execution.termination,
            { reason: 'invalid_result', stepId: 'write', ...item.expected },
            item.name
        );
    }
});

test('keeps unavailable executors separate from declared failure recovery', async () => {
    const execution = await executeWorkflow({
        workflow: workflow({
            retrieve: step({
                id: 'retrieve',
                transitions: { failed: { kind: 'end' } },
            }),
        }),
        context: { requestId: 'req-1' },
        executors: {},
        executionLimits: limits,
        startedAtMs: 0,
        now: () => 1,
    });

    assert.deepEqual(execution.termination, {
        reason: 'executor_unavailable',
        stepId: 'retrieve',
    });
    assert.equal(execution.run.steps.length, 0);
});

test('uses shared admission before every retry and supplies distinct Attempt ordinals', async () => {
    const attempts: number[] = [];
    const execution = await executeWorkflow({
        workflow: workflow({
            retrieve: step({
                id: 'retrieve',
                activity: { tool: 'one-or-more' },
                maxAttempts: 3,
                transitions: { failed: { kind: 'end' } },
            }),
        }),
        context: { requestId: 'req-1' },
        executors: {
            code: async ({ attempt }) => {
                attempts.push(attempt);
                return {
                    status: 'failed',
                    errorCode: 'temporary',
                    retryable: true,
                    usage: { toolCalls: 1 },
                };
            },
        },
        executionLimits: { ...limits, maxToolCalls: 2 },
        startedAtMs: 0,
        now: () => 1,
    });

    assert.deepEqual(attempts, [1, 2]);
    assert.equal(execution.status, 'degraded');
    assert.deepEqual(execution.termination, { reason: 'finished' });
});

test('calculates Attempt reservations for each concrete Attempt', async () => {
    const reservations: number[] = [];
    let executorCalls = 0;
    const execution = await executeWorkflow({
        workflow: workflow({
            write: step({
                id: 'write',
                maxAttempts: 2,
                transitions: { failed: { kind: 'end' } },
            }),
        }),
        context: { requestId: 'req-1' },
        executors: {
            code: async () => {
                executorCalls += 1;
                return {
                    status: 'failed',
                    errorCode: 'temporary',
                    retryable: true,
                    usage: { totalTokens: 3 },
                };
            },
        },
        executionLimits: { ...limits, maxTokensTotal: 8 },
        startedAtMs: 0,
        now: () => 1,
        reserveAttempt: ({ attempt }) => {
            reservations.push(attempt);
            return { tokens: attempt === 1 ? 3 : 6 };
        },
    });

    assert.deepEqual(reservations, [1, 2]);
    assert.equal(executorCalls, 1);
    assert.equal(execution.status, 'degraded');
    assert.deepEqual(execution.termination, { reason: 'finished' });
});

test('rejects a projected tool reservation before a tool Attempt executes', async () => {
    let executorCalls = 0;
    const execution = await executeWorkflow({
        workflow: workflow({
            context: step({
                id: 'context',
                activity: { tool: 'one-or-more' },
                transitions: { failed: { kind: 'end' }, done: { kind: 'end' } },
            }),
        }),
        context: { requestId: 'req-1' },
        executors: {
            code: async () => {
                executorCalls += 1;
                return { status: 'succeeded', outcome: 'done' };
            },
        },
        executionLimits: { ...limits, maxToolCalls: 2 },
        startedAtMs: 0,
        now: () => 1,
        reserveAttempt: () => ({ toolCalls: 3 }),
    });

    assert.equal(executorCalls, 0);
    assert.equal(execution.status, 'degraded');
    assert.deepEqual(execution.termination, { reason: 'finished' });
});

test('routes a recoverably admission-blocked optional Step through its declared failure transition', async () => {
    const execution = await executeWorkflow({
        workflow: workflow({
            presentation: step({
                id: 'presentation',
                output: 'presentation',
                outputRequiredOn: ['admitted'],
                transitions: {
                    admitted: { kind: 'step', stepId: 'write' },
                    failed: { kind: 'step', stepId: 'write' },
                },
            }),
            write: step({
                id: 'write',
                transitions: {
                    failed: { kind: 'end' },
                    done: { kind: 'end' },
                },
            }),
        }),
        context: { requestId: 'req-1' },
        executors: {
            code: async ({ step: executingStep }) => ({
                status: 'succeeded',
                outcome: executingStep.id === 'write' ? 'done' : 'admitted',
            }),
        },
        executionLimits: { ...limits, maxTokensTotal: 5 },
        startedAtMs: 0,
        now: () => 1,
        reserveAttempt: ({ step: executingStep }) =>
            executingStep.id === 'presentation' ? { tokens: 6 } : undefined,
    });

    assert.equal(execution.status, 'degraded');
    assert.deepEqual(
        execution.run.steps.map((record) => record.stepId),
        ['presentation', 'write']
    );
    assert.equal(execution.run.steps[0]?.attempts[0]?.status, 'rejected');
});

test('routes a retry blocked by consumed tokens through Step recovery', async () => {
    const execution = await executeWorkflow({
        workflow: workflow({
            presentation: step({
                id: 'presentation',
                maxAttempts: 2,
                transitions: { failed: { kind: 'step', stepId: 'write' } },
            }),
            write: step({
                id: 'write',
                transitions: {
                    failed: { kind: 'end' },
                    done: { kind: 'end' },
                },
            }),
        }),
        context: { requestId: 'req-1' },
        executors: {
            code: async ({ step: executingStep }) =>
                executingStep.id === 'presentation'
                    ? {
                          status: 'failed',
                          errorCode: 'temporary',
                          retryable: true,
                          usage: { totalTokens: 3 },
                      }
                    : { status: 'succeeded', outcome: 'done' },
        },
        executionLimits: { ...limits, maxTokensTotal: 5 },
        startedAtMs: 0,
        now: () => 1,
        reserveAttempt: ({ step: executingStep }) =>
            executingStep.id === 'presentation' ? { tokens: 3 } : undefined,
    });

    assert.equal(execution.status, 'degraded');
    assert.deepEqual(
        execution.run.steps[0]?.attempts.map((attempt) => attempt.status),
        ['failed', 'rejected']
    );
    assert.equal(execution.run.steps[1]?.stepId, 'write');
});

test('allows explicit zero-token finalization after token exhaustion recovers a valid Draft', async () => {
    let reviewCalls = 0;
    let finishCalls = 0;
    const execution = await executeWorkflow({
        workflow: workflow({
            write: step({
                id: 'write',
                output: 'draft',
                transitions: { generated: { kind: 'step', stepId: 'review' } },
            }),
            review: step({
                id: 'review',
                activity: { deliberation: 'review' },
                input: [{ kind: 'result', name: 'draft' }],
                transitions: { failed: { kind: 'step', stepId: 'finish' } },
            }),
            finish: step({
                id: 'finish',
                output: 'answer',
                input: [{ kind: 'result', name: 'draft' }],
                transitions: { done: { kind: 'end' } },
            }),
        }),
        context: { requestId: 'req-1' },
        executors: {
            code: async ({ step: executingStep }) => {
                if (executingStep.id === 'write') {
                    return {
                        status: 'succeeded',
                        outcome: 'generated',
                        result: result('draft', 'last good draft'),
                        usage: { totalTokens: 3 },
                    };
                }
                if (executingStep.id === 'review') {
                    reviewCalls += 1;
                    return { status: 'succeeded', outcome: 'done' };
                }
                finishCalls += 1;
                return {
                    status: 'succeeded',
                    outcome: 'done',
                    result: result('answer', 'finalized draft'),
                };
            },
        },
        executionLimits: { ...limits, maxTokensTotal: 3 },
        startedAtMs: 0,
        now: () => 1,
        reserveAttempt: ({ step: executingStep }) => {
            if (executingStep.id === 'review') return { tokens: 1 };
            if (executingStep.id === 'finish') return { tokens: 0 };
            return undefined;
        },
    });

    assert.equal(reviewCalls, 0);
    assert.equal(finishCalls, 1);
    assert.equal(execution.status, 'degraded');
    assert.equal(execution.run.results.draft?.value, 'last good draft');
    assert.equal(execution.run.results.answer?.value, 'finalized draft');
});

test('stops on observed resource overruns while retaining valid prior Results', async () => {
    const tokenOverrun = await executeWorkflow({
        workflow: workflow({
            write: step({
                id: 'write',
                output: 'draft',
                transitions: { done: { kind: 'end' } },
            }),
        }),
        context: { requestId: 'req-1' },
        executors: {
            code: async () => ({
                status: 'succeeded',
                outcome: 'done',
                result: result('draft', 'kept'),
                usage: { totalTokens: 4 },
            }),
        },
        executionLimits: { ...limits, maxTokensTotal: 3 },
        startedAtMs: 0,
        now: () => 1,
        reserveAttempt: () => ({ tokens: 1 }),
    });

    const toolOverrun = await executeWorkflow({
        workflow: workflow({
            retrieve: step({
                id: 'retrieve',
                activity: { tool: 'one-or-more' },
                transitions: { done: { kind: 'end' } },
            }),
        }),
        context: { requestId: 'req-1' },
        executors: {
            code: async () => ({
                status: 'succeeded',
                outcome: 'done',
                usage: { toolCalls: 3 },
            }),
        },
        executionLimits: { ...limits, maxToolCalls: 2 },
        startedAtMs: 0,
        now: () => 1,
        reserveAttempt: () => ({ toolCalls: 1 }),
    });

    const reviewOverrun = await executeWorkflow({
        workflow: workflow({
            write: step({
                id: 'write',
                output: 'draft',
                transitions: { generated: { kind: 'step', stepId: 'review' } },
            }),
            review: step({
                id: 'review',
                activity: { deliberation: 'review' },
                input: [{ kind: 'result', name: 'draft' }],
                output: 'review',
                transitions: { revise: { kind: 'end' } },
            }),
        }),
        context: { requestId: 'req-1' },
        executors: {
            code: async ({ step: executingStep }) =>
                executingStep.id === 'write'
                    ? {
                          status: 'succeeded',
                          outcome: 'generated',
                          result: result('draft', 'prior draft'),
                      }
                    : {
                          status: 'succeeded',
                          outcome: 'revise',
                          result: result('review', 'retry'),
                          usage: { totalTokens: 4 },
                      },
        },
        executionLimits: { ...limits, maxTokensTotal: 3 },
        startedAtMs: 0,
        now: () => 1,
        reserveAttempt: ({ step: executingStep }) =>
            executingStep.id === 'review' ? { tokens: 1 } : undefined,
    });

    let time = 0;
    const durationOverrun = await executeWorkflow({
        workflow: workflow({
            write: step({
                id: 'write',
                transitions: { done: { kind: 'end' } },
            }),
        }),
        context: { requestId: 'req-1' },
        executors: {
            code: async () => {
                time = 2;
                return { status: 'succeeded', outcome: 'done' };
            },
        },
        executionLimits: { ...limits, maxDurationMs: 1 },
        startedAtMs: 0,
        now: () => time,
    });

    assert.deepEqual(tokenOverrun.termination, {
        reason: 'execution_limit',
        limit: 'maxTokensTotal',
    });
    assert.equal(tokenOverrun.run.results.draft?.value, 'kept');
    assert.deepEqual(toolOverrun.termination, {
        reason: 'execution_limit',
        limit: 'maxToolCalls',
    });
    assert.deepEqual(reviewOverrun.termination, {
        reason: 'execution_limit',
        limit: 'maxTokensTotal',
    });
    assert.equal(reviewOverrun.run.results.draft?.value, 'prior draft');
    assert.deepEqual(durationOverrun.termination, {
        reason: 'execution_limit',
        limit: 'maxDurationMs',
    });
});

test('applies canonical caps, reservation, duration, and presentation accounting through shared admission', async () => {
    const reservation = await runWith({
        definition: workflow({
            write: step({
                id: 'write',
                transitions: {
                    failed: { kind: 'end' },
                    done: { kind: 'end' },
                },
            }),
        }),
        behavior: { write: [{ status: 'succeeded', outcome: 'done' }] },
        executionLimits: { ...limits, maxTokensTotal: 10 },
        reserveAttempt: () => ({ tokens: 11 }),
    });
    assert.equal(reservation.run.steps.length, 1);
    assert.equal(reservation.status, 'degraded');

    const duration = await runWith({
        definition: workflow({
            write: step({
                id: 'write',
                transitions: { done: { kind: 'end' } },
            }),
        }),
        behavior: { write: [{ status: 'succeeded', outcome: 'done' }] },
        executionLimits: { ...limits, maxDurationMs: 1 },
        now: () => 1,
    });
    assert.equal(duration.run.steps.length, 0);
    assert.deepEqual(duration.termination, {
        reason: 'execution_limit',
        limit: 'maxDurationMs',
    });

    const presentation = await runWith({
        definition: workflow({
            presentation: step({
                id: 'presentation',
                activity: { deliberation: 'none' },
                transitions: { done: { kind: 'end' } },
            }),
        }),
        behavior: {
            presentation: [
                {
                    status: 'succeeded',
                    outcome: 'done',
                    usage: { deliberationCalls: 1 },
                },
            ],
        },
        executionLimits: { ...limits, maxDeliberationCalls: 0 },
    });
    assert.equal(presentation.status, 'completed');
    assert.equal(presentation.run.usage.deliberationCalls, 0);
});

test('rejects malformed Execution Contracts before a Step executes', async () => {
    let calls = 0;
    const execution = await runWith({
        definition: workflow({
            first: step({
                id: 'first',
                transitions: { done: { kind: 'end' } },
            }),
        }),
        behavior: {},
        executionLimits: { ...limits, maxTokensTotal: Number.NaN },
        executors: {
            code: async () => {
                calls += 1;
                return { status: 'succeeded', outcome: 'done' };
            },
        },
    });

    assert.equal(calls, 0);
    assert.deepEqual(execution.termination, {
        reason: 'execution_contract_error',
        message: 'Execution Contract limit is invalid: maxTokensTotal',
    });
});

test('describes the current non-live reviewed-chat topology honestly', () => {
    assert.equal(CURRENT_REVIEWED_CHAT_WORKFLOW.start, 'plan');
    assert.deepEqual(Object.keys(CURRENT_REVIEWED_CHAT_WORKFLOW.steps), [
        'plan',
        'defaultPlan',
        'retrieve',
        'presentation',
        'write',
        'review',
        'replan',
        'finish',
    ]);
    assert.deepEqual(
        CURRENT_REVIEWED_CHAT_WORKFLOW.steps.plan?.transitions.failed,
        {
            kind: 'step',
            stepId: 'defaultPlan',
        }
    );
    assert.equal(
        CURRENT_REVIEWED_CHAT_WORKFLOW.steps.defaultPlan?.executor,
        'code'
    );
    assert.equal(
        CURRENT_REVIEWED_CHAT_WORKFLOW.steps.defaultPlan?.output?.name,
        'plan'
    );
    assert.deepEqual(
        CURRENT_REVIEWED_CHAT_WORKFLOW.steps.presentation?.activity,
        {
            deliberation: 'none',
        }
    );
    assert.deepEqual(
        CURRENT_REVIEWED_CHAT_WORKFLOW.steps.presentation?.output?.requiredOn,
        ['admitted']
    );
    assert.equal(CURRENT_REVIEWED_CHAT_WORKFLOW.steps.presentation?.maxRuns, 1);
    assert.equal(
        CURRENT_REVIEWED_CHAT_WORKFLOW.steps.presentation?.maxAttempts,
        undefined
    );
    assert.equal(CURRENT_REVIEWED_CHAT_WORKFLOW.steps.write?.maxRuns, 3);
    assert.equal(CURRENT_REVIEWED_CHAT_WORKFLOW.steps.review?.maxRuns, 3);
    assert.deepEqual(
        CURRENT_REVIEWED_CHAT_WORKFLOW.steps.review?.transitions.revise,
        {
            kind: 'step',
            stepId: 'replan',
        }
    );
    assert.deepEqual(
        CURRENT_REVIEWED_CHAT_WORKFLOW.steps.replan?.transitions.continue,
        {
            kind: 'step',
            stepId: 'write',
        }
    );
    assert.deepEqual(
        CURRENT_REVIEWED_CHAT_WORKFLOW.steps.replan?.output?.requiredOn,
        ['continue']
    );
    assert.deepEqual(
        CURRENT_REVIEWED_CHAT_WORKFLOW.steps.replan?.transitions.skipped,
        {
            kind: 'step',
            stepId: 'write',
        }
    );
    assert.deepEqual(
        CURRENT_REVIEWED_CHAT_WORKFLOW.steps.replan?.transitions.failed,
        {
            kind: 'step',
            stepId: 'finish',
        }
    );
    assert.deepEqual(
        CURRENT_REVIEWED_CHAT_WORKFLOW.steps.defaultPlan?.transitions.failed,
        {
            kind: 'step',
            stepId: 'finish',
        }
    );
    assert.deepEqual(
        CURRENT_REVIEWED_CHAT_WORKFLOW.steps.write?.input.map((reference) =>
            reference.kind === 'result' ? reference.name : reference.kind
        ),
        [
            'context',
            'plan',
            'evidence',
            'presentation',
            'draft',
            'review',
            'revisionPlan',
        ]
    );
    assert.deepEqual(
        CURRENT_REVIEWED_CHAT_WORKFLOW.steps.replan?.input.map((reference) =>
            reference.kind === 'result' ? reference.name : reference.kind
        ),
        ['context', 'plan', 'draft', 'review']
    );
    assert.deepEqual(
        CURRENT_REVIEWED_CHAT_WORKFLOW.steps.finish?.input.map((reference) =>
            reference.kind === 'result' ? reference.name : reference.kind
        ),
        ['draft', 'plan', 'evidence', 'review']
    );
    for (const currentStep of ['write', 'review'] as const) {
        assert.deepEqual(
            CURRENT_REVIEWED_CHAT_WORKFLOW.steps[currentStep]?.transitions
                .failed,
            { kind: 'step', stepId: 'finish' }
        );
    }
    assert.deepEqual(
        CURRENT_REVIEWED_CHAT_WORKFLOW.steps.finish?.transitions.done,
        { kind: 'end' }
    );
});

test('executes reviewed-chat presentation and replan skip/failure paths without synthetic Results', async () => {
    const executeProof = async (replan: 'skipped' | 'failed') => {
        let reviewRuns = 0;
        const writeInputs: string[][] = [];
        let finishInputs: string[] = [];
        const execution = await executeWorkflow({
            workflow: CURRENT_REVIEWED_CHAT_WORKFLOW,
            context: { requestId: 'req-1' },
            executors: {
                model: async ({ step: executingStep, results }) => {
                    switch (executingStep.id) {
                        case 'plan':
                            return {
                                status: 'succeeded',
                                outcome: 'continue',
                                result: result('plan', { mode: 'reviewed' }),
                            };
                        case 'presentation':
                            return { status: 'succeeded', outcome: 'skipped' };
                        case 'write':
                            writeInputs.push(Object.keys(results));
                            return {
                                status: 'succeeded',
                                outcome: 'generated',
                                result: result('draft', {
                                    version: writeInputs.length,
                                }),
                            };
                        case 'review':
                            reviewRuns += 1;
                            return reviewRuns === 1
                                ? {
                                      status: 'succeeded',
                                      outcome: 'revise',
                                      result: result('review', {
                                          action: 'revise',
                                      }),
                                  }
                                : {
                                      status: 'succeeded',
                                      outcome: 'done',
                                      result: result('review', {
                                          action: 'done',
                                      }),
                                  };
                        case 'replan':
                            return replan === 'skipped'
                                ? { status: 'succeeded', outcome: 'skipped' }
                                : {
                                      status: 'failed',
                                      errorCode: 'planner_unavailable',
                                      retryable: false,
                                  };
                        default:
                            throw new Error(
                                `Unexpected model Step: ${executingStep.id}`
                            );
                    }
                },
                context: async () => ({
                    status: 'succeeded',
                    outcome: 'available',
                    result: result('evidence', { sources: 1 }),
                }),
                code: async ({ step: executingStep, results }) => {
                    if (executingStep.id === 'finish') {
                        finishInputs = Object.keys(results);
                        return {
                            status: 'succeeded',
                            outcome: 'done',
                            result: result('answer', 'final'),
                        };
                    }
                    throw new Error(
                        `Unexpected code Step: ${executingStep.id}`
                    );
                },
            },
            executionLimits: {
                ...limits,
                maxPlanCycles: 3,
                maxReviewCycles: 3,
            },
            startedAtMs: 0,
            now: () => 1,
        });
        return { execution, finishInputs, writeInputs };
    };

    const skipped = await executeProof('skipped');
    assert.equal(skipped.execution.status, 'completed');
    assert.equal(skipped.writeInputs.length, 2);
    assert.equal(skipped.writeInputs[0]?.includes('presentation'), false);
    assert.equal(skipped.writeInputs[1]?.includes('revisionPlan'), false);
    assert.equal(skipped.writeInputs[1]?.includes('review'), true);

    const failed = await executeProof('failed');
    assert.equal(failed.execution.status, 'degraded');
    assert.deepEqual(
        failed.execution.run.steps.map((record) => record.stepId),
        [
            'plan',
            'retrieve',
            'presentation',
            'write',
            'review',
            'replan',
            'finish',
        ]
    );
    assert.deepEqual(failed.execution.run.results.draft?.value, { version: 1 });
    assert.equal(failed.finishInputs.includes('draft'), true);
});
