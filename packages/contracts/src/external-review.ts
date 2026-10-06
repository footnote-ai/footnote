/**
 * @description: Validates a bounded host-reported run record and returns Footnote's provenance assessment.
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
        origin: z.literal('host_reported'),
        signals: ExternalRunReviewSignalsSchema,
    })
    .strict();

export type ExternalRunReviewInput = z.infer<
    typeof ExternalRunReviewInputSchema
>;
export type ExternalRunReviewSignals = ExternalRunReviewInput['signals'];

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
    origin: 'host_reported';
    reportedSignals: ExternalRunReviewSignals;
    missingSignals: Array<keyof ExternalRunReviewSignals>;
    provenance: Provenance;
    assessment: ProvenanceAssessment;
};

/**
 * Validates one host-reported run and classifies only its supplied metadata.
 * Missing signals are treated as absent for the deterministic classifier and
 * listed separately so they are not mistaken for host-reported false facts.
 */
export function reviewExternalRun(input: unknown): ExternalRunReviewResult {
    const record = ExternalRunReviewInputSchema.parse(input);
    const signals = record.signals;
    const missingSignals = EXTERNAL_RUN_REVIEW_SIGNAL_NAMES.filter(
        (signal) => signals[signal] === undefined
    );
    const classification = classifyProvenanceWithSignals({
        citationCount: signals.citationCount ?? 0,
        retrievalRequested: signals.retrievalRequested ?? false,
        retrievalUsed: signals.retrievalUsed ?? false,
        retrievalToolExecuted: signals.retrievalToolExecuted ?? false,
        workflowEvidence: signals.workflowEvidence ?? false,
        trustGraphEvidenceAvailable:
            signals.trustGraphEvidenceAvailable ?? false,
        trustGraphEvidenceUsed: signals.trustGraphEvidenceUsed ?? false,
        assistantProvenance:
            signals.assistantDeclaredSpeculative === true
                ? 'Speculative'
                : undefined,
    });
    const assessment =
        missingSignals.length === 0
            ? classification.assessment
            : {
                  ...classification.assessment,
                  limitations: [
                      ...classification.assessment.limitations,
                      `Host did not report these provenance signals: ${missingSignals.join(', ')}.`,
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
