/**
 * @description: Projects stored trace JSON into a safe, field-level display payload.
 * Invalid optional provenance fields are omitted and named rather than repaired.
 * @footnote-scope: core
 * @footnote-module: TraceDisplayProjection
 * @footnote-risk: high - An unsafe projection could expose malformed or sensitive trace data.
 * @footnote-ethics: high - Partial provenance must be explicit so operators do not mistake missing evidence for complete evidence.
 */
import type {
    PartialResponseTemperament,
    ResponseMetadata,
    TraceAxisScore,
} from '@footnote/contracts/policy';
import type { TraceDisplayMetadata } from '@footnote/contracts/web';
import {
    CitationSchema,
    PresentationMetadataSchema,
    ResponseMetadataSchema,
} from '@footnote/contracts/web/schemas';

const TRACE_AXES = [
    'tightness',
    'rationale',
    'attribution',
    'caution',
    'extent',
] as const;

const OPTIONAL_METADATA_FIELDS = [
    'totalDurationMs',
    'provenanceAssessment',
    'execution',
    'workflow',
    'reviewRuntime',
    'steerabilityControls',
    'evaluator',
    'imageDescriptions',
    'trustGraph',
    'githubContext',
    'projectContext',
    'imageGeneration',
    'presentation',
] as const;

type MetadataField = (typeof OPTIONAL_METADATA_FIELDS)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const isTraceAxisScore = (value: unknown): value is TraceAxisScore =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5;

const projectTraceAxes = (
    value: unknown,
    unavailableFields: string[],
    fieldName: 'trace_target' | 'trace_final'
): PartialResponseTemperament => {
    if (!isRecord(value)) {
        unavailableFields.push(fieldName);
        return {};
    }

    const projected: PartialResponseTemperament = {};
    for (const axis of TRACE_AXES) {
        const axisValue = value[axis];
        if (axisValue === undefined) {
            continue;
        }
        if (isTraceAxisScore(axisValue)) {
            projected[axis] = axisValue;
        } else {
            unavailableFields.push(`${fieldName}.${axis}`);
        }
    }
    return projected;
};

const buildValidationBase = (
    responseId: string,
    target: PartialResponseTemperament,
    final: PartialResponseTemperament
): Record<string, unknown> => ({
    responseId,
    provenance: 'Inferred',
    safetyTier: 'Low',
    tradeoffCount: 0,
    chainHash: '',
    licenseContext: '',
    modelVersion: '',
    staleAfter: '',
    citations: [],
    trace_target: target,
    trace_final: final,
});

const readValidOptionalField = (
    raw: Record<string, unknown>,
    field: MetadataField,
    base: Record<string, unknown>
): unknown => {
    if (raw[field] === undefined) {
        return undefined;
    }
    const parsed = ResponseMetadataSchema.safeParse({
        ...base,
        trace_target: {},
        trace_final: {},
        [field]: raw[field],
    });
    return parsed.success ? parsed.data[field] : undefined;
};

const projectKnownMetadata = (
    raw: Record<string, unknown>,
    unavailableFields: string[]
): Omit<TraceDisplayMetadata, 'displayIntegrity'> | null => {
    const responseId = raw.responseId;
    if (typeof responseId !== 'string' || responseId.trim().length === 0) {
        unavailableFields.push('responseId');
        return null;
    }

    const target = projectTraceAxes(
        raw.trace_target,
        unavailableFields,
        'trace_target'
    );
    const final = projectTraceAxes(
        raw.trace_final,
        unavailableFields,
        'trace_final'
    );
    const validationBase = buildValidationBase(responseId, target, final);

    const requiredCandidate = ResponseMetadataSchema.safeParse({
        ...validationBase,
        trace_target: {},
        trace_final: {},
        responseId: raw.responseId,
        provenance: raw.provenance,
        safetyTier: raw.safetyTier,
        tradeoffCount: raw.tradeoffCount,
        chainHash: raw.chainHash,
        licenseContext: raw.licenseContext,
        modelVersion: raw.modelVersion,
        staleAfter: raw.staleAfter,
    });
    if (!requiredCandidate.success) {
        for (const issue of requiredCandidate.error.issues) {
            const path = issue.path[0];
            if (typeof path === 'string' && !unavailableFields.includes(path)) {
                unavailableFields.push(path);
            }
        }
        return null;
    }

    const rawCitations = raw.citations;
    const citations: ResponseMetadata['citations'] = [];
    if (!Array.isArray(rawCitations)) {
        unavailableFields.push('citations');
    } else {
        rawCitations.forEach((citation, index) => {
            const parsedCitation = CitationSchema.safeParse(citation);
            if (parsedCitation.success) {
                citations.push(parsedCitation.data);
            } else {
                unavailableFields.push(`citations[${index}]`);
            }
        });
    }

    const projected: Record<string, unknown> = {
        responseId: raw.responseId,
        provenance: raw.provenance,
        safetyTier: raw.safetyTier,
        tradeoffCount: raw.tradeoffCount,
        chainHash: raw.chainHash,
        licenseContext: raw.licenseContext,
        modelVersion: raw.modelVersion,
        staleAfter: raw.staleAfter,
        citations,
        trace_target: target,
        trace_final: final,
    };

    for (const field of OPTIONAL_METADATA_FIELDS) {
        const value = readValidOptionalField(raw, field, {
            ...validationBase,
            citations,
        });
        if (value !== undefined) {
            projected[field] = value;
        } else if (raw[field] !== undefined) {
            unavailableFields.push(field);
        }
    }

    if (raw.evidenceScore !== undefined) {
        if (isTraceAxisScore(raw.evidenceScore)) {
            projected.evidenceScore = raw.evidenceScore;
        } else {
            unavailableFields.push('evidenceScore');
        }
    }
    if (raw.freshnessScore !== undefined) {
        if (isTraceAxisScore(raw.freshnessScore)) {
            projected.freshnessScore = raw.freshnessScore;
        } else {
            unavailableFields.push('freshnessScore');
        }
    }
    if (raw.trace_final_reason_code !== undefined) {
        const parsed = ResponseMetadataSchema.safeParse({
            ...validationBase,
            citations,
            trace_target: target,
            trace_final: final,
            trace_final_reason_code: raw.trace_final_reason_code,
        });
        if (parsed.success) {
            projected.trace_final_reason_code = raw.trace_final_reason_code;
        } else {
            unavailableFields.push('trace_final_reason_code');
        }
    }

    return projected as Omit<TraceDisplayMetadata, 'displayIntegrity'>;
};

/**
 * Produces the public trace-read projection without mutating persisted data.
 * A valid record is still normalized through the same allowlist, so unknown
 * stored keys cannot leak prompts, response bodies, secrets, or reasoning.
 */
export const projectTraceMetadataForDisplay = (
    value: unknown,
    responseId: string
):
    | (TraceDisplayMetadata & {
          displayIntegrity: NonNullable<
              TraceDisplayMetadata['displayIntegrity']
          >;
      })
    | null => {
    if (!isRecord(value)) {
        return null;
    }

    const unavailableFields: string[] = [];
    const projected = projectKnownMetadata(value, unavailableFields);
    if (!projected || projected.responseId !== responseId) {
        return null;
    }

    return {
        ...projected,
        displayIntegrity: {
            status: unavailableFields.length > 0 ? 'partial' : 'complete',
            unavailableFields: Array.from(new Set(unavailableFields)),
        },
    };
};

/** Validates the presentation section independently for projection tests. */
export const isDisplayPresentationMetadata = (value: unknown): boolean =>
    PresentationMetadataSchema.safeParse(value).success;
