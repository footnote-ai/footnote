/**
 * @description: Defines review-decision parsing and normalization for reviewed
 * workflow assess outputs.
 * @footnote-scope: core
 * @footnote-module: WorkflowEngineReviewDecision
 * @footnote-risk: medium - Invalid parsing can trigger incorrect fail-open behavior.
 * @footnote-ethics: high - Assess decisions control bounded revision/finalize paths.
 */
import type {
    PartialResponseTemperament,
    TraceAxisScore,
} from '@footnote/contracts/policy';
import type { GenerationStructuredOutput } from '@footnote/agent-runtime';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import { sanitizeReviewModuleIds } from '../reviewModules.js';

export type ReviewDecision = {
    reviewDecision: 'finalize' | 'revise';
    reviewReason: string;
    revisionInstruction?: string;
    traceAlignment?: 'aligned' | 'misaligned';
    traceAlignmentReason?: string;
    finalTemperament?: PartialResponseTemperament;
    moduleHints?: string[];
    concerns?: {
        length?: 'too_long' | 'ok';
        style?: 'too_stiff' | 'ok';
        evidence?: 'needs_caution' | 'ok';
    };
    routingHints?: string[];
};

export type ReviewDecisionParseFailureReason =
    'empty_output' | 'non_json_object' | 'invalid_json' | 'schema_invalid';

export type ReviewDecisionParseFailure = {
    reason: ReviewDecisionParseFailureReason;
    message: string;
    outputLength: number;
    issueCount?: number;
    firstIssuePath?: string;
    firstIssueCode?: string;
};

export type ReviewDecisionParseResult = Result<
    ReviewDecision,
    ReviewDecisionParseFailure
>;

export const DEFAULT_REVIEW_DECISION_PROMPT = `Return plain JSON only.
Schema:
{
  "reviewDecision": "finalize" | "revise",
  "reviewReason": "one short sentence",
  "revisionInstruction": "required when reviewDecision is revise",
  "traceAlignment": "aligned" | "misaligned",
  "traceAlignmentReason": "required when traceAlignment is misaligned",
  "finalTemperament": {
    "tightness": 1 | 2 | 3 | 4 | 5,
    "rationale": 1 | 2 | 3 | 4 | 5,
    "attribution": 1 | 2 | 3 | 4 | 5,
    "caution": 1 | 2 | 3 | 4 | 5,
    "extent": 1 | 2 | 3 | 4 | 5
  },
  "moduleHints": ["optional review module ids"],
  "concerns": {
    "length": "too_long" | "ok",
    "style": "too_stiff" | "ok",
    "evidence": "needs_caution" | "ok"
  },
  "routingHints": [
    "optional routing hints from: style.ai_speak_down | style.creativity_up | logic.precision_up | grounding.citation_strict | cost.cheaper_path"
  ]
}
Choose "finalize" when the draft is complete, accurate, and ready.
Choose "revise" only when one additional revision would materially improve quality.
Provide concise fields and keep revisionInstruction specific and short.
Do not include markdown or extra keys.`;

export const DEFAULT_REVISION_PROMPT_PREFIX =
    'Revise the prior draft using the review guidance while preserving factual grounding and provenance boundaries.';

const TraceAxisScoreSchema: z.ZodType<TraceAxisScore> = z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
]);

const PartialResponseTemperamentSchema = z
    .object({
        tightness: TraceAxisScoreSchema.nullable().optional(),
        rationale: TraceAxisScoreSchema.nullable().optional(),
        attribution: TraceAxisScoreSchema.nullable().optional(),
        caution: TraceAxisScoreSchema.nullable().optional(),
        extent: TraceAxisScoreSchema.nullable().optional(),
    })
    .strict();

