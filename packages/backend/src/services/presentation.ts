/**
 * @description: Runs the bounded draft-first presentation flow and audit-guided finalization.
 * @footnote-scope: core
 * @footnote-module: Presentation
 * @footnote-risk: high - Presentation text reaches users, so finalization and safety remain authoritative.
 * @footnote-ethics: high - The style model owns voice while the main model retains factual and safety authority.
 */
import type {
    GenerationRequest,
    GenerationResult,
    GenerationRuntime,
    GenerationStructuredOutput,
    RuntimeMessage,
} from '@footnote/agent-runtime';
import type {
    ModelProfile,
    PersonaExpressionSource,
    PersonaExpressionStrength,
    TraceAxisScore,
} from '@footnote/contracts';
import type {
    PresentationMetadata,
    PresentationReasonCode,
} from '@footnote/contracts/policy';
import { hmacId } from '../utils/pseudonymization.js';

export type PresentationConfig = {
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

export type PresentationPersona = {
    id: string;
    presentationGuidance: string;
    expressionStrength: PersonaExpressionStrength;
    expressionSource: PersonaExpressionSource;
    expressionGuidance: string;
};

type PresentationCaution = TraceAxisScore | undefined;
type PresentationDraftAttemptCount = 0 | 1;
type PresentationFinalizerAttemptCount = 0 | 1 | 2;
type PresentationAuditAttemptCount = 0 | 1;

type PresentationAuditVerdict =
    'clear' | 'evidence_issue' | 'presentation_flattened';

type PresentationAudit = {
    verdict: PresentationAuditVerdict;
    feedback: string;
};

const PRESENTATION_AUDIT_STRUCTURED_OUTPUT: GenerationStructuredOutput = {
    name: 'presentation_audit',
    description: 'Bounded audit of a finalized presentation response.',
    schema: {
        type: 'object',
        properties: {
            verdict: {
                type: 'string',
                enum: ['clear', 'evidence_issue', 'presentation_flattened'],
            },
            feedback: { type: 'string', maxLength: 320 },
        },
        required: ['verdict', 'feedback'],
        additionalProperties: false,
    },
};

export type PresentationResult = {
    /** A normal main-model generation is required when no safe final is available. */
    outcome: 'finalized' | 'fallback';
    text?: string;
    draftResult?: GenerationResult;
    finalizerResults: GenerationResult[];
    auditResult?: GenerationResult;
    metadata: PresentationMetadata;
};

const hmacIdentifier = (
    secret: string | null | undefined,
    text: string,
    kind: 'draft' | 'final'
): string | undefined =>
    secret?.trim()
        ? hmacId(secret, text, `presentation:v1:${kind}`)
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

const isOrdinaryProse = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.includes('```')) return false;
    try {
        JSON.parse(trimmed);
        return false;
    } catch {
        // Ordinary prose can contain citations, labels, and markdown lists.
    }
    if (
        /^(?:i (?:can't|cannot)|unable to|cannot assist|i must refuse)\b/iu.test(
            trimmed
        )
    )
        return false;
    return true;
};

const occurrences = (text: string, expression: RegExp): string[] =>
    Array.from(text.matchAll(expression), (match) => match[0]);

