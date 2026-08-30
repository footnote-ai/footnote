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

import { CURRENT_CHAT_WORKFLOW_FIXTURE } from './fixtures/currentChatWorkflow.fixture.js';
import {
    executeWorkflow as executeWorkflowCore,
    type AttemptResult,
    type ExecutionLimits,
    type ExecuteInput,
    type StepHandlers,
    type ResultRef,
    type Step,
    type Workflow,
} from '../src/services/workflowCore/index.js';

type TestContext = { requestId: string };

const executeWorkflow = (input: ExecuteInput<TestContext>) =>
    executeWorkflowCore({
        ...input,
        handlers: new Proxy(input.handlers, {
            get: (handlers, key) =>
                typeof key === 'string'
                    ? (handlers[key] ?? handlers.code)
                    : undefined,
        }),
    });

const limits: ExecutionLimits = {
    maxWorkflowSteps: 20,
    maxToolCalls: 2,
    maxDeliberationCalls: 10,
    maxTokensTotal: 1_000,
    maxDurationMs: 10_000,
};

const step = (input: {
    next: Readonly<Record<string, string | null>>;
    input?: readonly ResultRef[];
    output?: string;
    outputOn?: readonly string[];
    activity?: Step['activity'];
    maxIterations?: number;
    maxAttempts?: number;
}): Step => ({
    ...(input.activity === undefined ? {} : { activity: input.activity }),
    ...(input.input === undefined ? {} : { input: input.input }),
    ...(input.output === undefined
        ? {}
        : {
              output: {
                  name: input.output,
                  ...(input.outputOn === undefined
                      ? {}
                      : { on: input.outputOn }),
              },
          }),
    next: input.next,
    ...(input.maxIterations === undefined
        ? {}
        : { maxIterations: input.maxIterations }),
    ...(input.maxAttempts === undefined
        ? {}
        : { maxAttempts: input.maxAttempts }),
});

const workflow = (
    steps: Readonly<Record<string, Step>>,
    start = Object.keys(steps)[0] ?? 'missing'
): Workflow => ({
    id: `test-${start}`,
    start,
    steps,
});

const runWith = async (input: {
    definition: Workflow;
    behavior: Readonly<Record<string, readonly AttemptResult[]>>;
    executionLimits?: ExecutionLimits;
    handlers?: StepHandlers<TestContext>;
    now?: () => number;
    reserveAttempt?: () => { tokens?: number; toolCalls?: number };
}) => {
    const remaining = new Map(
        Object.entries(input.behavior).map(([stepId, outcomes]) => [
            stepId,
            [...outcomes],
        ])
    );
    const defaultHandler =
        input.handlers?.code ??
        (input.handlers === undefined
            ? async ({ stepId }: { stepId: string }) =>
                  remaining.get(stepId)?.shift() ?? {
                      status: 'succeeded' as const,
                      outcome: 'done',
                  }
            : undefined);
    const handlers: StepHandlers<TestContext> = {
        ...(defaultHandler === undefined
            ? {}
            : Object.fromEntries(
                  Object.keys(input.definition.steps).map((stepId) => [
                      stepId,
                      defaultHandler,
                  ])
              )),
        ...input.handlers,
    };
    return executeWorkflow({
        workflow: input.definition,
        context: { requestId: 'req-1' },
        handlers,
        executionLimits: input.executionLimits ?? limits,
        startedAtMs: 0,
        now: input.now ?? (() => 1),
        reserveAttempt: input.reserveAttempt,
    });
};

test('runs declared dataflow and gives handlers Step names, Results, and one-based ordinals', async () => {
    const definition = workflow({
        plan: step({
            output: 'plan',
            next: { done: 'write' },
        }),
        write: step({
            input: [{ name: 'plan' }],
            output: 'draft',
            next: { done: null },
        }),
    });
    const seen: Array<{
        stepId: string;
        resultNames: string[];
        iteration: number;
        attempt: number;
        hasStep: boolean;
    }> = [];

    const execution = await runWith({
        definition,
        behavior: {},
        handlers: {
            code: async (handlerInput): Promise<AttemptResult> => {
                const { stepId, results, iteration, attempt } = handlerInput;
                seen.push({
                    stepId,
                    resultNames: Object.keys(results),
                    iteration,
                    attempt,
                    hasStep: Object.hasOwn(handlerInput, 'step'),
                });
                return stepId === 'plan'
                    ? {
                          status: 'succeeded',
                          outcome: 'done',
                          result: { route: 'write' },
                      }
                    : {
                          status: 'succeeded',
                          outcome: 'done',
                          result: { text: 'answer' },
                      };
            },
        },
    });

    assert.equal(execution.status, 'completed');
    assert.deepEqual(seen, [
        {
            stepId: 'plan',
            resultNames: [],
            iteration: 1,
            attempt: 1,
            hasStep: false,
        },
        {
            stepId: 'write',
            resultNames: ['plan'],
            iteration: 1,
            attempt: 1,
            hasStep: false,
        },
    ]);
    assert.deepEqual(execution.run.results.plan, { route: 'write' });
});

