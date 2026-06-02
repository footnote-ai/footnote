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
    | 'empty_output'
    | 'non_json_object'
    | 'invalid_json'
    | 'schema_invalid';

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
        tightness: TraceAxisScoreSchema.optional(),
        rationale: TraceAxisScoreSchema.optional(),
        attribution: TraceAxisScoreSchema.optional(),
        caution: TraceAxisScoreSchema.optional(),
        extent: TraceAxisScoreSchema.optional(),
    })
    .strict();

const ReviewDecisionSchema = z
    .object({
        reviewDecision: z.enum(['finalize', 'revise']),
        reviewReason: z.string().refine((value) => value.trim().length > 0, {
            message: 'reviewReason must be non-empty after trimming.',
        }),
        revisionInstruction: z.string().optional(),
        traceAlignment: z.enum(['aligned', 'misaligned']).optional(),
        traceAlignmentReason: z.string().optional(),
        finalTemperament: PartialResponseTemperamentSchema.optional(),
        moduleHints: z.array(z.string()).optional(),
        concerns: z
            .object({
                length: z.enum(['too_long', 'ok']).optional(),
                style: z.enum(['too_stiff', 'ok']).optional(),
                evidence: z.enum(['needs_caution', 'ok']).optional(),
            })
            .strict()
            .optional(),
        routingHints: z.array(z.string()).optional(),
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

const normalizeReviewDecision = (
    parsedDecision: z.infer<typeof ReviewDecisionSchema>
): ReviewDecision => {
    const normalizedRevisionInstruction =
        parsedDecision.revisionInstruction?.trim();
    const moduleHints = parsedDecision.moduleHints
        ? sanitizeReviewModuleIds(parsedDecision.moduleHints)
        : undefined;
    const normalizedConcerns: NonNullable<ReviewDecision['concerns']> = {
        ...(parsedDecision.concerns?.length !== undefined && {
            length: parsedDecision.concerns.length,
        }),
        ...(parsedDecision.concerns?.style !== undefined && {
            style: parsedDecision.concerns.style,
        }),
        ...(parsedDecision.concerns?.evidence !== undefined && {
            evidence: parsedDecision.concerns.evidence,
        }),
    };

    return {
        reviewDecision: parsedDecision.reviewDecision,
        reviewReason: parsedDecision.reviewReason.trim(),
        ...(normalizedRevisionInstruction !== undefined && {
            revisionInstruction: normalizedRevisionInstruction,
        }),
        ...(parsedDecision.traceAlignment !== undefined && {
            traceAlignment: parsedDecision.traceAlignment,
        }),
        ...(parsedDecision.traceAlignmentReason !== undefined && {
            traceAlignmentReason: parsedDecision.traceAlignmentReason.trim(),
        }),
        ...(parsedDecision.finalTemperament !== undefined && {
            finalTemperament: parsedDecision.finalTemperament,
        }),
        ...(moduleHints !== undefined && { moduleHints }),
        ...(Object.keys(normalizedConcerns).length > 0 && {
            concerns: normalizedConcerns,
        }),
        ...(parsedDecision.routingHints !== undefined && {
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
