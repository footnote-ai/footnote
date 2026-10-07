/**
 * @description: Deterministic provenance classification shared by Footnote runtime and external review.
 * @footnote-scope: utility
 * @footnote-module: ProvenanceAssessment
 * @footnote-risk: medium - Changing signal precedence can change provenance labels.
 * @footnote-ethics: high - Classification affects transparency and trust in provenance claims.
 */

import type { Provenance, ProvenanceAssessment } from './types.js';

type ProvenanceClassificationInput = {
    assistantProvenance?: Provenance;
    citationCount?: number;
    retrievalRequested?: boolean;
    retrievalUsed?: boolean;
    retrievalToolExecuted?: boolean;
    workflowEvidence?: boolean;
    trustGraphEvidenceAvailable?: boolean;
    trustGraphEvidenceUsed?: boolean;
};

type ProvenanceClassificationResult = {
    provenance: Provenance;
    assessment: ProvenanceAssessment;
};

/**
 * Deterministic multi-signal provenance classification with explicit method
 * disclosure, conflict signaling, and conservative uncertainty language.
 *
 * This does not emit structural execution fact records. It classifies supplied
 * signals and records conflicts or incomplete evidence. The caller owns the
 * origin and reliability of each supplied fact.
 */
export const classifyProvenanceWithSignals = (
    input: ProvenanceClassificationInput
): ProvenanceClassificationResult => {
    // TODO(provenance-structural-first): Keep this deterministic classifier,
    // but retire heuristic fallbacks that can be replaced by explicit runtime
    // execution evidence once those signals are universally available.
    const citationsPresent =
        input.citationCount !== undefined && input.citationCount > 0;
    const assistantDeclaredSpeculative =
        input.assistantProvenance === 'Speculative';
    const retrievalSignals = [
        citationsPresent,
        input.retrievalUsed === true,
        input.retrievalToolExecuted === true,
        input.workflowEvidence === true,
    ];
    const retrievalSignalCount = retrievalSignals.filter(Boolean).length;
    const conflicts: string[] = [];
    const limitations: string[] = [];

    if (input.retrievalUsed === true && input.citationCount === 0) {
        conflicts.push('retrieval_used_without_citations');
        limitations.push(
            'Retrieval ran, but no citations were retained after normalization.'
        );
    }

    if (
        citationsPresent &&
        input.retrievalUsed === false &&
        input.retrievalToolExecuted === false
    ) {
        conflicts.push('citations_without_execution_confirmation');
        limitations.push(
            'Citations were present without matching retrieval/tool execution evidence.'
        );
    }

    if (
        input.trustGraphEvidenceUsed === true &&
        input.trustGraphEvidenceAvailable === false
    ) {
        conflicts.push('trustgraph_usage_without_availability');
        limitations.push(
            'TrustGraph usage signal was reported without corresponding available P_EVID refs.'
        );
    }

    if (assistantDeclaredSpeculative && retrievalSignalCount > 0) {
        conflicts.push(
            'assistant_speculative_conflicts_with_retrieval_signals'
        );
        limitations.push(
            'Signals are mixed; response may combine sourced and inferred content.'
        );
    }

    if (input.retrievalRequested === true && input.retrievalUsed === false) {
        limitations.push(
            'Retrieval was requested but not used by execution, reducing grounding confidence.'
        );
    }

    let provenance: Provenance;
    if (assistantDeclaredSpeculative && retrievalSignalCount <= 1) {
        provenance = 'Speculative';
    } else if (
        citationsPresent ||
        retrievalSignalCount >= 2 ||
        (input.trustGraphEvidenceUsed === true &&
            (citationsPresent ||
                retrievalSignalCount > 0 ||
                input.retrievalToolExecuted === true))
    ) {
        provenance = 'Retrieved';
    } else if (assistantDeclaredSpeculative) {
        provenance = 'Inferred';
    } else {
        provenance = 'Inferred';
    }

    return {
        provenance,
        assessment: {
            methodId: 'deterministic_multi_signal_v1',
            methodLabel:
                'Deterministic multi-signal provenance classification (backend)',
            signals: {
                citationsPresent,
                retrievalRequested: input.retrievalRequested === true,
                retrievalUsed: input.retrievalUsed === true,
                retrievalToolExecuted: input.retrievalToolExecuted === true,
                workflowEvidence: input.workflowEvidence === true,
                trustGraphEvidenceAvailable:
                    input.trustGraphEvidenceAvailable === true,
                trustGraphEvidenceUsed: input.trustGraphEvidenceUsed === true,
                assistantDeclaredSpeculative,
            },
            conflicts,
            limitations,
        },
    };
};