const canonicalUrl = (url: string): string => {
    const trimmed = url.replace(/[.,!?;:]+$/u, '');
    const parts = trimmed.match(/^(https?):\/\/([^/?#]+)(.*)$/iu);
    return parts
        ? `${parts[1].toLowerCase()}://${parts[2].toLowerCase()}${parts[3]}`
        : trimmed;
};

/** Keeps the finalizer from silently dropping or inventing literal destinations. */
export const preservesPresentationUrls = (
    styledDraft: string,
    finalized: string
): boolean => {
    const draftUrls = new Set(
        occurrences(styledDraft, /https?:\/\/[^\s)]+/giu).map(canonicalUrl)
    );
    const finalUrls = new Set(
        occurrences(finalized, /https?:\/\/[^\s)]+/giu).map(canonicalUrl)
    );
    return (
        [...draftUrls].every((url) => finalUrls.has(url)) &&
        [...finalUrls].every((url) => draftUrls.has(url))
    );
};

const wordRetentionRatio = (styledDraft: string, finalized: string): number => {
    const draftWords =
        styledDraft.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
    const finalWords = finalized.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
    const finalSet = new Set(finalWords);
    const retained = draftWords.filter((word) => finalSet.has(word)).length;
    return Number((retained / Math.max(draftWords.length, 1)).toFixed(4));
};

const parseAudit = (text: string): PresentationAudit | null => {
    try {
        const parsed: unknown = JSON.parse(text.trim());
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        const value = parsed as { verdict?: unknown; feedback?: unknown };
        if (
            (value.verdict === 'clear' ||
                value.verdict === 'evidence_issue' ||
                value.verdict === 'presentation_flattened') &&
            typeof value.feedback === 'string' &&
            value.feedback.trim().length <= 320
        ) {
            return { verdict: value.verdict, feedback: value.feedback.trim() };
        }
    } catch {
        // Audit output is advisory. A malformed answer is recorded, not a veto.
    }
    return null;
};

const buildMetadata = (input: {
    outcome: PresentationMetadata['outcome'];
    attempted: boolean;
    reasonCode: PresentationReasonCode;
    persona: PresentationPersona;
    config: PresentationConfig;
    draft?: GenerationResult;
    finalText?: string;
    audit?: PresentationAudit;
    auditResult?: GenerationResult;
    auditFailureCategory?: PresentationMetadata['auditFailureCategory'];
    draftAttemptCount: PresentationDraftAttemptCount;
    finalizerAttemptCount: PresentationFinalizerAttemptCount;
    auditAttemptCount: PresentationAuditAttemptCount;
    startedAt?: number;
    caution?: PresentationCaution;
}): PresentationMetadata => {
    const draftText = input.draft?.text;
    const draftHmacId =
        draftText === undefined
            ? undefined
            : hmacIdentifier(input.config.traceHmacSecret, draftText, 'draft');
    const finalHmacId =
        input.finalText === undefined
            ? undefined
            : hmacIdentifier(
                  input.config.traceHmacSecret,
                  input.finalText,
                  'final'
              );
    return {
        step: 'presentation',
        outcome: input.outcome,
        attempted: input.attempted,
        reasonCode: input.reasonCode,
        personaId: input.persona.id,
        draftProfileId: input.config.profile?.id,
        draftRequestedProvider: input.config.profile?.provider,
        draftRequestedModel: input.config.profile?.providerModel,
        ...(input.draft !== undefined && {
            draftObservedProvider:
                input.draft.upstreamAttribution?.inferenceProvider ??
                input.config.profile?.provider,
            ...(input.draft.model !== undefined && {
                draftObservedModel: input.draft.model,
            }),
        }),
        auditProfileId: input.config.validatorProfile?.id,
        auditProvider: input.config.validatorProfile?.provider,
        auditModel:
            input.auditResult?.model ??
            input.config.validatorProfile?.providerModel,
        auditOutcome:
            input.audit?.verdict ??
            (input.auditResult === undefined ? 'not_attempted' : 'invalid'),
        ...(input.auditFailureCategory !== undefined && {
            auditFailureCategory: input.auditFailureCategory,
        }),
        draftAttemptCount: input.draftAttemptCount,
        finalizerAttemptCount: input.finalizerAttemptCount,
        auditAttemptCount: input.auditAttemptCount,
        ...(input.draft?.upstreamAttribution?.inferenceProvider !==
            undefined && {
            upstreamInferenceProvider:
                input.draft.upstreamAttribution.inferenceProvider,
        }),
        ...(input.draft?.upstreamAttribution?.resolvedModel !== undefined && {
            upstreamResolvedModel:
                input.draft.upstreamAttribution.resolvedModel,
        }),
        ...(input.draft?.upstreamAttribution?.routingAttempt !== undefined && {
            upstreamRoutingAttempt:
                input.draft.upstreamAttribution.routingAttempt,
        }),
        ...(input.draft?.upstreamAttribution?.routingAttemptCount !==
            undefined && {
            upstreamRoutingAttemptCount:
                input.draft.upstreamAttribution.routingAttemptCount,
        }),
        ...(input.draft?.upstreamAttribution?.upstreamReportedCostUsd !==
            undefined && {
            upstreamReportedCostUsd:
                input.draft.upstreamAttribution.upstreamReportedCostUsd,
        }),
        ...(draftHmacId !== undefined && { draftHmacId }),
        ...(finalHmacId !== undefined && { finalHmacId }),
        ...(draftText !== undefined &&
            input.finalText !== undefined && {
                styledDraftRetentionRatio: wordRetentionRatio(
                    draftText,
                    input.finalText
                ),
            }),
        ...(input.caution !== undefined && { caution: input.caution }),
        expressionStrength: input.persona.expressionStrength,
        expressionSource: input.persona.expressionSource,
        ...(input.startedAt !== undefined && {
            durationMs: Math.max(0, Date.now() - input.startedAt),
        }),
    };
};

/** Builds a visible fallback receipt without storing prompt or response text. */
export const createPresentationFallback = (input: {
    config: PresentationConfig;
    persona: PresentationPersona;
    reasonCode: PresentationReasonCode;
    caution?: PresentationCaution;
    attempted?: boolean;
    draftAttemptCount?: PresentationDraftAttemptCount;
    finalizerAttemptCount?: PresentationFinalizerAttemptCount;
    auditAttemptCount?: PresentationAuditAttemptCount;
    startedAt?: number;
}): PresentationResult => ({
    outcome: 'fallback',
    finalizerResults: [],
    metadata: buildMetadata({
        outcome: 'fallback',
        attempted: input.attempted ?? false,
        reasonCode: input.reasonCode,
        persona: input.persona,
        config: input.config,
        draftAttemptCount: input.draftAttemptCount ?? 0,
        finalizerAttemptCount: input.finalizerAttemptCount ?? 0,
        auditAttemptCount: input.auditAttemptCount ?? 0,
        ...(input.startedAt !== undefined && { startedAt: input.startedAt }),
        caution: input.caution,
    }),
});

const finalizerSystemPrompt = (
    expressionGuidance: string,
    repairFeedback?: string
): string =>
    `You are the evidence-aware final editor. The styled presentation draft is the prose authority. Preserve its voice, wording, cadence, structure, and citations by default. Make only the smallest changes needed for facts, evidence, uncertainty, attribution, user intent, scope, safety, or refusal behavior. Do not turn it into a plain generic answer. Keep literal URLs, citations, code, and structured values intact. ${expressionGuidance} Return only the final answer.${repairFeedback ? `\n\nAudit feedback requiring one bounded repair:\n${repairFeedback}` : ''}`;

const auditSystemPrompt = (
    expressionGuidance: string,
    caution: PresentationCaution
): string =>
    `Audit a finalized answer against its styled presentation draft and the authoritative context. Return exactly one JSON object with {"verdict":"clear"|"evidence_issue"|"presentation_flattened","feedback":"..."}. Use evidence_issue only for a concrete factual, citation, uncertainty, attribution, scope, user-intent, or safety problem. Use presentation_flattened only when the final answer noticeably discards the styled draft's voice, wording, cadence, or structure without a concrete authority reason. feedback must be a bounded repair instruction of 320 characters or less. Return clear when neither issue exists. Observed TRACE caution: ${caution === undefined ? 'unavailable' : caution}; it may protect answer posture but does not weaken persona expression. ${expressionGuidance}`;

const buildFinalizerRequest = (
    request: GenerationRequest,
    styledDraft: string,
    expressionGuidance: string,
    repairFeedback?: string
): GenerationRequest => ({
    ...request,
    messages: [
        ...request.messages,
        {
            role: 'system',
            content: finalizerSystemPrompt(expressionGuidance, repairFeedback),
        },
        {
            role: 'user',
            content: `STYLED PRESENTATION DRAFT:\n${styledDraft}`,
        },
    ],
});

/**
 * Drafts with the presentation model first, then asks the main model to make
 * the final evidence-aware edit. The audit can request one finalizer retry but
 * never chooses an earlier response to display.
 */
export const runPresentationStep = async (input: {
    generationRuntime: GenerationRuntime;
    generationRequest: GenerationRequest;
    finalize: (
        request: GenerationRequest,
        signal: AbortSignal
    ) => Promise<GenerationResult>;
    config: PresentationConfig;
    persona: PresentationPersona;
    caution?: PresentationCaution;
}): Promise<PresentationResult> => {
    if (!input.config.enabled) {
        return createPresentationFallback({
            config: input.config,
            persona: input.persona,
            reasonCode: 'disabled',
            caution: input.caution,
        });
    }
    if (
        !input.config.profile ||
        !input.config.profileId ||
        !input.config.validatorProfile ||
        !input.config.validatorProfileId
    ) {
        return createPresentationFallback({
            config: input.config,
            persona: input.persona,
            reasonCode: 'profile_not_configured',
            caution: input.caution,
        });
    }

    const startedAt = Date.now();
    let draftAttemptCount: PresentationDraftAttemptCount = 0;
    let finalizerAttemptCount: PresentationFinalizerAttemptCount = 0;
    let auditAttemptCount: PresentationAuditAttemptCount = 0;
    let draftResult: GenerationResult;
    try {
        const draftGenerationRequest: GenerationRequest = {
            ...input.generationRequest,
        };
        // The draft is prose-only. It receives retrieved context but never
        // initiates another provider-native search.
        delete draftGenerationRequest.search;
        draftAttemptCount = 1;
        draftResult = await withTimeout(
            input.config.timeoutMs,
            (signal) =>
                input.generationRuntime.generate({
                    ...draftGenerationRequest,
                    model: input.config.profile?.providerModel,
                    provider: input.config.profile?.provider,
                    capabilities: input.config.profile?.capabilities,
                    providerRouting: input.config.profile?.providerRouting,
                    signal,
                    messages: [
                        {
                            role: 'system',
                            content: `Write the full presentation draft using the authoritative context already supplied. You are the prose authority: use the active persona while keeping facts, uncertainty, attribution, citations, scope, user intent, safety boundaries, URLs, code, and structured values intact. Do not use tools. Return only the response prose. Observed TRACE caution: ${input.caution === undefined ? 'unavailable' : input.caution}; protect answer posture without weakening persona expression. ${input.persona.expressionGuidance}\n\nPresentation guidance:\n${input.persona.presentationGuidance}`,
                        },
                        ...input.generationRequest.messages,
                    ],
                }),
            'presentation_draft_timeout'
        );
    } catch (error) {
        return createPresentationFallback({
            config: input.config,
            persona: input.persona,
            reasonCode:
                error instanceof Error &&
                error.message === 'presentation_draft_timeout'
                    ? 'draft_timeout'
                    : 'draft_provider_error',
            attempted: true,
            draftAttemptCount,
            finalizerAttemptCount,
            auditAttemptCount,
            startedAt,
            caution: input.caution,
        });
    }

    const styledDraft = draftResult.text.trim();
    if (!isOrdinaryProse(styledDraft)) {
        return {
            outcome: 'fallback',
            draftResult,
            finalizerResults: [],
            metadata: buildMetadata({
                outcome: 'fallback',
                attempted: true,
                reasonCode: 'structured_output',
                persona: input.persona,
                config: input.config,
                draft: draftResult,
                draftAttemptCount,
                finalizerAttemptCount,
                auditAttemptCount,
                startedAt,
                caution: input.caution,
            }),
        };
    }

    const finalizerResults: GenerationResult[] = [];
    const finalize = async (
        repairFeedback?: string
    ): Promise<GenerationResult> => {
        finalizerAttemptCount = finalizerAttemptCount === 0 ? 1 : 2;
        const result = await withTimeout(
            input.config.timeoutMs,
            (signal) =>
                input.finalize(
                    buildFinalizerRequest(
                        input.generationRequest,
                        styledDraft,
                        input.persona.expressionGuidance,
                        repairFeedback
                    ),
                    signal
                ),
            'presentation_finalizer_timeout'
        );
        finalizerResults.push(result);
        return result;
    };

    let finalized: GenerationResult;
    try {
        finalized = await finalize();
    } catch (error) {
        return {
            outcome: 'fallback',
            draftResult,
            finalizerResults,
            metadata: buildMetadata({
                outcome: 'fallback',
                attempted: true,
                reasonCode:
                    error instanceof Error &&
                    error.message === 'presentation_finalizer_timeout'
                        ? 'finalizer_timeout'
                        : 'finalizer_provider_error',
                persona: input.persona,
                config: input.config,
                draft: draftResult,
                draftAttemptCount,
                finalizerAttemptCount,
                auditAttemptCount,
                startedAt,
                caution: input.caution,
            }),
        };
    }

    const initialFinal = finalized.text.trim();
    if (
        !isOrdinaryProse(initialFinal) ||
        !preservesPresentationUrls(styledDraft, initialFinal)
    ) {
        return {
            outcome: 'fallback',
            draftResult,
            finalizerResults,
            metadata: buildMetadata({
                outcome: 'fallback',
                attempted: true,
                reasonCode: 'mechanical_preservation_failed',
                persona: input.persona,
                config: input.config,
                draft: draftResult,
                draftAttemptCount,
                finalizerAttemptCount,
                auditAttemptCount,
                startedAt,
                caution: input.caution,
            }),
        };
    }

    let auditResult: GenerationResult;
    try {
        auditAttemptCount = 1;
        auditResult = await withTimeout(
            input.config.validatorTimeoutMs,
            (signal) =>
                input.generationRuntime.generate({
                    model: input.config.validatorProfile?.providerModel,
                    provider: input.config.validatorProfile?.provider,
                    capabilities: input.config.validatorProfile?.capabilities,
                    providerRouting:
                        input.config.validatorProfile?.providerRouting,
                    maxOutputTokens: 160,
                    structuredOutput: PRESENTATION_AUDIT_STRUCTURED_OUTPUT,
                    signal,
                    messages: [
                        {
                            role: 'system',
                            content: auditSystemPrompt(
                                input.persona.expressionGuidance,
                                input.caution
                            ),
                        },
                        ...input.generationRequest.messages,
                        {
                            role: 'user',
                            content: `STYLED PRESENTATION DRAFT:\n${styledDraft}\n\nFINALIZED RESPONSE:\n${initialFinal}`,
                        },
                    ],
                }),
            'presentation_audit_timeout'
        );
    } catch (error) {
        return {
            outcome: 'finalized',
            text: initialFinal,
            draftResult,
            finalizerResults,
            metadata: buildMetadata({
                outcome: 'finalized_with_audit_unavailable',
                attempted: true,
                reasonCode: 'audit_unavailable',
                persona: input.persona,
                config: input.config,
                draft: draftResult,
                finalText: initialFinal,
                auditFailureCategory:
                    error instanceof Error &&
                    error.message === 'presentation_audit_timeout'
                        ? 'timeout'
                        : 'provider_failure',
                draftAttemptCount,
                finalizerAttemptCount,
                auditAttemptCount,
                startedAt,
                caution: input.caution,
            }),
        };
    }

    const audit = parseAudit(auditResult.text);
    if (audit === null) {
        return {
            outcome: 'finalized',
            text: initialFinal,
            draftResult,
            finalizerResults,
            auditResult,
            metadata: buildMetadata({
                outcome: 'finalized_with_audit_unavailable',
                attempted: true,
                reasonCode: 'audit_invalid',
                persona: input.persona,
                config: input.config,
                draft: draftResult,
                finalText: initialFinal,
                auditResult,
                auditFailureCategory: 'invalid_structured_output',
                draftAttemptCount,
                finalizerAttemptCount,
                auditAttemptCount,
                startedAt,
                caution: input.caution,
            }),
        };
    }
    if (audit.verdict === 'clear') {
        return {
            outcome: 'finalized',
            text: initialFinal,
            draftResult,
            finalizerResults,
            auditResult,
            metadata: buildMetadata({
                outcome: 'finalized',
                attempted: true,
                reasonCode: 'finalized',
                persona: input.persona,
                config: input.config,
                draft: draftResult,
                finalText: initialFinal,
                audit,
                auditResult,
                draftAttemptCount,
                finalizerAttemptCount,
                auditAttemptCount,
                startedAt,
                caution: input.caution,
            }),
        };
    }

    try {
        finalized = await finalize(audit.feedback);
    } catch {
        if (audit.verdict === 'evidence_issue') {
            return {
                outcome: 'fallback',
                draftResult,
                finalizerResults,
                auditResult,
                metadata: buildMetadata({
                    outcome: 'fallback',
                    attempted: true,
                    reasonCode: 'evidence_repair_unavailable',
                    persona: input.persona,
                    config: input.config,
                    draft: draftResult,
                    audit,
                    auditResult,
                    draftAttemptCount,
                    finalizerAttemptCount,
                    auditAttemptCount,
                    startedAt,
                    caution: input.caution,
                }),
            };
        }
        return {
            outcome: 'finalized',
            text: initialFinal,
            draftResult,
            finalizerResults,
            auditResult,
            metadata: buildMetadata({
                outcome: 'finalized',
                attempted: true,
                reasonCode: 'presentation_repair_unavailable',
                persona: input.persona,
                config: input.config,
                draft: draftResult,
                finalText: initialFinal,
                audit,
                auditResult,
                draftAttemptCount,
                finalizerAttemptCount,
                auditAttemptCount,
                startedAt,
                caution: input.caution,
            }),
        };
    }

    const repaired = finalized.text.trim();
    if (
        !isOrdinaryProse(repaired) ||
        !preservesPresentationUrls(styledDraft, repaired)
    ) {
        return {
            outcome: 'fallback',
            draftResult,
            finalizerResults,
            auditResult,
            metadata: buildMetadata({
                outcome: 'fallback',
                attempted: true,
                reasonCode: 'mechanical_preservation_failed',
                persona: input.persona,
                config: input.config,
                draft: draftResult,
                audit,
                auditResult,
                draftAttemptCount,
                finalizerAttemptCount,
                auditAttemptCount,
                startedAt,
                caution: input.caution,
            }),
        };
    }

    return {
        outcome: 'finalized',
        text: repaired,
        draftResult,
        finalizerResults,
        auditResult,
        metadata: buildMetadata({
            outcome:
                audit.verdict === 'evidence_issue'
                    ? 'finalized_after_evidence_repair'
                    : 'finalized_after_presentation_repair',
            attempted: true,
            reasonCode:
                audit.verdict === 'evidence_issue'
                    ? 'evidence_repaired'
                    : 'presentation_repaired',
            persona: input.persona,
            config: input.config,
            draft: draftResult,
            finalText: repaired,
            audit,
            auditResult,
            draftAttemptCount,
            finalizerAttemptCount,
            auditAttemptCount,
            startedAt,
            caution: input.caution,
        }),
    };
};

/** Keeps compatibility-free request typing for focused tests and workflow seams. */
export const createPresentationFinalizerMessages = (
    messages: RuntimeMessage[],
    styledDraft: string,
    repairFeedback?: string
): RuntimeMessage[] =>
    buildFinalizerRequest(
        { messages },
        styledDraft,
        'Persona expression strength: balanced. Preserve grounded content and safety decisions.',
        repairFeedback
    ).messages;
