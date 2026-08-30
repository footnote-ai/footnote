/**
 * @description: Verifies the non-live workflow foundation's typed inputs,
 * explicit transitions, bounded cycles, attempts, and execution limits.
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
    type ExecutorRegistry,
    type ExecutionAttemptResult,
    type ExecutionLimits,
    type Workflow,
    type Step,
    type TypedStepExecutor,
} from '../src/services/workflowCore/index.js';

type TestContext = {
    requestId: string;
};

type Plan = {
    route: 'write';
};

type Draft = {
    text: string;
};

const limits: ExecutionLimits = {
    maxWorkflowSteps: 20,
    maxToolCalls: 2,
    maxDeliberationCalls: 10,
    maxTokensTotal: 1000,
    maxDurationMs: 10_000,
};

const step = (
    id: string,
    transitions: Readonly<
        Record<string, { kind: 'step'; stepId: string } | { kind: 'finish' }>
    >,
    inputReferences: Step['input']['references'] = [],
    options: Pick<Step, 'maxRuns' | 'maxAttempts'> & {
        outputName?: string;
    } = {}
): Step => {
    const { outputName = id, ...stepOptions } = options;
    return {
        id,
        executor: 'code',
        input: {
            references: inputReferences,
        },
        output: {
            name: outputName,
        },
        transitions,
        ...stepOptions,
    };
};

const workflow = (
    steps: Readonly<Record<string, Step>>,
    start: string
): Workflow<TestContext> => ({
    id: `test-${start}`,
    version: 'v1',
    start,
    steps,
    limits: {
        source: 'execution-contract',
    },
});

const runWith = (
    definition: Workflow<TestContext>,
    behavior: Readonly<Record<string, ReadonlyArray<ExecutionAttemptResult>>>,
    executionLimits: ExecutionLimits = limits
) => {
    const remaining = new Map(
        Object.entries(behavior).map(([stepId, outcomes]) => [
            stepId,
            [...outcomes],
        ])
    );
    const executors: ExecutorRegistry<TestContext> = {
        code: async ({ stepId }) => {
            const outcomes = remaining.get(stepId) ?? [];
            const outcome = outcomes.shift();
            if (outcome === undefined) {
                return {
                    status: 'succeeded',
                    outcome: 'done',
                };
            }
            return outcome;
        },
    };

    return executeWorkflow({
        workflow: definition,
        context: { requestId: 'req-1' },
        executors,
        executionLimits,
        startedAtMs: 0,
        now: () => 1,
    });
};

test('runs a simple plan -> write -> finish flow', async () => {
    const definition = workflow(
        {
            plan: step('plan', {
                done: { kind: 'step', stepId: 'write' },
            }),
            write: step(
                'write',
                {
                    done: { kind: 'finish' },
                },
                [{ kind: 'result', name: 'plan' }],
                { outputName: 'draft' }
            ),
        },
        'plan'
    );

    const execution = await runWith(definition, {
        plan: [
            {
                status: 'succeeded',
                outcome: 'done',
                result: result('plan', { route: 'write' } satisfies Plan),
            },
        ],
        write: [
            {
                status: 'succeeded',
                outcome: 'done',
                result: result('draft', { text: 'answer' } satisfies Draft),
            },
        ],
    });

    assert.equal(execution.status, 'completed');
    assert.deepEqual(
        execution.run.steps.map((record) => record.stepId),
        ['plan', 'write']
    );
    assert.deepEqual(execution.run.results.get('plan')?.value, {
        route: 'write',
    });
});

test('uses only declared branch outcomes and supports revise -> write', async () => {
    const definition = workflow(
        {
            review: step('review', {
                done: { kind: 'finish' },
                revise: { kind: 'step', stepId: 'write' },
                failed: { kind: 'finish' },
            }),
            write: step('write', {
                done: { kind: 'step', stepId: 'review' },
            }),
        },
        'review'
    );

    const execution = await runWith(definition, {
        review: [
            { status: 'succeeded', outcome: 'revise' },
            { status: 'succeeded', outcome: 'done' },
        ],
        write: [{ status: 'succeeded', outcome: 'done' }],
    });

    assert.equal(execution.status, 'completed');
    assert.deepEqual(
        execution.run.steps.map((record) => record.stepId),
        ['review', 'write', 'review']
    );
});

test('represents a bounded style -> check -> retry style cycle without engine branches', async () => {
    const definition = workflow(
        {
            style: step(
                'style',
                {
                    done: { kind: 'step', stepId: 'check' },
                },
                [],
                { maxRuns: 2 }
            ),
            check: step('check', {
                retry: { kind: 'step', stepId: 'style' },
                write: { kind: 'step', stepId: 'write' },
            }),
            write: step('write', {
                done: { kind: 'finish' },
            }),
        },
        'style'
    );

    const execution = await runWith(definition, {
        style: [
            { status: 'succeeded', outcome: 'done' },
            { status: 'succeeded', outcome: 'done' },
        ],
        check: [
            { status: 'succeeded', outcome: 'retry' },
            { status: 'succeeded', outcome: 'retry' },
        ],
    });

    assert.equal(execution.status, 'limited');
    assert.equal(execution.termination.reason, 'step_run_limit');
    assert.deepEqual(
        execution.run.steps.map((record) => record.stepId),
        ['style', 'check', 'style', 'check']
    );
});

test('rejects an undeclared executor outcome instead of routing to an arbitrary step', async () => {
    const definition = workflow(
        {
            plan: step('plan', {
                done: { kind: 'finish' },
            }),
            secret: step('secret', {
                done: { kind: 'finish' },
            }),
        },
        'plan'
    );

    const execution = await runWith(definition, {
        plan: [{ status: 'succeeded', outcome: 'secret' }],
    });

    assert.equal(execution.status, 'rejected');
    assert.equal(execution.termination.reason, 'undeclared_outcome');
    assert.equal(execution.run.steps[0]?.attempts[0]?.status, 'rejected');
    assert.equal(execution.run.steps.length, 1);
});

test('routes an optional step failure while preserving an earlier valid Result', async () => {
    const definition = workflow(
        {
            plan: step('plan', {
                done: { kind: 'step', stepId: 'style' },
            }),
            style: step(
                'style',
                {
                    failed: { kind: 'step', stepId: 'write' },
                },
                [{ kind: 'result', name: 'plan' }],
                { maxAttempts: 2 }
            ),
            write: step(
                'write',
                {
                    done: { kind: 'finish' },
                },
                [
                    { kind: 'result', name: 'plan' },
                    { kind: 'result', name: 'style', optional: true },
                ]
            ),
        },
        'plan'
    );

    const execution = await runWith(definition, {
        plan: [
            {
                status: 'succeeded',
                outcome: 'done',
                result: result('plan', { route: 'write' } satisfies Plan),
            },
        ],
        style: [
            {
                status: 'failed',
                errorCode: 'provider_unavailable',
                retryable: true,
            },
            {
                status: 'failed',
                errorCode: 'provider_unavailable',
                retryable: false,
            },
        ],
        write: [{ status: 'succeeded', outcome: 'done' }],
    });

    assert.equal(execution.status, 'completed');
    assert.deepEqual(execution.run.results.get('plan')?.value, {
        route: 'write',
    });
    assert.equal(execution.run.results.has('style'), false);
    assert.equal(execution.run.steps[1]?.attempts.length, 2);
    assert.equal(execution.run.steps[1]?.status, 'failed');
});

test('records multiple attempts as one semantic Step', async () => {
    const definition = workflow(
        {
            review: step(
                'review',
                {
                    done: { kind: 'finish' },
                },
                [{ kind: 'result', name: 'plan', optional: true }],
                { maxAttempts: 2 }
            ),
        },
        'review'
    );

    const execution = await runWith(definition, {
        review: [
            {
                status: 'failed',
                errorCode: 'malformed_output',
                retryable: true,
            },
            {
                status: 'succeeded',
                outcome: 'done',
                result: result('review', { decision: 'done' }),
            },
        ],
    });

    assert.equal(execution.status, 'completed');
    assert.equal(execution.run.steps.length, 1);
    const firstInputReference = execution.run.steps[0]?.inputReferences[0];
    assert.equal(firstInputReference?.kind, 'result');
    if (firstInputReference?.kind === 'result') {
        assert.equal(firstInputReference.name, 'plan');
    }
    assert.deepEqual(
        execution.run.steps[0]?.attempts.map((attempt) => attempt.status),
        ['failed', 'succeeded']
    );
    assert.deepEqual(
        execution.run.steps[0]?.attempts.map((attempt) => attempt.executor),
        ['code', 'code']
    );
    assert.deepEqual(execution.run.results.get('review')?.value, {
        decision: 'done',
    });
});

test('enforces the existing Execution Contract limits as the outer authority', async () => {
    const definition = workflow(
        {
            first: step('first', {
                done: { kind: 'step', stepId: 'second' },
            }),
            second: step('second', {
                done: { kind: 'finish' },
            }),
        },
        'first'
    );

    const execution = await runWith(
        definition,
        {
            first: [
                {
                    status: 'succeeded',
                    outcome: 'done',
                    usage: { totalTokens: 10 },
                },
            ],
        },
        {
            ...limits,
            maxWorkflowSteps: 10,
            maxTokensTotal: 10,
        }
    );

    assert.equal(execution.status, 'limited');
    assert.deepEqual(execution.termination, {
        reason: 'execution_limit',
        limit: 'maxTokensTotal',
    });
    assert.equal(execution.run.steps.length, 1);
    assert.equal(execution.run.usage.totalTokens, 10);
});

test('enforces tool-call limits only for steps that declare tool use', async () => {
    const definition = workflow(
        {
            first: {
                ...step('first', {
                    done: { kind: 'step', stepId: 'second' },
                }),
                resource: 'tool',
            },
            second: {
                ...step('second', {
                    done: { kind: 'finish' },
                }),
                resource: 'tool',
            },
        },
        'first'
    );

    const execution = await runWith(
        definition,
        {
            first: [
                {
                    status: 'succeeded',
                    outcome: 'done',
                    usage: { toolCalls: 1 },
                },
            ],
        },
        {
            ...limits,
            maxToolCalls: 1,
        }
    );

    assert.equal(execution.status, 'limited');
    assert.deepEqual(execution.termination, {
        reason: 'execution_limit',
        limit: 'maxToolCalls',
    });
    assert.deepEqual(
        execution.run.steps.map((record) => record.stepId),
        ['first']
    );
});

test('keeps executor categories separate from workflow topology', async () => {
    const definition: Workflow<TestContext> = {
        id: 'future-executor',
        version: 'v1',
        start: 'retrieve',
        steps: {
            retrieve: {
                ...step('retrieve', {
                    done: { kind: 'finish' },
                }),
                executor: 'context',
            },
        },
        limits: { source: 'execution-contract' },
    };
    let called = false;
    const executors: ExecutorRegistry<TestContext> = {
        context: async () => {
            called = true;
            return { status: 'succeeded', outcome: 'done' };
        },
    };

    const execution = await executeWorkflow({
        workflow: definition,
        context: { requestId: 'req-1' },
        executors,
        executionLimits: limits,
        startedAtMs: 0,
        now: () => 1,
    });

    assert.equal(execution.status, 'completed');
    assert.equal(called, true);
});

test('rejects a step when its executor is unavailable', async () => {
    const definition = workflow(
        {
            retrieve: step('retrieve', {
                done: { kind: 'finish' },
                failed: { kind: 'finish' },
            }),
        },
        'retrieve'
    );

    const execution = await executeWorkflow({
        workflow: definition,
        context: { requestId: 'req-1' },
        executors: {},
        executionLimits: limits,
        startedAtMs: 0,
        now: () => 1,
    });

    assert.equal(execution.status, 'rejected');
    assert.deepEqual(execution.termination, {
        reason: 'executor_unavailable',
        stepId: 'retrieve',
    });
    assert.equal(execution.run.steps.length, 0);
});

test('rejects a step when a required result reference is missing', async () => {
    const definition = workflow(
        {
            write: step('write', { done: { kind: 'finish' } }, [
                { kind: 'result', name: 'plan' },
            ]),
        },
        'write'
    );

    const execution = await runWith(definition, {});

    assert.equal(execution.status, 'rejected');
    assert.deepEqual(execution.termination, {
        reason: 'missing_required_input',
        stepId: 'write',
        inputName: 'plan',
    });
    assert.equal(execution.run.steps.length, 0);
});

test('rejects a result that violates the Step output contract', async () => {
    const definition = workflow(
        {
            write: step('write', { done: { kind: 'finish' } }),
        },
        'write'
    );

    const execution = await runWith(definition, {
        write: [
            {
                status: 'succeeded',
                outcome: 'done',
                result: result('unexpected', { text: 'answer' }),
            },
        ],
    });

    assert.equal(execution.status, 'rejected');
    assert.deepEqual(execution.termination, {
        reason: 'invalid_result',
        stepId: 'write',
        expectedName: 'write',
        actualName: 'unexpected',
    });
    assert.equal(execution.run.steps[0]?.attempts[0]?.status, 'rejected');
});

test('rejects a transition to an undefined Step', async () => {
    const definition = workflow(
        {
            first: step('first', {
                done: { kind: 'step', stepId: 'missing' },
            }),
        },
        'first'
    );

    const execution = await runWith(definition, {
        first: [{ status: 'succeeded', outcome: 'done' }],
    });

    assert.equal(execution.status, 'rejected');
    assert.deepEqual(execution.termination, {
        reason: 'definition_error',
        message: 'Workflow step is not defined: missing',
    });
});

test('clamps invalid Execution Contract limits to zero', async () => {
    const definition = workflow(
        {
            first: step('first', { done: { kind: 'finish' } }),
        },
        'first'
    );

    const invalidLimitCases: readonly ExecutionLimits[] = [
        { ...limits, maxWorkflowSteps: -1 },
        { ...limits, maxTokensTotal: Number.NaN },
    ];

    for (const executionLimits of invalidLimitCases) {
        const execution = await runWith(
            definition,
            { first: [{ status: 'succeeded', outcome: 'done' }] },
            executionLimits
        );

        assert.equal(execution.status, 'limited');
        assert.equal(execution.termination.reason, 'execution_limit');
        assert.equal(execution.run.steps.length, 0);
    }
});

test('exposes a typed semantic input/result seam without requiring predecessor identities', () => {
    const typedStep: Step<{ context: TestContext; plan: Plan }, Draft, 'done'> =
        {
            id: 'write',
            executor: 'model',
            input: {
                references: [
                    { kind: 'context' },
                    { kind: 'result', name: 'plan' },
                ],
            },
            output: {
                name: 'draft',
            },
            transitions: {
                done: { kind: 'finish' },
            },
        };

    assert.equal(typedStep.input.references[1]?.kind, 'result');
    assert.equal(typedStep.output.name, 'draft');

    const typedExecutor: TypedStepExecutor<
        TestContext,
        { plan: Plan },
        Draft
    > = async ({ input }) => ({
        status: 'succeeded',
        outcome: 'done',
        result: result('draft', { text: input.plan.route }),
    });
    assert.equal(typeof typedExecutor, 'function');
});

test('describes the current reviewed chat topology without making it live', () => {
    assert.equal(CURRENT_REVIEWED_CHAT_WORKFLOW.start, 'plan');
    assert.deepEqual(Object.keys(CURRENT_REVIEWED_CHAT_WORKFLOW.steps), [
        'plan',
        'context',
        'style',
        'checkStyle',
        'write',
        'review',
        'finish',
    ]);
    assert.deepEqual(CURRENT_REVIEWED_CHAT_WORKFLOW.steps.review?.transitions, {
        done: { kind: 'step', stepId: 'finish' },
        revise: { kind: 'step', stepId: 'write' },
        failed: { kind: 'step', stepId: 'finish' },
    });
    assert.deepEqual(CURRENT_REVIEWED_CHAT_WORKFLOW.steps.plan?.transitions, {
        continue: { kind: 'step', stepId: 'context' },
        terminal: { kind: 'finish' },
        failed: { kind: 'step', stepId: 'finish' },
    });
    assert.deepEqual(CURRENT_REVIEWED_CHAT_WORKFLOW.steps.write?.transitions, {
        generated: { kind: 'step', stepId: 'review' },
        failed: { kind: 'step', stepId: 'finish' },
    });
    assert.equal(CURRENT_REVIEWED_CHAT_WORKFLOW.steps.style?.maxRuns, 2);
    assert.equal(
        CURRENT_REVIEWED_CHAT_WORKFLOW.limits.source,
        'execution-contract'
    );
});
