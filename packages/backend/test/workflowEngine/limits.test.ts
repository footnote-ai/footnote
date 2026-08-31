/**
 * @description: Verifies workflow execution-limit checks and termination mappings.
 * @footnote-scope: test
 * @footnote-module: WorkflowEngineLimitTests
 * @footnote-risk: medium - Limit regressions can cause runaway or premature stops.
 * @footnote-ethics: high - Bound enforcement is core to safe execution control.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    admitExecution,
    checkExecutionLimits,
    mapLimitExhaustionToTerminationReason,
    recordAttempt,
    recordStep,
    type ExecutionLimits,
} from '../../src/services/workflowEngine/limits.js';
import {
    boundGenerationRequestToWorkflowBudget,
    calculatePresentationOutputBudget,
    calculateReviewedGenerationOutputBudget,
    DEFAULT_REASONING_GENERATION_MAX_OUTPUT_TOKENS,
    DEFAULT_WORKFLOW_GENERATION_MAX_OUTPUT_TOKENS,
    estimateGenerationTokenBudget,
    resolveDefaultGenerationMaxOutputTokens,
} from '../../src/services/workflowEngine/tokenBudget.js';

const createLimits = (): ExecutionLimits => ({
    maxWorkflowSteps: 5,
    maxToolCalls: 2,
    maxDeliberationCalls: 3,
    maxTokensTotal: 100,
    maxDurationMs: 1000,
});

test('checkExecutionLimits reports each exhausted limit key', () => {
    const limits = createLimits();
    const startedAtMs = 500;
    const withinDurationNowMs = 1200;
    const exhaustedDurationNowMs = 1500;

    const exhaustedBySteps = checkExecutionLimits(
        {
            startedAtMs,
            stepCount: 5,
            toolCallCount: 0,
            planCallCount: 0,
            reviewCallCount: 0,
            deliberationCallCount: 0,
            totalTokens: 0,
        },
        limits,
        withinDurationNowMs
    );
    assert.equal(exhaustedBySteps.withinLimits, false);
    assert.equal(exhaustedBySteps.exhaustedBy, 'maxWorkflowSteps');

    const exhaustedByTools = checkExecutionLimits(
        {
            startedAtMs,
            stepCount: 0,
            toolCallCount: 2,
            planCallCount: 0,
            reviewCallCount: 0,
            deliberationCallCount: 0,
            totalTokens: 0,
        },
        limits,
        withinDurationNowMs,
        'tool'
    );
    assert.equal(exhaustedByTools.withinLimits, false);
    assert.equal(exhaustedByTools.exhaustedBy, 'maxToolCalls');

    const exhaustedByDeliberation = checkExecutionLimits(
        {
            startedAtMs,
            stepCount: 0,
            toolCallCount: 0,
            planCallCount: 1,
            reviewCallCount: 2,
            deliberationCallCount: 3,
            totalTokens: 0,
        },
        limits,
        withinDurationNowMs,
        'assess'
    );
    assert.equal(exhaustedByDeliberation.withinLimits, false);
    assert.equal(exhaustedByDeliberation.exhaustedBy, 'maxDeliberationCalls');

    const exhaustedByTokens = checkExecutionLimits(
        {
            startedAtMs,
            stepCount: 0,
            toolCallCount: 0,
            planCallCount: 0,
            reviewCallCount: 0,
            deliberationCallCount: 0,
            totalTokens: 100,
        },
        limits,
        withinDurationNowMs
    );
    assert.equal(exhaustedByTokens.withinLimits, false);
    assert.equal(exhaustedByTokens.exhaustedBy, 'maxTokensTotal');

    const exhaustedByDuration = checkExecutionLimits(
        {
            startedAtMs,
            stepCount: 0,
            toolCallCount: 0,
            planCallCount: 0,
            reviewCallCount: 0,
            deliberationCallCount: 0,
            totalTokens: 0,
        },
        limits,
        exhaustedDurationNowMs
    );
    assert.equal(exhaustedByDuration.withinLimits, false);
    assert.equal(exhaustedByDuration.exhaustedBy, 'maxDurationMs');
});

test('mapLimitExhaustionToTerminationReason maps to expected reasons', () => {
    assert.equal(
        mapLimitExhaustionToTerminationReason('maxWorkflowSteps'),
        'budget_exhausted_steps'
    );
    assert.equal(
        mapLimitExhaustionToTerminationReason('maxToolCalls'),
        'max_tool_calls_reached'
    );
    assert.equal(
        mapLimitExhaustionToTerminationReason('maxDeliberationCalls'),
        'max_deliberation_calls_reached'
    );
    assert.equal(
        mapLimitExhaustionToTerminationReason('maxTokensTotal'),
        'budget_exhausted_tokens'
    );
    assert.equal(
        mapLimitExhaustionToTerminationReason('maxDurationMs'),
        'budget_exhausted_time'
    );
});

test('checkExecutionLimits reserves the requested next-step token budget', () => {
    const limits = createLimits();
    const state = {
        workflowId: 'wf_1',
        workflowName: 'workflow_test',
        startedAtMs: 500,
        currentStepKind: 'generate' as const,
        stepCount: 0,
        toolCallCount: 0,
        planCallCount: 0,
        reviewCallCount: 0,
        deliberationCallCount: 0,
        totalTokens: 90,
    };

    assert.equal(
        checkExecutionLimits(state, limits, 1200, 'assess', 10).withinLimits,
        true
    );
    assert.deepEqual(checkExecutionLimits(state, limits, 1200, 'assess', 11), {
        withinLimits: false,
        exhaustedBy: 'maxTokensTotal',
    });
});

test('checkExecutionLimits preserves an explicit zero-token reservation', () => {
    const state = {
        workflowId: 'wf_1',
        workflowName: 'workflow_test',
        startedAtMs: 500,
        currentStepKind: null,
        stepCount: 0,
        toolCallCount: 0,
        planCallCount: 0,
        reviewCallCount: 0,
        deliberationCallCount: 0,
        totalTokens: 100,
    };
    const limits: ExecutionLimits = {
        maxWorkflowSteps: 10,
        maxToolCalls: 2,
        maxDeliberationCalls: 4,
        maxTokensTotal: 100,
        maxDurationMs: 1_000,
    };

    assert.deepEqual(checkExecutionLimits(state, limits, 600, 'finalize'), {
        withinLimits: false,
        exhaustedBy: 'maxTokensTotal',
    });
    assert.deepEqual(checkExecutionLimits(state, limits, 600, 'finalize', 0), {
        withinLimits: true,
    });
});

test('generation admission counts prompt estimate and clamps provider output', () => {
    const bounded = boundGenerationRequestToWorkflowBudget({
        request: {
            messages: [{ role: 'user', content: 'x'.repeat(40) }],
        },
        totalTokens: 20,
        maxTokensTotal: 100,
    });

    assert.ok(bounded);
    assert.equal(bounded.maxOutputTokens, 68);
    assert.ok(estimateGenerationTokenBudget(bounded) <= 100 - 20);
});

test('reasoning generation receives a larger provider output reserve without changing ordinary defaults', () => {
    assert.equal(DEFAULT_WORKFLOW_GENERATION_MAX_OUTPUT_TOKENS, 1200);
    assert.equal(DEFAULT_REASONING_GENERATION_MAX_OUTPUT_TOKENS, 2400);
    assert.equal(
        resolveDefaultGenerationMaxOutputTokens({
            reasoningEffort: 'medium',
            capabilities: {
                canUseSearch: false,
                supportedReasoningEfforts: ['none', 'medium'],
            },
        }),
        2400
    );
    assert.equal(
        resolveDefaultGenerationMaxOutputTokens({ reasoningEffort: 'none' }),
        1200
    );
    const bounded = boundGenerationRequestToWorkflowBudget({
        request: {
            messages: [{ role: 'user', content: 'Answer briefly.' }],
            reasoningEffort: 'medium',
            capabilities: {
                canUseSearch: false,
                supportedReasoningEfforts: ['none', 'medium'],
            },
        },
        totalTokens: 0,
        maxTokensTotal: 10000,
    });
    assert.equal(bounded?.maxOutputTokens, 2400);
});

test('generation admission fails closed before provider call when prompt uses the remainder', () => {
    const bounded = boundGenerationRequestToWorkflowBudget({
        request: {
            messages: [{ role: 'user', content: 'x'.repeat(400) }],
        },
        totalTokens: 0,
        maxTokensTotal: 100,
    });

    assert.equal(bounded, undefined);
});

test('presentation admission reserves assessment and candidate text copied into authority', () => {
    assert.equal(
        calculateReviewedGenerationOutputBudget({
            totalTokens: 100,
            maxTokensTotal: 1000,
            requestedOutputTokens: 500,
            authoritativePromptTokens: 100,
            assessmentPromptTokensWithoutDraft: 100,
            assessmentOutputTokens: 50,
        }),
        325
    );
    assert.deepEqual(
        calculatePresentationOutputBudget({
            totalTokens: 100,
            maxTokensTotal: 1000,
            requestedCandidateOutputTokens: 500,
            candidatePromptTokens: 100,
            authoritativePromptTokens: 100,
            authoritativeOutputTokens: 200,
            assessmentPromptTokens: 100,
            assessmentOutputTokens: 50,
        }),
        {
            candidateOutputTokens: 175,
            remainingTokens: 900,
            reservedTokens: 900,
        }
    );
    assert.equal(
        calculatePresentationOutputBudget({
            totalTokens: 950,
            maxTokensTotal: 1000,
            requestedCandidateOutputTokens: 500,
            candidatePromptTokens: 100,
            authoritativePromptTokens: 100,
            authoritativeOutputTokens: 200,
            assessmentPromptTokens: 100,
            assessmentOutputTokens: 50,
        }),
        undefined
    );
});

test('admitExecution preserves plan and review caps while excluding presentation', () => {
    const state = {
        startedAtMs: 500,
        stepCount: 0,
        toolCallCount: 0,
        planCallCount: 1,
        reviewCallCount: 1,
        deliberationCallCount: 2,
        totalTokens: 0,
    };
    const caps: ExecutionLimits = {
        ...createLimits(),
        maxPlanCycles: 1,
        maxReviewCycles: 1,
    };

    assert.deepEqual(
        admitExecution({
            state,
            limits: caps,
            nowMs: 600,
            activity: { deliberation: 'plan' },
        }),
        { admitted: false, exhaustedBy: 'maxDeliberationCalls' }
    );
    assert.deepEqual(
        admitExecution({
            state,
            limits: caps,
            nowMs: 600,
            activity: { deliberation: 'review' },
        }),
        { admitted: false, exhaustedBy: 'maxDeliberationCalls' }
    );
    assert.deepEqual(
        admitExecution({
            state,
            limits: caps,
            nowMs: 600,
        }),
        { admitted: true }
    );
    assert.deepEqual(
        admitExecution({
            state: { ...state, deliberationCallCount: 3 },
            limits: caps,
            nowMs: 600,
            activity: { deliberation: 'general' },
        }),
        { admitted: false, exhaustedBy: 'maxDeliberationCalls' }
    );
});

test('recordAttempt and recordStep separate execution accounting', () => {
    const state = {
        startedAtMs: 500,
        stepCount: 0,
        toolCallCount: 0,
        planCallCount: 0,
        reviewCallCount: 0,
        deliberationCallCount: 0,
        totalTokens: 0,
    };

    assert.deepEqual(
        recordAttempt({
            state,
            activity: { tool: 'one-or-more' },
            usage: { totalTokens: 3, toolCalls: 2 },
        }),
        {
            ...state,
            stepCount: 0,
            toolCallCount: 2,
            totalTokens: 3,
        }
    );
    assert.deepEqual(
        recordAttempt({
            state,
            activity: { deliberation: 'review' },
            usage: { deliberationCalls: 1 },
        }),
        {
            ...state,
            stepCount: 0,
            deliberationCallCount: 1,
        }
    );
    assert.deepEqual(
        recordAttempt({
            state,
            activity: { tool: 'one-or-more' },
            usage: { toolCalls: 0 },
        }),
        {
            ...state,
            stepCount: 0,
        }
    );
    assert.deepEqual(
        recordStep({ state, activity: { deliberation: 'review' } }),
        {
            ...state,
            stepCount: 1,
            reviewCallCount: 1,
        }
    );
});
