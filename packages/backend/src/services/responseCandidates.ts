/**
 * @description: Collects model-produced response candidates while a workflow runs.
 * The collector keeps candidate text in memory until the parent response id is known.
 * @footnote-scope: core
 * @footnote-module: ResponseCandidates
 * @footnote-risk: medium - Incorrect links could make response history misleading.
 * @footnote-ethics: high - Candidate history must not include prompts, plans, audit feedback, or hidden reasoning.
 */
import { randomUUID } from 'node:crypto';
import type {
    ResponseCandidate,
    ResponseCandidateStage,
} from '@footnote/contracts/web';

const UNLINKED_WORKFLOW_STEP_ID = '__unlinked__';

/** Keeps only user-facing model prose and never records empty outputs. */
export type ResponseCandidateCollector = {
    record: (input: {
        stage: ResponseCandidateStage;
        text: string;
        parentCandidateId?: string;
    }) => string | undefined;
    linkToWorkflowStep: (candidateId: string, workflowStepId: string) => void;
    markSelected: (candidateId: string) => void;
    latestCandidateId: () => string | undefined;
    finalize: () => ResponseCandidate[];
};

/**
 * Creates a workflow-local candidate chain. IDs are random opaque values rather
 * than text-derived identifiers so candidate contents are not disclosed by IDs.
 */
export const createResponseCandidateCollector =
    (): ResponseCandidateCollector => {
        const candidates: ResponseCandidate[] = [];

        const findCandidate = (
            candidateId: string
        ): ResponseCandidate | undefined =>
            candidates.find((candidate) => candidate.id === candidateId);

        return {
            record: ({ stage, text, parentCandidateId }) => {
                const normalizedText = text.trim();
                if (!normalizedText) {
                    return undefined;
                }
                const id = `candidate_${randomUUID()}`;
                candidates.push({
                    id,
                    ...(parentCandidateId !== undefined && {
                        parentCandidateId,
                    }),
                    workflowStepId: UNLINKED_WORKFLOW_STEP_ID,
                    sequence: candidates.length,
                    stage,
                    state: 'superseded',
                    text: normalizedText,
                });
                return id;
            },
            linkToWorkflowStep: (candidateId, workflowStepId) => {
                const candidate = findCandidate(candidateId);
                if (candidate !== undefined) {
                    candidate.workflowStepId = workflowStepId;
                }
            },
            markSelected: (candidateId) => {
                for (const candidate of candidates) {
                    candidate.state =
                        candidate.id === candidateId
                            ? 'selected'
                            : 'superseded';
                }
            },
            latestCandidateId: () => candidates.at(-1)?.id,
            finalize: () => {
                const selectedCount = candidates.filter(
                    (candidate) => candidate.state === 'selected'
                ).length;
                const hasUnlinkedCandidate = candidates.some(
                    (candidate) =>
                        candidate.workflowStepId === UNLINKED_WORKFLOW_STEP_ID
                );
                if (selectedCount !== 1 || hasUnlinkedCandidate) {
                    return [];
                }
                return candidates.map((candidate) => ({ ...candidate }));
            },
        };
    };
