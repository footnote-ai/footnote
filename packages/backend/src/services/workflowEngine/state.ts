/**
 * @description: Defines live workflow runtime state and delegates counter updates
 * to the shared Execution Contract accounting authority.
 * @footnote-scope: core
 * @footnote-module: WorkflowEngineState
 * @footnote-risk: medium - Counter drift can break limits and lineage accuracy.
 * @footnote-ethics: medium - State correctness supports traceable runtime behavior.
 */
import type { WorkflowStepKind } from '@footnote/contracts/policy';
import { activityForWorkflowStep, recordExecution } from './limits.js';

export type WorkflowState = {
    workflowId: string;
    workflowName: string;
    startedAtMs: number;
    currentStepKind: WorkflowStepKind | null;
    stepCount: number;
    toolCallCount: number;
    planCallCount: number;
    reviewCallCount: number;
    deliberationCallCount: number;
    totalTokens: number;
};

export const createInitialWorkflowState = (input: {
    workflowId: string;
    workflowName: string;
    startedAtMs: number;
}): WorkflowState => ({
    workflowId: input.workflowId,
    workflowName: input.workflowName,
    startedAtMs: input.startedAtMs,
    currentStepKind: null,
    stepCount: 0,
    toolCallCount: 0,
    planCallCount: 0,
    reviewCallCount: 0,
    deliberationCallCount: 0,
    totalTokens: 0,
});

export const cloneWorkflowState = (state: WorkflowState): WorkflowState => ({
    ...state,
});

/**
 * Retains the live engine's legacy Step-kind boundary while delegating all
 * Execution Contract counter semantics to `recordExecution`.
 */
export const applyStepExecutionToState = (
    state: WorkflowState,
    stepKind: WorkflowStepKind,
    usageTokens: number,
    toolCallsExecuted: number,
    deliberationCallsExecuted: number
): WorkflowState => ({
    ...state,
    ...recordExecution({
        state,
        activity: activityForWorkflowStep(stepKind),
        usage: {
            totalTokens: usageTokens,
            toolCalls: toolCallsExecuted,
            deliberationCalls: deliberationCallsExecuted,
        },
        completedStep: true,
    }),
    currentStepKind: stepKind,
});
