/**
 * @description: Summarizes backend-authored workflow usage and cost records for trace display.
 * @footnote-scope: utility
 * @footnote-module: TraceAccounting
 * @footnote-risk: medium - Incorrect aggregation could misstate recorded model usage or spend.
 * @footnote-ethics: high - Complete cost labeling supports transparent resource reporting.
 */

import type {
    WorkflowRecord,
    WorkflowStepKind,
} from '@footnote/contracts/policy';

const MODEL_STEP_KINDS = new Set<WorkflowStepKind>([
    'plan',
    'generate',
    'assess',
    'revise',
]);

export type TraceAccountingSummary = {
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    recordedCost: {
        inputCostUsd: number;
        outputCostUsd: number;
        totalCostUsd: number;
    };
    usageStepCount: number;
    costStepCount: number;
    modelStepCount: number;
    costCoverage: 'complete' | 'partial' | 'not_applicable';
};

/**
 * Sums only values already recorded by the backend.
 *
 * Missing step costs remain visible through `costCoverage`; callers must not
 * present the recorded sum as a complete request total when coverage is partial.
 */
export const summarizeTraceAccounting = (
    workflow: WorkflowRecord | undefined
): TraceAccountingSummary | null => {
    if (!workflow) {
        return null;
    }

    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let inputCostUsd = 0;
    let outputCostUsd = 0;
    let totalCostUsd = 0;
    let usageStepCount = 0;
    let costStepCount = 0;
    let modelStepCount = 0;

    for (const step of workflow.steps) {
        if (
            step.outcome.status === 'executed' &&
            (MODEL_STEP_KINDS.has(step.stepKind) || step.model !== undefined)
        ) {
            modelStepCount += 1;
        }

        if (step.usage !== undefined) {
            const stepPromptTokens = step.usage.promptTokens ?? 0;
            const stepCompletionTokens = step.usage.completionTokens ?? 0;
            promptTokens += stepPromptTokens;
            completionTokens += stepCompletionTokens;
            totalTokens +=
                step.usage.totalTokens ??
                stepPromptTokens + stepCompletionTokens;
            usageStepCount += 1;
        }

        if (step.cost !== undefined) {
            inputCostUsd += step.cost.inputCostUsd;
            outputCostUsd += step.cost.outputCostUsd;
            totalCostUsd += step.cost.totalCostUsd;
            costStepCount += 1;
        }
    }

    const costCoverage =
        modelStepCount === 0
            ? 'not_applicable'
            : costStepCount >= modelStepCount
              ? 'complete'
              : 'partial';

    return {
        usage: {
            promptTokens,
            completionTokens,
            totalTokens,
        },
        recordedCost: {
            inputCostUsd,
            outputCostUsd,
            totalCostUsd,
        },
        usageStepCount,
        costStepCount,
        modelStepCount,
        costCoverage,
    };
};
