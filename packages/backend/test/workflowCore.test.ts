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
    activity?: Step['activity'];
    maxRuns?: number;
    maxAttempts?: number;
    executor?: Step['executor'];
}): Step => ({
    id: input.id,
    executor: input.executor ?? 'code',
    ...(input.activity === undefined ? {} : { activity: input.activity }),
    input: input.input ?? [],
    ...(input.output === undefined ? {} : { output: { name: input.output } }),
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
    assert.equal(execution.status, 'limited');
    assert.deepEqual(execution.termination, {
        reason: 'execution_limit',
        limit: 'maxToolCalls',
    });
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
    assert.deepEqual(execution.termination, {
        reason: 'execution_limit',
        limit: 'maxTokensTotal',
    });
});

test('rejects a projected tool reservation before a tool Attempt executes', async () => {
    let executorCalls = 0;
    const execution = await executeWorkflow({
        workflow: workflow({
            context: step({
                id: 'context',
                activity: { tool: 'one-or-more' },
                transitions: { done: { kind: 'end' } },
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
    assert.deepEqual(execution.termination, {
        reason: 'execution_limit',
        limit: 'maxToolCalls',
    });
});

test('applies canonical caps, reservation, duration, and presentation accounting through shared admission', async () => {
    const plan = await runWith({
        definition: workflow({
            plan: step({
                id: 'plan',
                activity: { deliberation: 'plan' },
                maxAttempts: 2,
                transitions: { failed: { kind: 'end' } },
            }),
        }),
        behavior: {
            plan: [{ status: 'failed', errorCode: 'retry', retryable: true }],
        },
        executionLimits: { ...limits, maxPlanCycles: 1 },
    });
    assert.deepEqual(plan.termination, {
        reason: 'execution_limit',
        limit: 'maxDeliberationCalls',
    });

    const review = await runWith({
        definition: workflow({
            review: step({
                id: 'review',
                activity: { deliberation: 'review' },
                maxAttempts: 2,
                transitions: { failed: { kind: 'end' } },
            }),
        }),
        behavior: {
            review: [{ status: 'failed', errorCode: 'retry', retryable: true }],
        },
        executionLimits: { ...limits, maxReviewCycles: 1 },
    });
    assert.deepEqual(review.termination, {
        reason: 'execution_limit',
        limit: 'maxDeliberationCalls',
    });

    const reservation = await runWith({
        definition: workflow({
            write: step({
                id: 'write',
                transitions: { done: { kind: 'end' } },
            }),
        }),
        behavior: { write: [{ status: 'succeeded', outcome: 'done' }] },
        executionLimits: { ...limits, maxTokensTotal: 10 },
        reserveAttempt: () => ({ tokens: 11 }),
    });
    assert.equal(reservation.run.steps.length, 0);
    assert.equal(reservation.termination.reason, 'execution_limit');

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
        'context',
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
