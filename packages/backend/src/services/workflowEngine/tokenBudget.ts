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
import type { ModelProfile } from '@footnote/contracts';
import { UNBOUNDED_EXECUTION_LIMIT } from './limits.js';

export const DEFAULT_WORKFLOW_GENERATION_MAX_OUTPUT_TOKENS = 128_000;
/** Reasoning tokens share the provider output cap, so reserve more room when reasoning is requested. */
export const DEFAULT_REASONING_GENERATION_MAX_OUTPUT_TOKENS = 256_000;
export const DEFAULT_WORKFLOW_PLANNER_MAX_OUTPUT_TOKENS = 2_000;
export const DEFAULT_WORKFLOW_ASSESSMENT_MAX_OUTPUT_TOKENS = 512;

/*
 * A rewrite should track the source window rather than the provider's largest
 * general-purpose response ceiling. Four times the source plus 1k supports
 * expansion for short prose, while 16k keeps the optional call bounded.
 */
const PRESENTATION_OUTPUT_MAX_TOKENS = 16_384;
const PRESENTATION_OUTPUT_EXPANSION_FACTOR = 4;
const PRESENTATION_OUTPUT_MARGIN_TOKENS = 1_024;

export const resolveDefaultGenerationMaxOutputTokens = (
    request: Pick<GenerationRequest, 'reasoningEffort' | 'capabilities'>
): number =>
    request.reasoningEffort !== undefined &&
    request.reasoningEffort !== 'none' &&
    request.capabilities?.supportedReasoningEfforts?.includes(
        request.reasoningEffort
    ) === true
        ? DEFAULT_REASONING_GENERATION_MAX_OUTPUT_TOKENS
        : DEFAULT_WORKFLOW_GENERATION_MAX_OUTPUT_TOKENS;

/**
 * Resolves a finite presentation allowance from the source prompt and profile ceiling.
 * The source prompt is the provider-neutral proxy available before an authoritative
 * draft exists; the hard cap prevents presentation from inheriting huge model limits.
 */
export const resolvePresentationOutputMaxTokens = (input: {
    sourcePromptTokens: number;
    profileMaxOutputTokens?: number;
}): number => {
    const sourcePromptTokens = Math.max(
        1,
        Math.floor(input.sourcePromptTokens)
    );
    const profileCeiling =
        input.profileMaxOutputTokens === undefined ||
        !Number.isFinite(input.profileMaxOutputTokens)
            ? PRESENTATION_OUTPUT_MAX_TOKENS
            : Math.max(1, Math.floor(input.profileMaxOutputTokens));
    const sourceBound =
        sourcePromptTokens * PRESENTATION_OUTPUT_EXPANSION_FACTOR +
        PRESENTATION_OUTPUT_MARGIN_TOKENS;
    return Math.max(
        1,
        Math.min(profileCeiling, PRESENTATION_OUTPUT_MAX_TOKENS, sourceBound)
    );
};

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
    (request.maxOutputTokens ??
        resolveDefaultGenerationMaxOutputTokens(request));

/** Applies a selected profile's declared output ceiling after request defaults resolve. */
export const capGenerationRequestToProfileMax = (input: {
    request: GenerationRequest;
    profile: Pick<
        ModelProfile,
        'capabilities' | 'defaultReasoningEffort' | 'maxOutputTokens'
    >;
}): GenerationRequest & { maxOutputTokens: number } => {
    const requestWithProfileDefaults = {
        ...input.request,
        reasoningEffort:
            input.request.reasoningEffort ??
            input.profile.defaultReasoningEffort,
        capabilities: input.profile.capabilities,
    };
    const requestedOutputTokens =
        input.request.maxOutputTokens ??
        resolveDefaultGenerationMaxOutputTokens(requestWithProfileDefaults);
    const profileMaximum = input.profile.maxOutputTokens;

    return {
        ...input.request,
        maxOutputTokens:
            profileMaximum === undefined
                ? requestedOutputTokens
                : Math.min(requestedOutputTokens, profileMaximum),
    };
};

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
        resolveDefaultGenerationMaxOutputTokens(input.request);
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