const ReviewDecisionSchema = z
    .object({
        reviewDecision: z.enum(['finalize', 'revise']),
        reviewReason: z.string().refine((value) => value.trim().length > 0, {
            message: 'reviewReason must be non-empty after trimming.',
        }),
        revisionInstruction: z.string().nullable().optional(),
        traceAlignment: z.enum(['aligned', 'misaligned']).nullable().optional(),
        traceAlignmentReason: z.string().nullable().optional(),
        finalTemperament:
            PartialResponseTemperamentSchema.nullable().optional(),
        moduleHints: z.array(z.string()).nullable().optional(),
        concerns: z
            .object({
                length: z.enum(['too_long', 'ok']).nullable().optional(),
                style: z.enum(['too_stiff', 'ok']).nullable().optional(),
                evidence: z.enum(['needs_caution', 'ok']).nullable().optional(),
            })
            .strict()
            .nullable()
            .optional(),
        routingHints: z.array(z.string()).nullable().optional(),
    })
    .passthrough()
    .superRefine((value, context) => {
        const normalizedRevisionInstruction = value.revisionInstruction?.trim();
        if (
            value.reviewDecision === 'revise' &&
            (!normalizedRevisionInstruction ||
                normalizedRevisionInstruction.length === 0)
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['revisionInstruction'],
                message:
                    'revisionInstruction is required when reviewDecision is "revise".',
            });
        }

        const normalizedTraceAlignmentReason =
            value.traceAlignmentReason?.trim();
        const hasFinalTemperamentAxes =
            value.finalTemperament !== undefined &&
            value.finalTemperament !== null &&
            Object.keys(value.finalTemperament).length > 0;
        if (value.traceAlignment === 'misaligned') {
            if (
                !normalizedTraceAlignmentReason ||
                normalizedTraceAlignmentReason.length === 0
            ) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['traceAlignmentReason'],
                    message:
                        'traceAlignmentReason is required when traceAlignment is "misaligned".',
                });
            }
            if (!hasFinalTemperamentAxes) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['finalTemperament'],
                    message:
                        'finalTemperament must include at least one axis when traceAlignment is "misaligned".',
                });
            }
        }
    });

/** Native schema request for reviewers; the parser remains the final authority. */
export const REVIEW_DECISION_STRUCTURED_OUTPUT: GenerationStructuredOutput = {
    name: 'review_decision',
    description:
        'A bounded decision about whether a draft is final or needs revision.',
    schema: {
        type: 'object',
        properties: {
            reviewDecision: { type: 'string', enum: ['finalize', 'revise'] },
            reviewReason: { type: 'string' },
            revisionInstruction: { type: ['string', 'null'] },
            traceAlignment: {
                type: ['string', 'null'],
                enum: ['aligned', 'misaligned', null],
            },
            traceAlignmentReason: { type: ['string', 'null'] },
            finalTemperament: {
                type: ['object', 'null'],
                properties: {
                    tightness: {
                        type: ['integer', 'null'],
                        minimum: 1,
                        maximum: 5,
                    },
                    rationale: {
                        type: ['integer', 'null'],
                        minimum: 1,
                        maximum: 5,
                    },
                    attribution: {
                        type: ['integer', 'null'],
                        minimum: 1,
                        maximum: 5,
                    },
                    caution: {
                        type: ['integer', 'null'],
                        minimum: 1,
                        maximum: 5,
                    },
                    extent: {
                        type: ['integer', 'null'],
                        minimum: 1,
                        maximum: 5,
                    },
                },
                required: [
                    'tightness',
                    'rationale',
                    'attribution',
                    'caution',
                    'extent',
                ],
                additionalProperties: false,
            },
            moduleHints: {
                type: ['array', 'null'],
                items: { type: 'string' },
            },
            concerns: {
                type: ['object', 'null'],
                properties: {
                    length: {
                        type: ['string', 'null'],
                        enum: ['too_long', 'ok', null],
                    },
                    style: {
                        type: ['string', 'null'],
                        enum: ['too_stiff', 'ok', null],
                    },
                    evidence: {
                        type: ['string', 'null'],
                        enum: ['needs_caution', 'ok', null],
                    },
                },
                required: ['length', 'style', 'evidence'],
                additionalProperties: false,
            },
            routingHints: {
                type: ['array', 'null'],
                items: { type: 'string' },
            },
        },
        required: [
            'reviewDecision',
            'reviewReason',
            'revisionInstruction',
            'traceAlignment',
            'traceAlignmentReason',
            'finalTemperament',
            'moduleHints',
            'concerns',
            'routingHints',
        ],
        additionalProperties: false,
    },
};

