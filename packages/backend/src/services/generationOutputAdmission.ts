/**
 * @description: Admits normalized generation results using deterministic output facts only.
 * Rejected results retain safe completion and usage facts through routing receipts, never raw output.
 * @footnote-scope: core
 * @footnote-module: GenerationOutputAdmission
 * @footnote-risk: high - A false admission can surface unusable provider output as a user answer.
 * @footnote-ethics: high - Mechanical limits protect user trust without delegating answer quality to an opaque judge.
 */

import {
    isNonNegativeSafeInteger,
    normalizeGenerationUsage,
    type GenerationResult,
} from '@footnote/agent-runtime';
import type {
    ExecutionReasonCode,
    GenerationCompletion,
    WorkflowRoutingChainAttemptSignal,
} from '@footnote/contracts/policy';
import type { RoutingChainAttemptLog } from './stepRoutingExecutor.js';

const MAX_GENERATION_EVIDENCE_STRING_LENGTH = 100;

const CITATION_ONLY_TOKEN_PATTERN =
    /\[(?:(?:source|citation|reference|s|c|ref)\s*)?\d+\](?:\([^\r\n)]{1,2048}\))?/giu;

const REPEATED_SOURCE_EVIDENCE_MARKER_PATTERN =
    /(?:^|\n)\s*TRUSTGRAPH SOURCE EVIDENCE\b/giu;

const NON_ANSWER_ACKNOWLEDGEMENT_PATTERN =
    /^(?:lgtm|ok(?:ay)?|looks good|done|noted|thanks)[.!]?$/iu;

const DISCLAIMING_NOTE_ONLY_PATTERN =
    /^[\s\p{P}\p{S}\p{M}\p{Default_Ignorable_Code_Point}]*\s*(?:note|disclaimer|remark)\s*:/iu;

const META_ONLY_OFFER_PATTERN =
    /^(?:skills|capabilities|analysis|plan)\s*:\s*(?:\r?\n\s*[-*]\s+[^\r\n]+){1,8}\s*(?:\r?\n\s*)?(?:i can|if you want|let me know|would you like)\b[\s\S]*$/iu;

const STATUS_ONLY_RESPONSE_PATTERN =
    /^produced\s+with\s+(?:partial|limited)\s+support\s+from\s+(?:a\s+)?footnote\s+engine[.!]?$/iu;

const PUNCTUATED_NUMERIC_FRAGMENT_PATTERN = /^[:;]\s*\d+(?:[.,]\d+)?\s*$/u;

const INTERNAL_INSTRUCTION_LEAK_PATTERN =
    /(?:need for additional evidence|provide a clear answer to the user's question|your task is to produce only the final answer|do not use your prior knowledge|you are allowed to add additional information)/iu;

const LIMITATION_ONLY_PATTERN =
    /^(?:tracing|determining|identifying|verifying|answering|summarizing|comparing)\b[\s\S]{0,500}(?:would require|requires|needs to)[\s\S]{0,250}(?:complete|full|entire)\s+(?:text|document|record|source)\b[\s\S]*$/iu;

const hasOnlyFormatting = (text: string): boolean =>
    /^[\s\p{P}\p{S}\p{M}\p{Default_Ignorable_Code_Point}]*$/u.test(text);

/**
 * Identifies provider output that has no answer content while preserving
 * legitimate short answers such as a grounded one-sentence abstention.
 */
const isStructurallyIncompleteText = (text: string): boolean => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return true;
    if (hasOnlyFormatting(trimmed)) return true;
    if (NON_ANSWER_ACKNOWLEDGEMENT_PATTERN.test(trimmed)) return true;
    if (DISCLAIMING_NOTE_ONLY_PATTERN.test(trimmed)) return true;
    if (META_ONLY_OFFER_PATTERN.test(trimmed)) return true;
    if (STATUS_ONLY_RESPONSE_PATTERN.test(trimmed)) return true;
    if (PUNCTUATED_NUMERIC_FRAGMENT_PATTERN.test(trimmed)) return true;
    if (INTERNAL_INSTRUCTION_LEAK_PATTERN.test(trimmed)) return true;
    if (LIMITATION_ONLY_PATTERN.test(trimmed)) return true;

    // A revision that repeats multiple raw evidence blocks is an evidence
    // echo, not a user-facing answer. Reject it so the workflow can preserve
    // the prior admitted draft rather than selecting the echoed context.
    if (
        (trimmed.match(REPEATED_SOURCE_EVIDENCE_MARKER_PATTERN)?.length ?? 0) >=
        2
    ) {
        return true;
    }

    const withoutCitationTokens = trimmed
        .replace(CITATION_ONLY_TOKEN_PATTERN, '')
        .replace(/https?:\/\/\S+/giu, '')
        .replace(/^\s*(?:sources?|citations?)\s*:\s*/iu, '')
        .trim();
    if (withoutCitationTokens.length === 0) return true;
    if (hasOnlyFormatting(withoutCitationTokens)) return true;

    const semanticWords = withoutCitationTokens
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .toLocaleLowerCase();
    if (/^(?:(?:source|citation|reference)s?\s*)+$/u.test(semanticWords)) {
        return true;
    }

    // A leading punctuation-only fragment followed by a polite offer is not
    // an answer. This remains generic and does not reject a complete answer
    // that ends with an offer to help.
    return /^[\s\p{P}\p{S}\p{M}\p{Default_Ignorable_Code_Point}]*\s+(?:would you like|can i help|let me know)\b/iu.test(
        trimmed
    );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

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
 * does not assess prose quality, relevance, or truth. Structural rejection is
 * limited to output with no substantive answer content.
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
    if (isStructurallyIncompleteText(normalizedResult.text)) {
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
    resultsByAttemptIndex: ReadonlyMap<number, GenerationResult>,
    options?: {
        captureCost?: (
            result: GenerationResult,
            requestedModel: string | undefined
        ) => {
            inputCostUsd: number;
            outputCostUsd: number;
            totalCostUsd: number;
        };
    }
): RoutingChainAttemptLog[] =>
    attempts.map((attempt) => {
        if (attempt.status === 'failed_transport_fallback') {
            return attempt;
        }
        const result = resultsByAttemptIndex.get(attempt.index);
        if (result === undefined) {
            return attempt;
        }
        const normalizedResult = normalizeGenerationResultEvidence(result);
        const cost = options?.captureCost?.(result, attempt.model);
        const actualModel =
            normalizedResult.upstreamAttribution?.resolvedModel ??
            normalizedResult.model;
        return {
            ...attempt,
            ...(normalizedResult.upstreamAttribution?.inferenceProvider !==
            undefined
                ? {
                      actualProvider:
                          normalizedResult.upstreamAttribution
                              .inferenceProvider,
                  }
                : {}),
            ...(actualModel === undefined ? {} : { actualModel }),
            ...(normalizedResult.finishReason === undefined
                ? {}
                : { finishReason: normalizedResult.finishReason }),
            ...(normalizedResult.completion === undefined
                ? {}
                : { completion: normalizedResult.completion }),
            ...(normalizedResult.usage === undefined
                ? {}
                : { usage: normalizedResult.usage }),
            ...(cost === undefined ? {} : { cost }),
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
        ...(attempt.selectionSource === undefined
            ? {}
            : { selectionSource: attempt.selectionSource }),
        ...(attempt.temporaryUnavailableReason === undefined
            ? {}
            : {
                  temporaryUnavailableReason:
                      attempt.temporaryUnavailableReason,
              }),
    }));
