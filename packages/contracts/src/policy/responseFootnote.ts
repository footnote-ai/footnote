/**
 * @description: Defines the response metadata fields that form Footnote's canonical response footnote.
 * @footnote-scope: interface
 * @footnote-module: ResponseFootnote
 * @footnote-risk: low - This view selects existing metadata without changing runtime behavior.
 * @footnote-ethics: high - A shared inspection boundary helps surfaces present response context consistently.
 */

import type {
    EvaluatorAuthorityLevel,
    GroundingEvidenceStatus,
    ResponseMetadata,
    SafetyAction,
    SafetyTier,
    SteerabilityControls,
    TraceAxisScore,
    TraceFinalizationReasonCode,
    TraceTemperamentAxisKey,
} from './types.js';
import { TRACE_TEMPERAMENT_AXIS_KEYS } from './types.js';
import { summarizeGroundingEvidence } from './workflowReceipt.js';

/**
 * Stable sections for response-footnote surfaces. These name the
 * information a person can inspect; they do not require a particular button,
 * layout, or platform interaction.
 */
export const RESPONSE_FOOTNOTE_SECTIONS = [
    'sources',
    'workflow',
    'controls',
    'details',
] as const;

export type ResponseFootnoteSection =
    (typeof RESPONSE_FOOTNOTE_SECTIONS)[number];

/** Availability of a response-bound artifact or interaction. */
export type ResponseFootnoteArtifactState =
    'available' | 'unknown' | 'stale' | 'unavailable';

/** Stable action names used by response-footnote surface adapters. */
export type ResponseFootnoteActionId =
    'sources' | 'controls' | 'trace' | 'report';

/** Surface-independent action state; actions do not change canonical facts. */
export type ResponseFootnoteActionAvailability = {
    state: ResponseFootnoteArtifactState;
    reason?: string;
};

export type ResponseFootnoteArtifactAvailability = {
    trace: ResponseFootnoteArtifactState;
    report: ResponseFootnoteArtifactState;
};

export type ResponseFootnoteProjectionInput = {
    metadata: ResponseFootnote | null;
    artifacts: ResponseFootnoteArtifactAvailability;
};

export type ResponseFootnoteTraceAxisState =
    'recorded' | 'partial' | 'unavailable';

/** One canonical axis value pair. Renderers use `final` for wheel/bar values. */
export type ResponseFootnoteTraceAxis = {
    key: TraceTemperamentAxisKey;
    label: string;
    description: string;
    target: TraceAxisScore | null;
    final: TraceAxisScore | null;
    state: ResponseFootnoteTraceAxisState;
};

export type ResponseFootnoteSourcesSummary = {
    state: 'recorded' | 'unavailable';
    status: GroundingEvidenceStatus;
    count: number | null;
    label: string;
    explanation: string;
};

export const RESPONSE_FOOTNOTE_SAFETY_LABELS = {
    sensitivity: 'Sensitivity',
    evaluator: 'Evaluator',
    authority: 'Authority',
    decision: 'Decision',
    evaluatorTier: 'Evaluator tier',
} as const;

export type ResponseFootnoteEvaluatorSummary = {
    state: 'recorded' | 'unavailable';
    action: SafetyAction | null;
    authority: EvaluatorAuthorityLevel | null;
    safetyTier: SafetyTier | null;
};

export type ResponseFootnoteSafetySummary = {
    state: 'recorded' | 'partial' | 'unavailable';
    /** ResponseMetadata.safetyTier is the recorded sensitivity level. */
    sensitivityTier: SafetyTier | null;
    /** Evaluator outcome is a separate recorded decision and authority. */
    evaluator: ResponseFootnoteEvaluatorSummary;
};

export type ResponseFootnoteLicenseSummary = {
    state: 'recorded' | 'unavailable';
    value: string | null;
};

export type ResponseFootnoteControlsSummary = {
    state: 'recorded' | 'unavailable';
    value: SteerabilityControls | null;
};

export type ResponseFootnoteRenderProjection = {
    status: 'available' | 'unavailable';
    /** Canonical bounded facts, retained for workflow/details disclosures. */
    facts: ResponseFootnote | null;
    summary: {
        sources: ResponseFootnoteSourcesSummary;
        safety: ResponseFootnoteSafetySummary;
        license: ResponseFootnoteLicenseSummary;
        controls: ResponseFootnoteControlsSummary;
    };
    trace: {
        axes: ResponseFootnoteTraceAxis[];
        state: 'complete' | 'partial' | 'unavailable';
        finalReasonCode: TraceFinalizationReasonCode | null;
    };
    actions: Record<
        ResponseFootnoteActionId,
        ResponseFootnoteActionAvailability
    >;
};

