/**
 * @description: Projects a backend-owned workflow Run into the shared external review contract.
 * It exposes only bounded provenance signals, never the Run's private Results.
 * @footnote-scope: core
 * @footnote-module: ExternalRunReviewAdapter
 * @footnote-risk: medium - Incorrect signal projection can change a Run's provenance classification.
 * @footnote-ethics: high - Canonical execution facts stay Footnote-observed and private payloads stay local.
 */

import {
    reviewExternalRun,
    type ExternalRunReviewResult,
    type ExternalRunReviewSignals,
} from '@footnote/contracts/external-review';
import type { Provenance } from '@footnote/contracts/policy';
import type { Run, Result } from './workflowCore/types.js';

type SerializableRecord = { readonly [key: string]: Result };
type RecordedRunReviewSignals = Partial<
    Pick<
        ExternalRunReviewSignals,
        | 'retrievalRequested'
        | 'retrievalUsed'
        | 'retrievalToolExecuted'
        | 'trustGraphEvidenceAvailable'
        | 'trustGraphEvidenceUsed'
    >
>;

const asRecord = (value: Result | undefined): SerializableRecord | undefined =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as SerializableRecord)
        : undefined;

const asArray = (value: Result | undefined): readonly Result[] | undefined =>
    Array.isArray(value) ? value : undefined;

const asBoolean = (value: Result | undefined): boolean | undefined =>
    typeof value === 'boolean' ? value : undefined;

const asProvenance = (value: Result | undefined): Provenance | undefined =>
    value === 'Retrieved' || value === 'Inferred' || value === 'Speculative'
        ? value
        : undefined;

const hasContextEvidence = (results: readonly Result[]): boolean =>
    results.some((result) => {
        const record = asRecord(result);
        if (record?.outcome !== 'executed') return false;
        return (
            (asArray(asRecord(record.evidence)?.content)?.length ?? 0) > 0 ||
            (asArray(record.trustedInstructions)?.length ?? 0) > 0
        );
    });

/**
 * Reviews a canonical Run without treating Footnote-owned execution facts as
 * host reports. Signals unavailable from the Run may be supplied only from
 * already-recorded provenance inputs; omitted facts remain absent.
 */
export function reviewCanonicalRun(input: {
    run: Run;
    recordedSignals?: RecordedRunReviewSignals;
}): ExternalRunReviewResult {
    const generation =
        asRecord(input.run.results.answer) ?? asRecord(input.run.results.draft);
    const evidence = asRecord(input.run.results.evidence);
    const evidenceResults = asArray(evidence?.results);
    const contextResults = (evidenceResults ?? []).map(asRecord);
    const sourceCount = contextResults.reduce(
        (count, result) => count + (asArray(result?.sources)?.length ?? 0),
        0
    );
    const generationCitations = asArray(generation?.citations);
    const hasRetrieveStep = input.run.steps.some(
        (step) => step.stepId === 'retrieve'
    );
    const hasRecordedCitationArray =
        generationCitations !== undefined ||
        contextResults.some((result) => asArray(result?.sources) !== undefined);
    const citationInputsComplete =
        (generation === undefined || generationCitations !== undefined) &&
        (!hasRetrieveStep ||
            (evidenceResults !== undefined &&
                contextResults.every(
                    (result) => asArray(result?.sources) !== undefined
                )));
    const citationCountKnown =
        hasRecordedCitationArray && citationInputsComplete;
    const citationCount = (generationCitations?.length ?? 0) + sourceCount;
    const contextEvidenceUsed = hasContextEvidence(
        asArray(evidence?.results) ?? []
    );
    const generationProvenance = asProvenance(generation?.provenance);
    const generationRetrieval = asRecord(generation?.retrieval);
    const generationToolExecution = asRecord(generation?.toolExecution);
    const generationRetrievalRequested = asBoolean(
        generationRetrieval?.requested
    );
    const generationRetrievalUsed = asBoolean(generationRetrieval?.used);
    const hasAnswerCitations = (generationCitations?.length ?? 0) > 0;
    const hasRecordedContextResults = (evidenceResults?.length ?? 0) > 0;
    const hasPositiveRetrievalEvidence =
        generationRetrievalUsed === true ||
        generationProvenance === 'Retrieved' ||
        hasAnswerCitations ||
        contextEvidenceUsed;
    const retrievalUsed = hasPositiveRetrievalEvidence
        ? true
        : (input.recordedSignals?.retrievalUsed ?? generationRetrievalUsed);
    const retrievalRequested =
        hasRecordedContextResults ||
        input.recordedSignals?.retrievalRequested === true ||
        generationRetrievalRequested === true
            ? true
            : (input.recordedSignals?.retrievalRequested ??
              generationRetrievalRequested);
    let generationRetrievalToolExecuted: boolean | undefined;
    const generationToolExecutionStatus = generationToolExecution?.status;
    if (
        generationToolExecution?.toolName === 'web_search' &&
        (generationToolExecutionStatus === 'executed' ||
            generationToolExecutionStatus === 'skipped' ||
            generationToolExecutionStatus === 'failed')
    ) {
        generationRetrievalToolExecuted =
            generationToolExecutionStatus === 'executed';
    }
    let retrievalToolExecuted: boolean | undefined =
        input.recordedSignals?.retrievalToolExecuted ??
        generationRetrievalToolExecuted;
    if (contextEvidenceUsed) retrievalToolExecuted = true;
    const signals: ExternalRunReviewSignals = {
        ...input.recordedSignals,
        workflowEvidence: input.run.workflowId.length > 0,
        ...(citationCountKnown && { citationCount }),
        ...(retrievalUsed !== undefined && { retrievalUsed }),
        ...(retrievalRequested !== undefined && { retrievalRequested }),
        ...(generationProvenance !== undefined && {
            assistantDeclaredSpeculative:
                generationProvenance === 'Speculative',
        }),
        ...(retrievalToolExecuted !== undefined && {
            retrievalToolExecuted,
        }),
    };

    return reviewExternalRun({
        schemaVersion: 'v0alpha',
        origin: 'footnote_observed',
        signals,
    });
}