const normalizeReviewDecision = (
    parsedDecision: z.infer<typeof ReviewDecisionSchema>
): ReviewDecision => {
    const normalizedRevisionInstruction =
        parsedDecision.revisionInstruction?.trim();
    const moduleHints = parsedDecision.moduleHints
        ? sanitizeReviewModuleIds(parsedDecision.moduleHints)
        : undefined;
    const normalizedFinalTemperament: PartialResponseTemperament = {
        ...(parsedDecision.finalTemperament?.tightness !== undefined &&
            parsedDecision.finalTemperament.tightness !== null && {
                tightness: parsedDecision.finalTemperament.tightness,
            }),
        ...(parsedDecision.finalTemperament?.rationale !== undefined &&
            parsedDecision.finalTemperament.rationale !== null && {
                rationale: parsedDecision.finalTemperament.rationale,
            }),
        ...(parsedDecision.finalTemperament?.attribution !== undefined &&
            parsedDecision.finalTemperament.attribution !== null && {
                attribution: parsedDecision.finalTemperament.attribution,
            }),
        ...(parsedDecision.finalTemperament?.caution !== undefined &&
            parsedDecision.finalTemperament.caution !== null && {
                caution: parsedDecision.finalTemperament.caution,
            }),
        ...(parsedDecision.finalTemperament?.extent !== undefined &&
            parsedDecision.finalTemperament.extent !== null && {
                extent: parsedDecision.finalTemperament.extent,
            }),
    };
    const normalizedConcerns: NonNullable<ReviewDecision['concerns']> = {
        ...(parsedDecision.concerns?.length !== undefined &&
            parsedDecision.concerns.length !== null && {
                length: parsedDecision.concerns.length,
            }),
        ...(parsedDecision.concerns?.style !== undefined &&
            parsedDecision.concerns.style !== null && {
                style: parsedDecision.concerns.style,
            }),
        ...(parsedDecision.concerns?.evidence !== undefined &&
            parsedDecision.concerns.evidence !== null && {
                evidence: parsedDecision.concerns.evidence,
            }),
    };

    return {
        reviewDecision: parsedDecision.reviewDecision,
        reviewReason: parsedDecision.reviewReason.trim(),
        ...(normalizedRevisionInstruction !== undefined && {
            revisionInstruction: normalizedRevisionInstruction,
        }),
        ...(parsedDecision.traceAlignment !== undefined &&
            parsedDecision.traceAlignment !== null && {
                traceAlignment: parsedDecision.traceAlignment,
            }),
        ...(parsedDecision.traceAlignmentReason !== undefined &&
            parsedDecision.traceAlignmentReason !== null && {
                traceAlignmentReason:
                    parsedDecision.traceAlignmentReason.trim(),
            }),
        ...(Object.keys(normalizedFinalTemperament).length > 0 && {
            finalTemperament: normalizedFinalTemperament,
        }),
        ...(moduleHints !== undefined && { moduleHints }),
        ...(Object.keys(normalizedConcerns).length > 0 && {
            concerns: normalizedConcerns,
        }),
        ...(parsedDecision.routingHints !== undefined &&
            parsedDecision.routingHints !== null && {
                routingHints: parsedDecision.routingHints,
            }),
    };
};

export const parseReviewDecisionOutputResult = (
    text: string
): ReviewDecisionParseResult => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return err({
            reason: 'empty_output',
            message: 'Review decision output was empty.',
            outputLength: text.length,
        });
    }

    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
        return err({
            reason: 'non_json_object',
            message: 'Review decision output must be a JSON object.',
            outputLength: text.length,
        });
    }

    try {
        const parsedPayload = JSON.parse(trimmed) as unknown;
        const parsedDecision = ReviewDecisionSchema.safeParse(parsedPayload);
        if (!parsedDecision.success) {
            const firstIssue = parsedDecision.error.issues.at(0);
            const firstIssuePath = firstIssue?.path
                .map((pathSegment) => String(pathSegment))
                .join('.');
            return err({
                reason: 'schema_invalid',
                message:
                    firstIssue?.message ??
                    'Review decision output did not match the required schema.',
                outputLength: text.length,
                issueCount: parsedDecision.error.issues.length,
                ...(firstIssuePath !== undefined &&
                    firstIssuePath.length > 0 && {
                        firstIssuePath,
                    }),
                ...(firstIssue?.code !== undefined && {
                    firstIssueCode: firstIssue.code,
                }),
            });
        }

        return ok(normalizeReviewDecision(parsedDecision.data));
    } catch {
        return err({
            reason: 'invalid_json',
            message: 'Review decision output was not valid JSON.',
            outputLength: text.length,
        });
    }
};

export const parseReviewDecisionOutput = (
    text: string
): ReviewDecision | null => {
    const result = parseReviewDecisionOutputResult(text);
    return result.isOk() ? result.value : null;
};
