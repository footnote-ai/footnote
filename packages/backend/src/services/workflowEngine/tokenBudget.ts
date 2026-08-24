/**
 * @description: Provides deterministic, provider-neutral token admission estimates for bounded workflow calls.
 * It limits downstream output when the remaining workflow budget is known and keeps provider usage authoritative.
 * @footnote-scope: utility
 * @footnote-module: WorkflowTokenBudget
 * @footnote-risk: medium - Conservative estimates can stop a workflow earlier than a provider-specific tokenizer would.
 * @footnote-ethics: high - Honest cumulative limits prevent hidden deliberation cost and preserve auditable fail-open behavior.
 */
import type {
    GenerationRequest,
    RuntimeMessage,
} from '@footnote/agent-runtime';
import { UNBOUNDED_EXECUTION_LIMIT } from './limits.js';

export const DEFAULT_WORKFLOW_GENERATION_MAX_OUTPUT_TOKENS = 1200;

const ESTIMATED_CHARS_PER_TOKEN = 4;

const estimateTextTokens = (value: string): number =>
    Math.max(1, Math.ceil(value.length / ESTIMATED_CHARS_PER_TOKEN));

export const estimateRuntimeMessageTokens = (
    messages: readonly RuntimeMessage[]
): number =>
    estimateTextTokens(
        messages
            .map((message) => `${message.role}\n${message.content}`)
            .join('\n')
    );

export const estimateGenerationTokenBudget = (
    request: GenerationRequest
): number =>
    estimateRuntimeMessageTokens(request.messages) +
    (request.maxOutputTokens ?? DEFAULT_WORKFLOW_GENERATION_MAX_OUTPUT_TOKENS);

/**
 * Bounds one generation request against the remaining cumulative workflow
 * budget. The estimate is deliberately conservative and provider-neutral;
 * provider-reported usage remains the authoritative accounting value.
 */
export const boundGenerationRequestToWorkflowBudget = (input: {
    request: GenerationRequest;
    totalTokens: number;
    maxTokensTotal: number;
}): GenerationRequest | undefined => {
    const requestedOutputTokens =
        input.request.maxOutputTokens ??
        DEFAULT_WORKFLOW_GENERATION_MAX_OUTPUT_TOKENS;
    if (
        input.maxTokensTotal >= UNBOUNDED_EXECUTION_LIMIT ||
        !Number.isFinite(input.maxTokensTotal)
    ) {
        return {
            ...input.request,
            maxOutputTokens: requestedOutputTokens,
        };
    }

    const remainingTokens = Math.max(
        0,
        Math.floor(input.maxTokensTotal - input.totalTokens)
    );
    const promptTokens = estimateRuntimeMessageTokens(input.request.messages);
    const availableOutputTokens = remainingTokens - promptTokens;
    if (availableOutputTokens < 1) {
        return undefined;
    }

    return {
        ...input.request,
        maxOutputTokens: Math.max(
            1,
            Math.min(requestedOutputTokens, availableOutputTokens)
        ),
    };
};
