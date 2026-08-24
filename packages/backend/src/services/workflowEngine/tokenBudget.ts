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
import type { PostChatRequest } from '@footnote/contracts/web';
import { UNBOUNDED_EXECUTION_LIMIT } from './limits.js';

export const DEFAULT_WORKFLOW_GENERATION_MAX_OUTPUT_TOKENS = 1200;

const ESTIMATED_CHARS_PER_TOKEN = 4;
const PLANNER_PROMPT_OVERHEAD_TOKENS = 1_200;

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

/** Estimates planner input from the bounded conversation window plus fixed planner scaffolding. */
export const estimatePlannerInputTokens = (request: PostChatRequest): number =>
    estimateTextTokens(
        JSON.stringify({
            surface: request.surface,
            trigger: request.trigger,
            latestUserInput: request.latestUserInput,
            conversation: request.conversation.slice(-12),
            capabilities: request.capabilities,
        })
    ) + PLANNER_PROMPT_OVERHEAD_TOKENS;

export const estimatePlannerTokenBudget = (input: {
    request: PostChatRequest;
    maxOutputTokens: number;
}): number => estimatePlannerInputTokens(input.request) + input.maxOutputTokens;

/**
 * Bounds authoritative output so one assessment can still be admitted. The
 * output is counted once as generation and once as assessment input.
 */
export const calculateReviewedGenerationOutputBudget = (input: {
    totalTokens: number;
    maxTokensTotal: number;
    requestedOutputTokens: number;
    authoritativePromptTokens: number;
    assessmentPromptTokensWithoutDraft: number;
    assessmentOutputTokens: number;
}): number | undefined => {
    if (
        input.maxTokensTotal >= UNBOUNDED_EXECUTION_LIMIT ||
        !Number.isFinite(input.maxTokensTotal)
    ) {
        return Math.max(1, Math.floor(input.requestedOutputTokens));
    }

    const remainingTokens = Math.max(
        0,
        Math.floor(input.maxTokensTotal - input.totalTokens)
    );
    const availableOutputTokens = Math.floor(
        (remainingTokens -
            Math.max(0, Math.floor(input.authoritativePromptTokens)) -
            Math.max(0, Math.floor(input.assessmentPromptTokensWithoutDraft)) -
            Math.max(0, Math.floor(input.assessmentOutputTokens))) /
            2
    );
    if (availableOutputTokens < 1) {
        return undefined;
    }

    return Math.min(
        Math.max(1, Math.floor(input.requestedOutputTokens)),
        availableOutputTokens
    );
};

export type PresentationBudgetAdmission = {
    candidateOutputTokens: number;
    remainingTokens: number;
    reservedTokens: number;
};

/**
 * Calculates an optional candidate allowance while reserving the later
 * authoritative and assessment calls. Candidate output is counted twice:
 * once as candidate completion and once as text inserted into authority.
 */
export const calculatePresentationOutputBudget = (input: {
    totalTokens: number;
    maxTokensTotal: number;
    requestedCandidateOutputTokens: number;
    candidatePromptTokens: number;
    authoritativePromptTokens: number;
    authoritativeOutputTokens: number;
    assessmentPromptTokens: number;
    assessmentOutputTokens: number;
}): PresentationBudgetAdmission | undefined => {
    if (
        input.maxTokensTotal >= UNBOUNDED_EXECUTION_LIMIT ||
        !Number.isFinite(input.maxTokensTotal)
    ) {
        const candidateOutputTokens = Math.max(
            1,
            Math.floor(input.requestedCandidateOutputTokens)
        );
        return {
            candidateOutputTokens,
            remainingTokens: UNBOUNDED_EXECUTION_LIMIT,
            reservedTokens: 0,
        };
    }

    const remainingTokens = Math.max(
        0,
        Math.floor(input.maxTokensTotal - input.totalTokens)
    );
    const fixedReservation = [
        input.candidatePromptTokens,
        input.authoritativePromptTokens,
        input.authoritativeOutputTokens,
        input.assessmentPromptTokens,
        input.assessmentOutputTokens,
    ].reduce((total, value) => total + Math.max(0, Math.floor(value)), 0);
    const candidateOutputAllowance = Math.floor(
        (remainingTokens - fixedReservation) / 2
    );
    if (candidateOutputAllowance < 1) {
        return undefined;
    }

    const candidateOutputTokens = Math.min(
        Math.max(1, Math.floor(input.requestedCandidateOutputTokens)),
        candidateOutputAllowance
    );

    return {
        candidateOutputTokens,
        remainingTokens,
        reservedTokens: fixedReservation + candidateOutputTokens * 2,
    };
};

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