/**
 * The portable, response-level inspection view for a completed Footnote
 * answer. It deliberately reuses `ResponseMetadata` rather than creating a
 * second serialized record. Each surface can disclose the fields it supports
 * through its own interaction model. The shared sections are
 * `sources`, `workflow`, `controls`, and `details`.
 *
 * `steerabilityControls` records controls that influenced this response. It
 * does not describe controls currently available to the user or surface.
 */
export type ResponseFootnote = Pick<
    ResponseMetadata,
    | 'responseId'
    | 'provenance'
    | 'provenanceAssessment'
    | 'citations'
    | 'safetyTier'
    | 'evaluator'
    | 'workflow'
    | 'reviewRuntime'
    | 'execution'
    | 'steerabilityControls'
    | 'licenseContext'
    | 'trace_target'
    | 'trace_final'
    | 'trace_final_reason_code'
    | 'evidenceScore'
    | 'freshnessScore'
>;

export const TRACE_TEMPERAMENT_AXIS_LABELS: Record<
    TraceTemperamentAxisKey,
    string
> = {
    tightness: 'Tightness',
    rationale: 'Rationale',
    attribution: 'Attribution',
    caution: 'Caution',
    extent: 'Extent',
};

/** Shared axis meanings prevent surface-specific TRACE interpretation drift. */
export const TRACE_TEMPERAMENT_AXIS_DESCRIPTIONS: Record<
    TraceTemperamentAxisKey,
    string
> = {
    tightness: 'Efficient use of space and attention.',
    rationale: 'Shows enough of the why.',
    attribution: 'Separates sourced and inferred content.',
    caution: 'Uses caveats and avoids overclaiming.',
    extent: 'Offers breadth and coverage.',
};

const UNAVAILABLE_RESPONSE_REASON = 'Response metadata is unavailable.';
const UNAVAILABLE_CONTROLS_REASON =
    'No controls were recorded for this response.';
const UNKNOWN_TRACE_REASON =
    'Trace availability is not confirmed by the chat response.';
const UNAVAILABLE_REPORT_REASON = 'Reporting is not available on this surface.';

const projectFacts = (metadata: ResponseFootnote): ResponseFootnote => ({
    responseId: metadata.responseId,
    provenance: metadata.provenance,
    citations: metadata.citations,
    safetyTier: metadata.safetyTier,
    licenseContext: metadata.licenseContext,
    trace_target: metadata.trace_target,
    trace_final: metadata.trace_final,
    ...(metadata.provenanceAssessment !== undefined && {
        provenanceAssessment: metadata.provenanceAssessment,
    }),
    ...(metadata.evaluator !== undefined && {
        evaluator: metadata.evaluator,
    }),
    ...(metadata.workflow !== undefined && { workflow: metadata.workflow }),
    ...(metadata.execution !== undefined && {
        execution: metadata.execution,
    }),
    ...(metadata.reviewRuntime !== undefined && {
        reviewRuntime: metadata.reviewRuntime,
    }),
    ...(metadata.steerabilityControls !== undefined && {
        steerabilityControls: metadata.steerabilityControls,
    }),
    ...(metadata.trace_final_reason_code !== undefined && {
        trace_final_reason_code: metadata.trace_final_reason_code,
    }),
    ...(metadata.evidenceScore !== undefined && {
        evidenceScore: metadata.evidenceScore,
    }),
    ...(metadata.freshnessScore !== undefined && {
        freshnessScore: metadata.freshnessScore,
    }),
});

const projectSources = (
    metadata: ResponseFootnote | null
): ResponseFootnoteSourcesSummary => {
    if (!metadata) {
        return {
            state: 'unavailable',
            status: 'not_recorded',
            count: null,
            label: 'Sources unavailable',
            explanation: UNAVAILABLE_RESPONSE_REASON,
        };
    }

    const summary = summarizeGroundingEvidence(metadata);
    return {
        state: 'recorded',
        status: summary.status,
        count: metadata.citations.length,
        label: summary.label,
        explanation: summary.explanation,
    };
};

