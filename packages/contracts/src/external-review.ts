/**
 * @description: Validates a bounded run review record and returns Footnote's provenance assessment.
 * @footnote-scope: interface
 * @footnote-module: ExternalRunReview
 * @footnote-risk: medium - Missing or malformed signals can change the reported classification.
 * @footnote-ethics: high - Host claims stay attributed and private content stays outside the contract.
 */

import { z } from 'zod';
import { classifyProvenanceWithSignals } from './policy/provenanceAssessment.js';
import type { ProvenanceAssessment, Provenance } from './policy/types.js';

const ExternalRunReviewSignalsSchema = z
    .object({
        citationCount: z.number().int().nonnegative().optional(),
        retrievalRequested: z.boolean().optional(),
        retrievalUsed: z.boolean().optional(),
        retrievalToolExecuted: z.boolean().optional(),
        workflowEvidence: z.boolean().optional(),
        trustGraphEvidenceAvailable: z.boolean().optional(),
        trustGraphEvidenceUsed: z.boolean().optional(),
        assistantDeclaredSpeculative: z.boolean().optional(),
    })
    .strict();

export const ExternalRunReviewInputSchema = z
    .object({
        schemaVersion: z.literal('v0alpha'),
        origin: z.enum(['host_reported', 'footnote_observed']),
        signals: ExternalRunReviewSignalsSchema,
    })
    .strict();

export type ExternalRunReviewInput = z.infer<
    typeof ExternalRunReviewInputSchema
>;
export type ExternalRunReviewSignals = ExternalRunReviewInput['signals'];
export type ExternalRunReviewAssessment = Omit<
    ProvenanceAssessment,
    'signals'
> & {
    signals: Partial<ProvenanceAssessment['signals']>;
};

const EXTERNAL_RUN_REVIEW_SIGNAL_NAMES = [
    'citationCount',
    'retrievalRequested',
    'retrievalUsed',
    'retrievalToolExecuted',
    'workflowEvidence',
    'trustGraphEvidenceAvailable',
    'trustGraphEvidenceUsed',
    'assistantDeclaredSpeculative',
] as const satisfies readonly (keyof ExternalRunReviewSignals)[];

export type ExternalRunReviewResult = {
    origin: ExternalRunReviewInput['origin'];
    reportedSignals: ExternalRunReviewSignals;
    missingSignals: Array<keyof ExternalRunReviewSignals>;
    provenance: Provenance;
    assessment: ExternalRunReviewAssessment;
};

/**
 * Validates one run review and classifies only its supplied metadata.
 * Missing signals remain unknown to absence checks in the deterministic
 * classifier and are listed separately from source-reported false facts.
 */
export function reviewExternalRun(input: unknown): ExternalRunReviewResult {
    const record = ExternalRunReviewInputSchema.parse(input);
    const signals = record.signals;
    const missingSignals = EXTERNAL_RUN_REVIEW_SIGNAL_NAMES.filter(
        (signal) => signals[signal] === undefined
    );
    const classification = classifyProvenanceWithSignals({
        citationCount: signals.citationCount,
        retrievalRequested: signals.retrievalRequested,
        retrievalUsed: signals.retrievalUsed,
        retrievalToolExecuted: signals.retrievalToolExecuted,
        workflowEvidence: signals.workflowEvidence,
        trustGraphEvidenceAvailable: signals.trustGraphEvidenceAvailable,
        trustGraphEvidenceUsed: signals.trustGraphEvidenceUsed,
        assistantProvenance:
            signals.assistantDeclaredSpeculative === true
                ? 'Speculative'
                : undefined,
    });
    const assessment: ExternalRunReviewAssessment = {
        ...classification.assessment,
        signals: {
            ...(signals.citationCount !== undefined && {
                citationsPresent: signals.citationCount > 0,
            }),
            ...(signals.retrievalRequested !== undefined && {
                retrievalRequested: signals.retrievalRequested,
            }),
            ...(signals.retrievalUsed !== undefined && {
                retrievalUsed: signals.retrievalUsed,
            }),
            ...(signals.retrievalToolExecuted !== undefined && {
                retrievalToolExecuted: signals.retrievalToolExecuted,
            }),
            ...(signals.workflowEvidence !== undefined && {
                workflowEvidence: signals.workflowEvidence,
            }),
            ...(signals.trustGraphEvidenceAvailable !== undefined && {
                trustGraphEvidenceAvailable:
                    signals.trustGraphEvidenceAvailable,
            }),
            ...(signals.trustGraphEvidenceUsed !== undefined && {
                trustGraphEvidenceUsed: signals.trustGraphEvidenceUsed,
            }),
            ...(signals.assistantDeclaredSpeculative !== undefined && {
                assistantDeclaredSpeculative:
                    signals.assistantDeclaredSpeculative,
            }),
        },
        limitations:
            missingSignals.length === 0
                ? classification.assessment.limitations
                : [
                      ...classification.assessment.limitations,
                      `${record.origin === 'host_reported' ? 'Host' : 'Footnote'} did not report these provenance signals: ${missingSignals.join(', ')}.`,
                  ],
    };

    return {
        origin: record.origin,
        reportedSignals: signals,
        missingSignals,
        provenance: classification.provenance,
        assessment,
    };
}
