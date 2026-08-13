/**
 * @description: Runs the bounded, presentation-only rewrite and veto-only semantic check.
 * @footnote-scope: core
 * @footnote-module: StyleRewrite
 * @footnote-risk: high - An unsafe rewrite could change the delivered answer, so uncertainty keeps the original.
 * @footnote-ethics: high - Styling has no authority over meaning, safety, evidence, or execution.
 */
import type {
    GenerationResult,
    GenerationRuntime,
} from '@footnote/agent-runtime';
import type { ModelProfile } from '@footnote/contracts';
import type {
    StyleRewriteMetadata,
    StyleRewriteReasonCode,
} from '@footnote/contracts/policy';
import { hmacId } from '../utils/pseudonymization.js';

export type StyleRewriteConfig = {
    enabled: boolean;
    profileId: string | null;
    validatorProfileId: string | null;
    timeoutMs: number;
    validatorTimeoutMs: number;
    /** Backend-only secret for opaque trace identifiers. Never request-supplied. */
    traceHmacSecret?: string | null;
    profile?: ModelProfile;
    validatorProfile?: ModelProfile;
};

export type StyleRewritePersona = {
    id: string;
    presentationGuidance: string;
};

export type StyleRewriteEligibility = { protectedContent: boolean };

export type StyleRewriteIntensity = 'standard' | 'restrained' | 'skipped';

/** Caution is the only TRACE axis that can constrain v1 presentation. */
export const resolveStyleRewriteIntensity = (
    caution: number | undefined
): StyleRewriteIntensity => {
    if (caution === 5) return 'skipped';
    if (caution === undefined || caution === 4) return 'restrained';
    return 'standard';
};

export type StyleRewriteResult = {
    text: string;
    metadata: StyleRewriteMetadata;
    rewriteResult?: GenerationResult;
    validatorResult?: GenerationResult;
};

type SemanticVerdict = 'equivalent' | 'drift' | 'uncertain';

const hmacIdentifier = (
    secret: string | null | undefined,
    text: string,
    kind: 'original' | 'presented'
): string | undefined =>
    secret?.trim()
        ? hmacId(secret, text, `style-rewrite:v1:${kind}`)
        : undefined;

const withTimeout = async <T>(
    timeoutMs: number,
    run: (signal: AbortSignal) => Promise<T>,
    errorMessage: string
): Promise<T> => {
    const controller = new AbortController();
    let handle: ReturnType<typeof setTimeout> | undefined;
    try {
        const timeout = new Promise<never>((_resolve, reject) => {
            handle = setTimeout(() => {
                controller.abort();
                reject(new Error(errorMessage));
            }, timeoutMs);
        });
        return await Promise.race([run(controller.signal), timeout]);
    } finally {
        if (handle !== undefined) clearTimeout(handle);
    }
};

const isPlainProse = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.includes('```')) return false;
    try {
        JSON.parse(trimmed);
        return false;
    } catch {
        // Ordinary prose can contain links, labels, lists, and code names.
        // Their literal values remain protected by the mechanical invariants
        // and the independent semantic veto below.
    }
    if (/\b(?:select|insert|update|delete|curl|npm|pnpm|git)\b/iu.test(trimmed))
        return false;
    if (
        /\b(?:i (?:can't|cannot)|unable to|cannot assist|i must refuse)\b/iu.test(
            trimmed
        )
    )
        return false;
    return true;
};

const occurrences = (text: string, expression: RegExp): string[] =>
    Array.from(text.matchAll(expression), (match) => match[0]);