const projectSafety = (
    metadata: ResponseFootnote | null
): ResponseFootnoteSafetySummary => {
    if (!metadata) {
        return {
            state: 'unavailable',
            sensitivityTier: null,
            evaluator: {
                state: 'unavailable',
                action: null,
                authority: null,
                safetyTier: null,
            },
        };
    }

    return {
        state: metadata.evaluator ? 'recorded' : 'partial',
        sensitivityTier: metadata.safetyTier,
        evaluator: {
            state: metadata.evaluator ? 'recorded' : 'unavailable',
            action: metadata.evaluator?.safetyDecision.action ?? null,
            authority: metadata.evaluator?.authorityLevel ?? null,
            safetyTier: metadata.evaluator?.safetyDecision.safetyTier ?? null,
        },
    };
};

const projectLicense = (
    metadata: ResponseFootnote | null
): ResponseFootnoteLicenseSummary => {
    const value = metadata?.licenseContext.trim() ?? '';
    return {
        state: value.length > 0 ? 'recorded' : 'unavailable',
        value: value.length > 0 ? value : null,
    };
};

const projectControls = (
    metadata: ResponseFootnote | null
): ResponseFootnoteControlsSummary => ({
    state: metadata?.steerabilityControls ? 'recorded' : 'unavailable',
    value: metadata?.steerabilityControls ?? null,
});

const projectTraceAxes = (
    metadata: ResponseFootnote | null
): ResponseFootnoteRenderProjection['trace'] => {
    const axes = TRACE_TEMPERAMENT_AXIS_KEYS.map(
        (key): ResponseFootnoteTraceAxis => {
            const target = metadata?.trace_target[key] ?? null;
            const final = metadata?.trace_final[key] ?? null;
            return {
                key,
                label: TRACE_TEMPERAMENT_AXIS_LABELS[key],
                description: TRACE_TEMPERAMENT_AXIS_DESCRIPTIONS[key],
                target,
                final,
                state:
                    final !== null
                        ? 'recorded'
                        : target !== null
                          ? 'partial'
                          : 'unavailable',
            };
        }
    );
    const recordedCount = axes.filter(
        (axis) => axis.state === 'recorded'
    ).length;
    const presentCount = axes.filter(
        (axis) => axis.state !== 'unavailable'
    ).length;

    return {
        axes,
        state:
            metadata === null || presentCount === 0
                ? 'unavailable'
                : recordedCount === axes.length
                  ? 'complete'
                  : 'partial',
        finalReasonCode: metadata?.trace_final_reason_code ?? null,
    };
};

const projectActions = (
    metadata: ResponseFootnote | null,
    artifacts: ResponseFootnoteArtifactAvailability
): ResponseFootnoteRenderProjection['actions'] => {
    const hasResponseIdentity = Boolean(metadata?.responseId.trim());

    return {
        sources: metadata
            ? { state: 'available' }
            : { state: 'unavailable', reason: UNAVAILABLE_RESPONSE_REASON },
        controls: metadata?.steerabilityControls
            ? { state: 'available' }
            : { state: 'unavailable', reason: UNAVAILABLE_CONTROLS_REASON },
        trace: !hasResponseIdentity
            ? { state: 'unavailable', reason: UNAVAILABLE_RESPONSE_REASON }
            : artifacts.trace === 'unknown'
              ? { state: 'unknown', reason: UNKNOWN_TRACE_REASON }
              : { state: artifacts.trace },
        report: !hasResponseIdentity
            ? { state: 'unavailable', reason: UNAVAILABLE_RESPONSE_REASON }
            : artifacts.report === 'unavailable'
              ? { state: 'unavailable', reason: UNAVAILABLE_REPORT_REASON }
              : { state: artifacts.report },
    };
};

/**
 * Projects canonical response metadata into shared surface semantics.
 * This does not calculate provenance or authority; it preserves recorded
 * facts, derives only presentation-safe summaries, and keeps artifact actions
 * separate so prepared or storage-racing responses cannot claim availability.
 */
export const projectResponseFootnote = ({
    metadata,
    artifacts,
}: ResponseFootnoteProjectionInput): ResponseFootnoteRenderProjection => ({
    status: metadata ? 'available' : 'unavailable',
    facts: metadata ? projectFacts(metadata) : null,
    summary: {
        sources: projectSources(metadata),
        safety: projectSafety(metadata),
        license: projectLicense(metadata),
        controls: projectControls(metadata),
    },
    trace: projectTraceAxes(metadata),
    actions: projectActions(metadata, artifacts),
});
