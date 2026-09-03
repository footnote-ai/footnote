/**
 * @description: Admits normalized generation results using deterministic output facts only.
 * Rejected results retain safe completion and usage facts through routing receipts, never raw output.
 * @footnote-scope: core
 * @footnote-module: GenerationOutputAdmission
 * @footnote-risk: high - A false admission can surface unusable provider output as a user answer.
 * @footnote-ethics: high - Mechanical limits protect user trust without delegating answer quality to an opaque judge.
 */

import type { GenerationResult } from '@footnote/agent-runtime';
import type {
    ExecutionReasonCode,
    GenerationCompletion,
    GenerationExecutionUsage,
    WorkflowRoutingChainAttemptSignal,
} from '@footnote/contracts/policy';
import type { RoutingChainAttemptLog } from './stepRoutingExecutor.js';

const MAX_GENERATION_EVIDENCE_STRING_LENGTH = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonNegativeSafeInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const normalizeEvidenceString = (value: unknown): string | undefined =>
    typeof value === 'string' &&
    value.length <= MAX_GENERATION_EVIDENCE_STRING_LENGTH
        ? value
        : undefined;

const normalizeGenerationCompletion = (
    value: unknown
): GenerationCompletion | undefined => {
    if (!isRecord(value)) {
        return undefined;
    }
    const status = value.status;
    const visibleTextLength = value.visibleTextLength;
    if (
        (status !== 'completed' &&
            status !== 'incomplete' &&
            status !== 'failed' &&
            status !== 'unknown') ||
        !isNonNegativeSafeInteger(visibleTextLength)
    ) {
        return undefined;
    }

    const reason =
        value.reason === undefined
            ? undefined
            : normalizeEvidenceString(value.reason);
    return {
        status,
        visibleTextLength,
        ...(reason === undefined ? {} : { reason }),
    };
};

const normalizeGenerationUsage = (
    value: unknown
): GenerationExecutionUsage | undefined => {
    if (!isRecord(value)) {
        return undefined;
    }
    const usage: GenerationExecutionUsage = {};
    const promptTokens = value.promptTokens;
    const cachedInputTokens = value.cachedInputTokens;
    const cacheWriteTokens = value.cacheWriteTokens;
    const completionTokens = value.completionTokens;
    const totalTokens = value.totalTokens;
    const reasoningTokens = value.reasoningTokens;
    if (isNonNegativeSafeInteger(promptTokens)) {
        usage.promptTokens = promptTokens;
    }
    if (isNonNegativeSafeInteger(cachedInputTokens)) {
        usage.cachedInputTokens = cachedInputTokens;
    }
    if (isNonNegativeSafeInteger(cacheWriteTokens)) {
        usage.cacheWriteTokens = cacheWriteTokens;
    }
    if (isNonNegativeSafeInteger(completionTokens)) {
        usage.completionTokens = completionTokens;
    }
    if (isNonNegativeSafeInteger(totalTokens)) {
        usage.totalTokens = totalTokens;
    }
    if (isNonNegativeSafeInteger(reasoningTokens)) {
        usage.reasoningTokens = reasoningTokens;
    }
    return Object.keys(usage).length === 0 ? undefined : usage;
};

/**
 * Normalizes provider-controlled generation evidence before it reaches cost,
 * workflow, or response-metadata serialization. Invalid individual facts are
 * omitted while valid text and evidence remain available fail open.
 */
export const normalizeGenerationResultEvidence = (
    result: GenerationResult
): GenerationResult => {
    const finishReason =
        result.finishReason === undefined
            ? undefined
            : normalizeEvidenceString(result.finishReason);
    const completion =
        result.completion === undefined
            ? undefined
            : normalizeGenerationCompletion(result.completion);
    const usage =
        result.usage === undefined
            ? undefined
            : normalizeGenerationUsage(result.usage);
    return {
        ...result,
        finishReason,
        completion,
        usage,
    };
};

export type GenerationAdmissionReasonCode = Extract<
    ExecutionReasonCode,
    | 'generation_empty_output'
    | 'generation_failed_output'
    | 'generation_incomplete_before_output'
>;

export type GenerationAdmission =
    | { admitted: true }
    | { admitted: false; reasonCode: GenerationAdmissionReasonCode };

/**
 * Decides whether a normalized generation result can become a response draft.
 * This intentionally checks only visible text and runtime completion facts; it
 * does not assess prose quality, formatting, relevance, or truth.
 */
export const admitGenerationResult = (
    result: GenerationResult
): GenerationAdmission => {
    const normalizedResult = normalizeGenerationResultEvidence(result);
    if (normalizedResult.completion?.status === 'failed') {
        return { admitted: false, reasonCode: 'generation_failed_output' };
    }
    if (normalizedResult.completion?.status === 'incomplete') {
        return {
            admitted: false,
            reasonCode: 'generation_incomplete_before_output',
        };
    }
    if (
        /^[\p{White_Space}\p{Default_Ignorable_Code_Point}]*$/u.test(
            normalizedResult.text
        )
    ) {
        return { admitted: false, reasonCode: 'generation_empty_output' };
    }
    return { admitted: true };
};

/**
 * Adds only bounded runtime facts to generation routing receipts. Rejected
 * response bodies stay out of provenance storage under the existing privacy
 * boundary, while route identity, completion, and usage remain auditable.
 */
export const attachGenerationAttemptEvidence = (
    attempts: readonly RoutingChainAttemptLog[],
    resultsByAttemptIndex: ReadonlyMap<number, GenerationResult>
): RoutingChainAttemptLog[] =>
    attempts.map((attempt) => {
        const result = resultsByAttemptIndex.get(attempt.index);
        if (result === undefined) {
            return attempt;
        }
        const normalizedResult = normalizeGenerationResultEvidence(result);
        return {
            ...attempt,
            ...(normalizedResult.finishReason === undefined
                ? {}
                : { finishReason: normalizedResult.finishReason }),
            ...(normalizedResult.completion === undefined
                ? {}
                : { completion: normalizedResult.completion }),
            ...(normalizedResult.usage === undefined
                ? {}
                : { usage: normalizedResult.usage }),
        };
    });

/** Projects routing receipts into the bounded public generation metadata shape. */
export const toGenerationRoutingAttemptSignals = (
    attempts: readonly RoutingChainAttemptLog[]
): WorkflowRoutingChainAttemptSignal[] =>
    attempts.map((attempt) => ({
        index: attempt.index,
        profileId: attempt.profileId,
        ...(attempt.provider === undefined
            ? {}
            : { provider: attempt.provider }),
        ...(attempt.model === undefined ? {} : { model: attempt.model }),
        status: attempt.status,
        ...(attempt.reasonCode === undefined
            ? {}
            : { reasonCode: attempt.reasonCode }),
        ...(attempt.finishReason === undefined
            ? {}
            : { finishReason: attempt.finishReason }),
        ...(attempt.completion === undefined
            ? {}
            : { completion: attempt.completion }),
        ...(attempt.usage === undefined ? {} : { usage: attempt.usage }),
        chooseOneUsed: attempt.chooseOneUsed,
        ...(attempt.chooseOneSelectedIndex === undefined
            ? {}
            : { chooseOneSelectedIndex: attempt.chooseOneSelectedIndex }),
        ...(attempt.seedKeyType === undefined
            ? {}
            : { seedKeyType: attempt.seedKeyType }),
    }));