/** Normalizes only a URL's scheme and host; path, query, and fragment stay exact. */
const canonicalUrl = (url: string): string => {
    const trimmed = url.replace(/[.,!?;:]+$/u, '');
    const parts = trimmed.match(/^(https?):\/\/([^/?#]+)(.*)$/iu);
    return parts
        ? `${parts[1].toLowerCase()}://${parts[2].toLowerCase()}${parts[3]}`
        : trimmed;
};

const wordEditRatio = (original: string, rewritten: string): number => {
    const before = original.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
    const after = rewritten.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
    const afterSet = new Set(after);
    const shared = before.filter((word) => afterSet.has(word)).length;
    return 1 - shared / Math.max(before.length, after.length, 1);
};

/** Exported for focused safety tests. These checks detect visible drift; they do not prove equivalence. */
export const passesStyleRewriteMechanicalChecks = (
    originalText: string,
    rewrittenText: string
): boolean => {
    const original = originalText.trim();
    const rewritten = rewrittenText.trim();
    if (!rewritten || rewritten === original) return false;
    const originalUrls = new Set(
        occurrences(original, /https?:\/\/[^\s)]+/giu).map(canonicalUrl)
    );
    const rewrittenUrls = new Set(
        occurrences(rewritten, /https?:\/\/[^\s)]+/giu).map(canonicalUrl)
    );
    if (
        [...originalUrls].some((url) => !rewrittenUrls.has(url)) ||
        [...rewrittenUrls].some((url) => !originalUrls.has(url))
    )
        return false;
    // The independent validator now owns semantic equivalence. Mechanical
    // checks only reject malformed no-ops and newly introduced destinations,
    // which avoids blocking legitimate persona-level rephrasing.
    return true;
};

const restrainedMarkers = [
    /\b(?:very|really|extremely|absolutely|definitely|clearly|obviously|undeniably)\b/giu,
    /\b(?:at the end of the day|game changer|low-hanging fruit|hit the ground running|piece of cake|on the same page)\b/giu,
    /!+/gu,
    /(?:\*{1,3}|_{1,3})[^\s*_][^*_]*?(?:\*{1,3}|_{1,3})/gu,
];

const sentencePrefixes = (text: string): string[] =>
    (text.match(/[^.!?]+[.!?]+|[^.!?]+$/gu) ?? []).map((sentence) =>
        (sentence.toLocaleLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [])
            .slice(0, 3)
            .join(' ')
    );

const hasNewMarker = (original: string, rewritten: string, marker: RegExp) => {
    const originals = new Set(
        occurrences(original, marker).map((value) => value.toLocaleLowerCase())
    );
    return occurrences(rewritten, marker).some(
        (value) => !originals.has(value.toLocaleLowerCase())
    );
};

/**
 * Restrained mode rejects visible presentation escalation before the semantic
 * validator runs. These checks are conservative signals, not a proof that a
 * candidate is semantically safe.
 */
export const passesRestrainedStyleRewriteChecks = (
    original: string,
    rewritten: string
): boolean => {
    if (rewritten.length / Math.max(1, original.length) > 1.1) return false;
    if (
        restrainedMarkers.some((marker) =>
            hasNewMarker(original, rewritten, marker)
        )
    )
        return false;
    const originalPrefixes = sentencePrefixes(original);
    const rewrittenPrefixes = sentencePrefixes(rewritten);
    return (
        originalPrefixes.length === rewrittenPrefixes.length &&
        originalPrefixes.every(
            (prefix, index) => prefix === rewrittenPrefixes[index]
        )
    );
};

const parseSemanticVerdict = (text: string): SemanticVerdict | null => {
    try {
        const trimmed = text.trim();
        const directVerdict = trimmed
            .match(/^(equivalent|drift|uncertain)[.!]?$/iu)?.[1]
            ?.toLowerCase();
        if (
            directVerdict === 'equivalent' ||
            directVerdict === 'drift' ||
            directVerdict === 'uncertain'
        )
            return directVerdict;
        // Some compliant text models wrap an otherwise valid JSON verdict in a
        // single Markdown fence. Accept only that exact wrapper; surrounding
        // prose remains invalid so the validator cannot smuggle in ambiguity.
        const fencedJson = trimmed.match(/^```json\s*\n([\s\S]*?)\n?```$/iu);
        const parsed: unknown = JSON.parse((fencedJson?.[1] ?? trimmed).trim());
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return null;
        const value = parsed as { verdict?: unknown; reasons?: unknown };
        if (
            (value.verdict === 'equivalent' ||
                value.verdict === 'drift' ||
                value.verdict === 'uncertain') &&
            (value.reasons === undefined ||
                (Array.isArray(value.reasons) &&
                    value.reasons.length <= 5 &&
                    value.reasons.every(
                        (reason) =>
                            typeof reason === 'string' && reason.length <= 80
                    )))
        )
            return value.verdict;
    } catch {
        // Invalid validator output is uncertain evidence and rejects the rewrite.
    }
    return null;
};

const metadata = (input: {
    outcome: StyleRewriteMetadata['outcome'];
    attempted: boolean;
    reasonCode: StyleRewriteReasonCode;
    persona: StyleRewritePersona;
    config: StyleRewriteConfig;
    original: string;
    presented: string;
    rewriteResult?: GenerationResult;
    validatorResult?: GenerationResult;
    validatorOutcome?: SemanticVerdict | 'unavailable';
    startedAt?: number;
    caution?: number;
}): StyleRewriteMetadata => {
    const originalHmacId = hmacIdentifier(
        input.config.traceHmacSecret,
        input.original,
        'original'
    );
    const presentedHmacId = hmacIdentifier(
        input.config.traceHmacSecret,
        input.presented,
        'presented'
    );
    return {
        step: 'style_rewrite',
        outcome: input.outcome,
        attempted: input.attempted,
        reasonCode: input.reasonCode,
        personaId: input.persona.id,
        profileId: input.config.profile?.id,
        requestedProvider: input.config.profile?.provider,
        requestedModel: input.config.profile?.providerModel,
        provider: input.config.profile?.provider,
        model:
            input.rewriteResult?.model ?? input.config.profile?.providerModel,
        validatorProfileId: input.config.validatorProfile?.id,
        validatorProvider: input.config.validatorProfile?.provider,
        validatorModel:
            input.validatorResult?.model ??
            input.config.validatorProfile?.providerModel,
        validatorOutcome: input.validatorOutcome ?? 'not_attempted',
        ...(input.rewriteResult?.upstreamAttribution?.inferenceProvider !==
            undefined && {
            upstreamInferenceProvider:
                input.rewriteResult.upstreamAttribution.inferenceProvider,
        }),
        ...(input.rewriteResult?.upstreamAttribution?.resolvedModel !==
            undefined && {
            upstreamResolvedModel:
                input.rewriteResult.upstreamAttribution.resolvedModel,
        }),
        ...(input.rewriteResult?.upstreamAttribution?.routingAttempt !==
            undefined && {
            upstreamRoutingAttempt:
                input.rewriteResult.upstreamAttribution.routingAttempt,
        }),
        ...(input.rewriteResult?.upstreamAttribution?.routingAttemptCount !==
            undefined && {
            upstreamRoutingAttemptCount:
                input.rewriteResult.upstreamAttribution.routingAttemptCount,
        }),
        ...(input.rewriteResult?.upstreamAttribution
            ?.upstreamReportedCostUsd !== undefined && {
            upstreamReportedCostUsd:
                input.rewriteResult.upstreamAttribution.upstreamReportedCostUsd,
        }),
        ...(originalHmacId !== undefined && { originalHmacId }),
        ...(presentedHmacId !== undefined && { presentedHmacId }),
        editRatio: Number(
            wordEditRatio(input.original, input.presented).toFixed(4)
        ),
        ...(input.caution !== undefined && {
            caution: input.caution as 1 | 2 | 3 | 4 | 5,
        }),
        intensity: resolveStyleRewriteIntensity(input.caution),
        traceConstrained: input.caution === undefined || input.caution >= 4,
        ...(input.startedAt !== undefined && {
            durationMs: Math.max(0, Date.now() - input.startedAt),
        }),
    };
};

/** Builds a fail-open skip record when workflow policy prevents a model call. */
export const createStyleRewriteSkipResult = (input: {
    original: GenerationResult;
    config: StyleRewriteConfig;
    persona: StyleRewritePersona;
    reasonCode: StyleRewriteReasonCode;
    caution?: number;
}): StyleRewriteResult => ({
    text: input.original.text,
    metadata: metadata({
        outcome: 'skipped',
        attempted: false,
        reasonCode: input.reasonCode,
        persona: input.persona,
        config: input.config,
        original: input.original.text,
        presented: input.original.text,
        caution: input.caution,
    }),
});

/**
 * Both model calls are text-only. The validator can only veto; an unavailable,
 * malformed, drift, or uncertain verdict always returns the main answer.
 */
export const runStyleRewriteStep = async (input: {
    original: GenerationResult;
    generationRuntime: GenerationRuntime;
    config: StyleRewriteConfig;
    persona: StyleRewritePersona;
    eligibility: StyleRewriteEligibility;
    caution?: number;
}): Promise<StyleRewriteResult> => {
    const original = input.original.text;
    const base = (
        outcome: StyleRewriteMetadata['outcome'],
        attempted: boolean,
        reasonCode: StyleRewriteReasonCode
    ): StyleRewriteResult => ({
        text: original,
        metadata: metadata({
            outcome,
            attempted,
            reasonCode,
            persona: input.persona,
            config: input.config,
            original,
            presented: original,
            caution: input.caution,
        }),
    });
    if (!input.config.enabled) return base('skipped', false, 'disabled');
    if (resolveStyleRewriteIntensity(input.caution) === 'skipped')
        return base('skipped', false, 'trace_caution_high');
    if (
        !input.config.profile ||
        !input.config.profileId ||
        !input.config.validatorProfile ||
        !input.config.validatorProfileId
    )
        return base('skipped', false, 'profile_not_configured');
    if (input.eligibility.protectedContent)
        return base('skipped', false, 'protected_content');
    if (!isPlainProse(original))
        return base('skipped', false, 'structured_output');
    const startedAt = Date.now();
    let rewriteResult: GenerationResult;
    try {
        rewriteResult = await withTimeout(
            input.config.timeoutMs,
            (signal) =>
                input.generationRuntime.generate({
                    model: input.config.profile?.providerModel,
                    provider: input.config.profile?.provider,
                    capabilities: input.config.profile?.capabilities,
                    providerRouting: input.config.profile?.providerRouting,
                    signal,
                    messages: [
                        {
                            role: 'system',
                            content: `Rewrite expression only. Preserve every fact, uncertainty, attribution, scope, safety/refusal decision, citation, link, code, and structured value. Do not use tools. Return only ordinary prose. ${resolveStyleRewriteIntensity(input.caution) === 'restrained' ? 'Use restrained edits only: small lexical or cadence changes. Do not add wit, idioms, emphasis, sentence reordering, or material expansion.' : 'Keep changes conservative.'}\n\nPresentation guidance:\n${input.persona.presentationGuidance}`,
                        },
                        { role: 'user', content: original },
                    ],
                }),
            'style_rewrite_timeout'
        );
    } catch (error) {
        const reasonCode =
            error instanceof Error && error.message === 'style_rewrite_timeout'
                ? 'timeout'
                : 'provider_error';
        return {
            text: original,
            metadata: metadata({
                outcome: 'failed',
                attempted: true,
                reasonCode,
                persona: input.persona,
                config: input.config,
                original,
                presented: original,
                startedAt,
                caution: input.caution,
            }),
        };
    }
    const rewritten = rewriteResult.text.trim();
    if (
        !isPlainProse(rewritten) ||
        !passesStyleRewriteMechanicalChecks(original, rewritten)
    ) {
        return {
            text: original,
            rewriteResult,
            metadata: metadata({
                outcome: 'rejected',
                attempted: true,
                reasonCode: 'mechanical_preservation_failed',
                persona: input.persona,
                config: input.config,
                original,
                presented: original,
                rewriteResult,
                startedAt,
                caution: input.caution,
            }),
        };
    }
    let validatorResult: GenerationResult;
    try {
        validatorResult = await withTimeout(
            input.config.validatorTimeoutMs,
            (signal) =>
                input.generationRuntime.generate({
                    model: input.config.validatorProfile?.providerModel,
                    provider: input.config.validatorProfile?.provider,
                    capabilities: input.config.validatorProfile?.capabilities,
                    providerRouting:
                        input.config.validatorProfile?.providerRouting,
                    signal,
                    messages: [
                        {
                            role: 'system',
                            content: `Act only as a contradiction detector for a presentation rewrite. Return exactly one uppercase token: EQUIVALENT, DRIFT, or UNCERTAIN. Do not use JSON, Markdown, reasons, or any other text.

Return DRIFT only when the candidate contradicts or removes an explicit fact, number, name, quotation, uncertainty, attribution, link/citation, requested action or scope, safety boundary, or refusal in the original. Return UNCERTAIN only when you cannot determine whether one of those contradictions exists. Otherwise return EQUIVALENT.

Treat tone, cadence, metaphors, sentence structure, conversational warmth, persona voice, and harmless elaboration as presentation changes, not drift. Do not require matching wording, length, paragraph shape, or exact factual coverage. Resolved presentation intensity: ${resolveStyleRewriteIntensity(input.caution)}.${resolveStyleRewriteIntensity(input.caution) === 'restrained' ? ' In restrained mode, return DRIFT for added emphasis, idiom, sentence reordering, or material expansion.' : ''}`,
                        },
                        {
                            role: 'user',
                            content: `ORIGINAL:\n${original}\n\nCANDIDATE:\n${rewritten}`,
                        },
                    ],
                }),
            'style_rewrite_validator_timeout'
        );
    } catch {
        return {
            text: original,
            rewriteResult,
            metadata: metadata({
                outcome: 'rejected',
                attempted: true,
                reasonCode: 'validator_unavailable',
                persona: input.persona,
                config: input.config,
                original,
                presented: original,
                rewriteResult,
                validatorOutcome: 'unavailable',
                startedAt,
                caution: input.caution,
            }),
        };
    }
    const verdict = parseSemanticVerdict(validatorResult.text);
    if (verdict !== 'equivalent') {
        return {
            text: original,
            rewriteResult,
            validatorResult,
            metadata: metadata({
                outcome: 'rejected',
                attempted: true,
                reasonCode:
                    verdict === null ? 'validator_invalid' : 'semantic_drift',
                persona: input.persona,
                config: input.config,
                original,
                presented: original,
                rewriteResult,
                validatorResult,
                validatorOutcome: verdict ?? 'unavailable',
                startedAt,
                caution: input.caution,
            }),
        };
    }
    if (
        resolveStyleRewriteIntensity(input.caution) === 'restrained' &&
        !passesRestrainedStyleRewriteChecks(original, rewritten)
    ) {
        return {
            text: original,
            rewriteResult,
            validatorResult,
            metadata: metadata({
                outcome: 'rejected',
                attempted: true,
                reasonCode: 'mechanical_preservation_failed',
                persona: input.persona,
                config: input.config,
                original,
                presented: original,
                rewriteResult,
                validatorResult,
                validatorOutcome: verdict,
                startedAt,
                caution: input.caution,
            }),
        };
    }
    return {
        text: rewritten,
        rewriteResult,
        validatorResult,
        metadata: metadata({
            outcome: 'applied',
            attempted: true,
            reasonCode: 'applied',
            persona: input.persona,
            config: input.config,
            original,
            presented: rewritten,
            rewriteResult,
            validatorResult,
            validatorOutcome: verdict,
            startedAt,
            caution: input.caution,
        }),
    };
};
