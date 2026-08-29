/**
 * @description: Sanitizes backend-authored trace records for safe framework-independent display.
 * @footnote-scope: utility
 * @footnote-module: TraceDisplay
 * @footnote-risk: medium - Incorrect sanitization could expose large artifacts or hide trace outcomes.
 * @footnote-ethics: high - Consistent redaction preserves transparency without exposing recorded content.
 */

import type {
    LegacyPresentationMetadata,
    PresentationMetadata,
    WorkflowRecord,
} from '@footnote/contracts/policy';
import { PresentationMetadataSchema } from '@footnote/contracts/web';

/**
 * Preserves workflow metadata while replacing artifact contents with length-only
 * markers so every display adapter applies the same redaction policy.
 */
export const sanitizeWorkflowForDisplay = (
    workflow: WorkflowRecord | undefined
): WorkflowRecord | null =>
    workflow
        ? {
              ...workflow,
              steps: workflow.steps.map((step) => {
                  const { artifacts, ...outcomeWithoutArtifacts } =
                      step.outcome;
                  return {
                      ...step,
                      outcome: {
                          ...outcomeWithoutArtifacts,
                          ...(artifacts !== undefined && {
                              artifacts: artifacts.map(
                                  (artifact) =>
                                      `[redacted:${artifact.length} chars]`
                              ),
                          }),
                      },
                  };
              }),
          }
        : null;

/**
 * Presentation metadata is already deliberately text-free. Preserve its
 * outcome and opaque lineage identifiers in the display payload without
 * introducing either answer version to the trace surface.
 */
export const sanitizePresentationForDisplay = (
    presentation: unknown
): (PresentationMetadata | LegacyPresentationMetadata) | null => {
    const parsed = PresentationMetadataSchema.safeParse(presentation);
    return parsed.success ? parsed.data : null;
};

/**
 * Explains why the optional presentation path was or was not used without
 * implying that a requested provider returned a draft.
 */
export const getPresentationTraceSummary = (
    presentation: PresentationMetadata | LegacyPresentationMetadata
): string => {
    if (presentation.flow === 'candidate_review') {
        switch (presentation.reasonCode) {
            case 'candidate_generated':
                return 'A presentation candidate influenced expression; the authoritative generation and review selected the answer.';
            case 'draft_timeout':
                return 'No presentation candidate was returned because the candidate timed out; the normal answer path was used.';
            case 'draft_provider_error':
                return 'No presentation candidate was returned because the candidate provider failed; the normal answer path was used.';
            case 'candidate_not_admissible':
                return 'The presentation candidate was not usable as prose; the normal answer path was used.';
            case 'disabled':
                return 'Presentation was disabled; the normal answer path was used.';
            case 'budget_skipped':
                return 'Presentation skipped: token budget exhausted; the authoritative answer was kept.';
            case 'profile_not_configured':
                return 'No presentation profile was configured; the normal answer path was used.';
        }
    }

    switch (presentation.reasonCode) {
        case 'draft_timeout':
            return 'No draft was returned: the presentation draft timed out; the main answer was used.';
        case 'draft_provider_error':
            return 'No draft was returned: the presentation provider failed; the main answer was used.';
        case 'finalizer_timeout':
            return 'A draft was observed, but the finalizer timed out; the main answer was used.';
        case 'finalizer_provider_error':
            return 'A draft was observed, but the finalizer failed; the main answer was used.';
        case 'mechanical_preservation_failed':
            return 'The draft and finalizer returned, but preservation checks rejected the finalizer; the main answer was used.';
        case 'structured_output':
            return 'The draft returned non-prose structured output; the main answer was used.';
        case 'evidence_repair_unavailable':
            return 'Evidence repair was unavailable; the main answer was used.';
        case 'presentation_repair_unavailable':
            return 'Presentation repair was unavailable; the main answer was used.';
        case 'disabled':
            return 'Presentation was disabled; the main answer was used.';
        case 'profile_not_configured':
            return 'No presentation profile was configured; the main answer was used.';
        case 'finalized':
            return 'Presentation finalized successfully.';
        case 'evidence_repaired':
            return 'Presentation finalized after evidence repair.';
        case 'presentation_repaired':
            return 'Presentation finalized after presentation repair.';
        case 'audit_unavailable':
            return 'Presentation finalized; the advisory audit was unavailable.';
        case 'audit_invalid':
            return 'Presentation finalized; the advisory audit returned invalid output.';
    }
};