test('supports a bounded generic style -> check -> retry cycle without special engine branches', async () => {
    const definition = workflow(
        {
            style: step({
                maxIterations: 2,
                next: { done: 'check' },
            }),
            check: step({
                next: { retry: 'style' },
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
        reason: 'step_iteration_limit',
        stepId: 'style',
    });
});

test('rejects undeclared handler outcomes', async () => {
    const execution = await runWith({
        definition: workflow({
            plan: step({
                next: { done: null },
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
                output: 'plan',
                next: { done: 'style' },
            }),
            style: step({
                maxAttempts: 2,
                input: [{ name: 'plan' }],
                next: { failed: 'write' },
            }),
            write: step({
                input: [{ name: 'plan' }, { name: 'style', optional: true }],
                next: { done: null },
            }),
        }),
        behavior: {
            plan: [
                {
                    status: 'succeeded',
                    outcome: 'done',
                    result: { route: 'write' },
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
    assert.deepEqual(execution.run.results.plan, { route: 'write' });
    assert.equal(execution.run.results.style, undefined);
    assert.equal(execution.run.steps[1]?.attempts.length, 2);
});

test('marks explicit default-plan recovery as degraded', async () => {
    const execution = await runWith({
        definition: workflow({
            plan: step({
                next: {
                    failed: 'defaultPlan',
                },
            }),
            defaultPlan: step({
                output: 'plan',
                next: { done: 'finish' },
            }),
            finish: step({
                input: [{ name: 'plan' }],
                next: { done: null },
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
                    result: { fallback: true },
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
                maxAttempts: 2,
                next: { done: null },
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
                    activity,
                    maxAttempts: 2,
                    next: { done: null },
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
            output: 'presentation',
            outputOn: ['admitted'],
            next: {
                admitted: null,
                skipped: null,
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
    const skippedWithResult = await runWith({
        definition,
        behavior: {
            presentation: [
                {
                    status: 'succeeded',
                    outcome: 'skipped',
                    result: 'unexpected presentation',
                },
            ],
        },
    });

    assert.equal(skipped.status, 'completed');
    assert.equal(skipped.run.results.presentation, undefined);
    assert.deepEqual(admittedWithoutResult.termination, {
        reason: 'invalid_result',
        stepId: 'presentation',
    });
    assert.deepEqual(skippedWithResult.termination, {
        reason: 'invalid_result',
        stepId: 'presentation',
    });
});

test('rejects invalid definitions before any handler runs', async () => {
    const invalidDefinitions: readonly Workflow[] = [
        workflow({}, 'missing'),
        workflow({
            first: step({
                next: { done: 'missing' },
            }),
        }),
    ];

    for (const definition of invalidDefinitions) {
        let calls = 0;
        const execution = await runWith({
            definition,
            behavior: {},
            handlers: {
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
        expected: 'invalid' | 'completed';
    }> = [
        {
            name: 'required Result',
            definition: workflow({
                write: step({
                    output: 'draft',
                    next: { done: null },
                }),
            }),
            response: {
                status: 'succeeded',
                outcome: 'done',
                result: 'ok',
            },
            expected: 'completed',
        },
        {
            name: 'missing Result',
            definition: workflow({
                write: step({
                    output: 'draft',
                    next: { done: null },
                }),
            }),
            response: { status: 'succeeded', outcome: 'done' },
            expected: 'invalid',
        },
        {
            name: 'mismatched Result',
            definition: workflow({
                write: step({
                    output: 'draft',
                    next: { done: null },
                }),
            }),
            response: {
                status: 'succeeded',
                outcome: 'done',
                result: 'bad',
            },
            expected: 'completed',
        },
        {
            name: 'undeclared Result',
            definition: workflow({
                write: step({
                    next: { done: null },
                }),
            }),
            response: {
                status: 'succeeded',
                outcome: 'done',
                result: 'bad',
            },
            expected: 'invalid',
        },
        {
            name: 'outputless Step',
            definition: workflow({
                write: step({
                    next: { done: null },
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
            { reason: 'invalid_result', stepId: 'write' },
            item.name
        );
    }
});

test('keeps unavailable handlers separate from declared failure recovery', async () => {
    const execution = await executeWorkflow({
        workflow: workflow({
            retrieve: step({
                next: { failed: null },
            }),
        }),
        context: { requestId: 'req-1' },
        handlers: {},
        executionLimits: limits,
        startedAtMs: 0,
        now: () => 1,
    });

    assert.deepEqual(execution.termination, {
        reason: 'handler_unavailable',
        stepId: 'retrieve',
    });
    assert.equal(execution.run.steps.length, 0);
});

test('uses shared admission before every retry and supplies distinct Attempt ordinals', async () => {
    const attempts: number[] = [];
    const execution = await executeWorkflow({
        workflow: workflow({
            retrieve: step({
                activity: { tool: 'one-or-more' },
                maxAttempts: 3,
                next: { failed: null },
            }),
        }),
        context: { requestId: 'req-1' },
        handlers: {
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
    let handlerCalls = 0;
    const execution = await executeWorkflow({
        workflow: workflow({
            write: step({
                maxAttempts: 2,
                next: { failed: null },
            }),
        }),
        context: { requestId: 'req-1' },
        handlers: {
            code: async () => {
                handlerCalls += 1;
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
    assert.equal(handlerCalls, 1);
    assert.equal(execution.status, 'degraded');
    assert.deepEqual(execution.termination, { reason: 'finished' });
});

test('rejects a projected tool reservation before a tool Attempt executes', async () => {
    let handlerCalls = 0;
    const execution = await executeWorkflow({
        workflow: workflow({
            context: step({
                activity: { tool: 'one-or-more' },
                next: { failed: null, done: null },
            }),
        }),
        context: { requestId: 'req-1' },
        handlers: {
            code: async () => {
                handlerCalls += 1;
                return { status: 'succeeded', outcome: 'done' };
            },
        },
        executionLimits: { ...limits, maxToolCalls: 2 },
        startedAtMs: 0,
        now: () => 1,
        reserveAttempt: () => ({ toolCalls: 3 }),
    });

    assert.equal(handlerCalls, 0);
    assert.equal(execution.status, 'degraded');
    assert.deepEqual(execution.termination, { reason: 'finished' });
});

test('routes a recoverably admission-blocked optional Step through its declared failure transition', async () => {
    const execution = await executeWorkflow({
        workflow: workflow({
            presentation: step({
                output: 'presentation',
                outputOn: ['admitted'],
                next: {
                    admitted: 'write',
                    failed: 'write',
                },
            }),
            write: step({
                next: {
                    failed: null,
                    done: null,
                },
            }),
        }),
        context: { requestId: 'req-1' },
        handlers: {
            code: async ({ stepId }) => ({
                status: 'succeeded',
                outcome: stepId === 'write' ? 'done' : 'admitted',
            }),
        },
        executionLimits: { ...limits, maxTokensTotal: 5 },
        startedAtMs: 0,
        now: () => 1,
        reserveAttempt: ({ stepId }) =>
            stepId === 'presentation' ? { tokens: 6 } : undefined,
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
                maxAttempts: 2,
                next: { failed: 'write' },
            }),
            write: step({
                next: {
                    failed: null,
                    done: null,
                },
            }),
        }),
        context: { requestId: 'req-1' },
        handlers: {
            code: async ({ stepId }) =>
                stepId === 'presentation'
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
        reserveAttempt: ({ stepId }) =>
            stepId === 'presentation' ? { tokens: 3 } : undefined,
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
                output: 'draft',
                next: { generated: 'review' },
            }),
            review: step({
                activity: { deliberation: 'review' },
                input: [{ name: 'draft' }],
                next: { failed: 'finish' },
            }),
            finish: step({
                output: 'answer',
                input: [{ name: 'draft' }],
                next: { done: null },
            }),
        }),
        context: { requestId: 'req-1' },
        handlers: {
            code: async ({ stepId }) => {
                if (stepId === 'write') {
                    return {
                        status: 'succeeded',
                        outcome: 'generated',
                        result: 'last good draft',
                        usage: { totalTokens: 3 },
                    };
                }
                if (stepId === 'review') {
                    reviewCalls += 1;
                    return { status: 'succeeded', outcome: 'done' };
                }
                finishCalls += 1;
                return {
                    status: 'succeeded',
                    outcome: 'done',
                    result: 'finalized draft',
                };
            },
        },
        executionLimits: { ...limits, maxTokensTotal: 3 },
        startedAtMs: 0,
        now: () => 1,
        reserveAttempt: ({ stepId }) => {
            if (stepId === 'review') return { tokens: 1 };
            if (stepId === 'finish') return { tokens: 0 };
            return undefined;
        },
    });

    assert.equal(reviewCalls, 0);
    assert.equal(finishCalls, 1);
    assert.equal(execution.status, 'degraded');
    assert.equal(execution.run.results.draft, 'last good draft');
    assert.equal(execution.run.results.answer, 'finalized draft');
});

test('stops on observed resource overruns while retaining valid prior Results', async () => {
    const tokenOverrun = await executeWorkflow({
        workflow: workflow({
            write: step({
                output: 'draft',
                next: { done: null },
            }),
        }),
        context: { requestId: 'req-1' },
        handlers: {
            code: async () => ({
                status: 'succeeded',
                outcome: 'done',
                result: 'kept',
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
                activity: { tool: 'one-or-more' },
                next: { done: null },
            }),
        }),
        context: { requestId: 'req-1' },
        handlers: {
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
                output: 'draft',
                next: { generated: 'review' },
            }),
            review: step({
                activity: { deliberation: 'review' },
                input: [{ name: 'draft' }],
                output: 'review',
                next: { revise: null },
            }),
        }),
        context: { requestId: 'req-1' },
        handlers: {
            code: async ({ stepId }) =>
                stepId === 'write'
                    ? {
                          status: 'succeeded',
                          outcome: 'generated',
                          result: 'prior draft',
                      }
                    : {
                          status: 'succeeded',
                          outcome: 'revise',
                          result: 'retry',
                          usage: { totalTokens: 4 },
                      },
        },
        executionLimits: { ...limits, maxTokensTotal: 3 },
        startedAtMs: 0,
        now: () => 1,
        reserveAttempt: ({ stepId }) =>
            stepId === 'review' ? { tokens: 1 } : undefined,
    });

    let time = 0;
    const durationOverrun = await executeWorkflow({
        workflow: workflow({
            write: step({
                next: { done: null },
            }),
        }),
        context: { requestId: 'req-1' },
        handlers: {
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
    assert.equal(tokenOverrun.run.results.draft, 'kept');
    assert.deepEqual(toolOverrun.termination, {
        reason: 'execution_limit',
        limit: 'maxToolCalls',
    });
    assert.deepEqual(reviewOverrun.termination, {
        reason: 'execution_limit',
        limit: 'maxTokensTotal',
    });
    assert.equal(reviewOverrun.run.results.draft, 'prior draft');
    assert.deepEqual(durationOverrun.termination, {
        reason: 'execution_limit',
        limit: 'maxDurationMs',
    });
});

test('applies canonical caps, reservation, duration, and presentation accounting through shared admission', async () => {
    const reservation = await runWith({
        definition: workflow({
            write: step({
                next: {
                    failed: null,
                    done: null,
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
                next: { done: null },
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
                next: { done: null },
            }),
        }),
        behavior: {
            presentation: [
                {
                    status: 'succeeded',
                    outcome: 'done',
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
                next: { done: null },
            }),
        }),
        behavior: {},
        executionLimits: { ...limits, maxTokensTotal: Number.NaN },
        handlers: {
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

test('describes the current chat cutover fixture', () => {
    assert.equal(CURRENT_CHAT_WORKFLOW_FIXTURE.start, 'plan');
    assert.deepEqual(Object.keys(CURRENT_CHAT_WORKFLOW_FIXTURE.steps), [
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
        CURRENT_CHAT_WORKFLOW_FIXTURE.steps.plan?.next.failed,
        'defaultPlan'
    );
    assert.equal(
        CURRENT_CHAT_WORKFLOW_FIXTURE.steps.defaultPlan?.output?.name,
        'plan'
    );
    assert.equal(
        'activity' in CURRENT_CHAT_WORKFLOW_FIXTURE.steps.presentation
            ? CURRENT_CHAT_WORKFLOW_FIXTURE.steps.presentation.activity
            : undefined,
        undefined
    );
    assert.deepEqual(
        CURRENT_CHAT_WORKFLOW_FIXTURE.steps.presentation?.output?.on,
        ['admitted']
    );
    assert.equal(
        CURRENT_CHAT_WORKFLOW_FIXTURE.steps.presentation?.maxIterations,
        1
    );
    assert.equal(
        'maxAttempts' in CURRENT_CHAT_WORKFLOW_FIXTURE.steps.presentation
            ? CURRENT_CHAT_WORKFLOW_FIXTURE.steps.presentation.maxAttempts
            : undefined,
        undefined
    );
    assert.equal(CURRENT_CHAT_WORKFLOW_FIXTURE.steps.write?.maxIterations, 3);
    assert.equal(CURRENT_CHAT_WORKFLOW_FIXTURE.steps.review?.maxIterations, 3);
    assert.deepEqual(
        CURRENT_CHAT_WORKFLOW_FIXTURE.steps.review?.next.revise,
        'replan'
    );
    assert.deepEqual(
        CURRENT_CHAT_WORKFLOW_FIXTURE.steps.replan?.next.continue,
        'write'
    );
    assert.deepEqual(CURRENT_CHAT_WORKFLOW_FIXTURE.steps.replan?.output?.on, [
        'continue',
    ]);
    assert.deepEqual(
        CURRENT_CHAT_WORKFLOW_FIXTURE.steps.replan?.next.skipped,
        'write'
    );
    assert.deepEqual(
        CURRENT_CHAT_WORKFLOW_FIXTURE.steps.replan?.next.failed,
        'finish'
    );
    assert.deepEqual(
        CURRENT_CHAT_WORKFLOW_FIXTURE.steps.defaultPlan?.next.failed,
        'finish'
    );
    assert.deepEqual(
        CURRENT_CHAT_WORKFLOW_FIXTURE.steps.write?.input?.map(
            (reference) => reference.name
        ),
        ['plan', 'evidence', 'presentation', 'draft', 'review', 'revisionPlan']
    );
    assert.deepEqual(
        CURRENT_CHAT_WORKFLOW_FIXTURE.steps.replan?.input?.map(
            (reference) => reference.name
        ),
        ['plan', 'draft', 'review']
    );
    assert.deepEqual(
        CURRENT_CHAT_WORKFLOW_FIXTURE.steps.finish?.input?.map(
            (reference) => reference.name
        ),
        ['draft', 'plan']
    );
    for (const currentStep of ['write', 'review'] as const) {
        assert.deepEqual(
            CURRENT_CHAT_WORKFLOW_FIXTURE.steps[currentStep]?.next.failed,
            'finish'
        );
    }
    assert.deepEqual(
        CURRENT_CHAT_WORKFLOW_FIXTURE.steps.finish?.next.done,
        null
    );
});

test('executes reviewed-chat presentation and replan skip/failure paths without synthetic Results', async () => {
    const executeProof = async (replan: 'skipped' | 'failed') => {
        let reviewRuns = 0;
        const writeInputs: string[][] = [];
        let finishInputs: string[] = [];
        const execution = await executeWorkflow({
            workflow: CURRENT_CHAT_WORKFLOW_FIXTURE,
            context: { requestId: 'req-1' },
            handlers: {
                plan: async () => ({
                    status: 'succeeded',
                    outcome: 'continue',
                    result: { mode: 'reviewed' },
                }),
                retrieve: async () => ({
                    status: 'succeeded',
                    outcome: 'available',
                    result: { sources: 1 },
                }),
                presentation: async () => ({
                    status: 'succeeded',
                    outcome: 'skipped',
                }),
                write: async ({ results }) => {
                    writeInputs.push(Object.keys(results));
                    return {
                        status: 'succeeded',
                        outcome: 'generated',
                        result: {
                            version: writeInputs.length,
                        },
                    };
                },
                review: async () => {
                    reviewRuns += 1;
                    return reviewRuns === 1
                        ? {
                              status: 'succeeded',
                              outcome: 'revise',
                              result: { action: 'revise' },
                          }
                        : {
                              status: 'succeeded',
                              outcome: 'done',
                              result: { action: 'done' },
                          };
                },
                replan: async () =>
                    replan === 'skipped'
                        ? { status: 'succeeded', outcome: 'skipped' }
                        : {
                              status: 'failed',
                              errorCode: 'planner_unavailable',
                              retryable: false,
                          },
                finish: async ({ results }) => {
                    finishInputs = Object.keys(results);
                    return {
                        status: 'succeeded',
                        outcome: 'done',
                        result: 'final',
                    };
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
    assert.deepEqual(failed.execution.run.results.draft, { version: 1 });
    assert.equal(failed.finishInputs.includes('draft'), true);
});

test('clears an omitted optional Result before a repeated downstream Step', async () => {
    const seenRevisionPlans: boolean[] = [];
    const execution = await executeWorkflow({
        workflow: workflow({
            replan: step({
                output: 'revisionPlan',
                outputOn: ['continue'],
                next: {
                    continue: 'write',
                    skipped: 'write',
                },
                maxIterations: 2,
            }),
            write: step({
                input: [
                    {
                        name: 'revisionPlan',
                        optional: true,
                    },
                ],
                next: {
                    again: 'replan',
                    done: null,
                },
                maxIterations: 2,
            }),
        }),
        context: { requestId: 'req-1' },
        handlers: {
            code: async ({ stepId, results, iteration }) => {
                if (stepId === 'replan') {
                    return iteration === 1
                        ? {
                              status: 'succeeded',
                              outcome: 'continue',
                              result: { version: 1 },
                          }
                        : { status: 'succeeded', outcome: 'skipped' };
                }
                seenRevisionPlans.push(results.revisionPlan !== undefined);
                return {
                    status: 'succeeded',
                    outcome: iteration === 1 ? 'again' : 'done',
                };
            },
        },
        executionLimits: limits,
        startedAtMs: 0,
        now: () => 1,
    });

    assert.equal(execution.status, 'completed');
    assert.deepEqual(seenRevisionPlans, [true, false]);
    assert.equal(execution.run.results.revisionPlan, undefined);
});

test('preserves a failed repeated Step output before finalization', async () => {
    let finishInputs: string[] = [];
    const execution = await executeWorkflow({
        workflow: workflow({
            write: step({
                output: 'draft',
                next: { generated: 'review' },
                maxIterations: 2,
            }),
            review: step({
                input: [{ name: 'draft' }],
                output: 'review',
                next: { revise: 'write', failed: 'finish' },
                maxIterations: 2,
            }),
            finish: step({
                input: [
                    { name: 'draft', optional: true },
                    { name: 'review', optional: true },
                ],
                output: 'answer',
                next: { done: null },
            }),
        }),
        context: { requestId: 'req-1' },
        handlers: {
            write: async ({ iteration }) => ({
                status: 'succeeded',
                outcome: 'generated',
                result: { iteration },
            }),
            review: async ({ iteration }) =>
                iteration === 1
                    ? {
                          status: 'succeeded',
                          outcome: 'revise',
                          result: { draft: 1 },
                      }
                    : {
                          status: 'failed',
                          errorCode: 'review_unavailable',
                          retryable: false,
                      },
            finish: async ({ results }) => {
                finishInputs = Object.keys(results);
                return {
                    status: 'succeeded',
                    outcome: 'done',
                    result: 'final',
                };
            },
        },
        executionLimits: limits,
        startedAtMs: 0,
        now: () => 1,
    });

    assert.equal(execution.status, 'degraded');
    assert.equal(finishInputs.includes('draft'), true);
    assert.equal(finishInputs.includes('review'), true);
    assert.notEqual(execution.run.results.review, undefined);
});

test('preserves the last valid Draft when a repeated write Step fails', async () => {
    let finishDraft: unknown;
    const execution = await executeWorkflow({
        workflow: workflow({
            write: step({
                output: 'draft',
                next: { generated: 'review', failed: 'finish' },
                maxIterations: 2,
            }),
            review: step({
                input: [{ name: 'draft' }],
                next: { revise: 'write' },
            }),
            finish: step({
                input: [{ name: 'draft' }],
                output: 'answer',
                next: { done: null },
            }),
        }),
        context: { requestId: 'req-1' },
        handlers: {
            write: async ({ iteration }) =>
                iteration === 1
                    ? {
                          status: 'succeeded',
                          outcome: 'generated',
                          result: { version: 'A' },
                      }
                    : {
                          status: 'failed',
                          errorCode: 'write_unavailable',
                          retryable: false,
                      },
            review: async () => ({ status: 'succeeded', outcome: 'revise' }),
            finish: async ({ results }) => {
                finishDraft = results.draft;
                return {
                    status: 'succeeded',
                    outcome: 'done',
                    result: 'final',
                };
            },
        },
        executionLimits: limits,
        startedAtMs: 0,
        now: () => 1,
    });

    assert.equal(execution.status, 'degraded');
    assert.deepEqual(finishDraft, { version: 'A' });
    assert.deepEqual(execution.run.results.draft, { version: 'A' });
});
