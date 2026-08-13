/**
 * @description: Sanitizes backend-authored trace records for safe framework-independent display.
 * @footnote-scope: utility
 * @footnote-module: TraceDisplay
 * @footnote-risk: medium - Incorrect sanitization could expose large artifacts or hide trace outcomes.
 * @footnote-ethics: high - Consistent redaction preserves transparency without exposing recorded content.
 */

import type {
    StyleRewriteMetadata,
    WorkflowRecord,
} from '@footnote/contracts/policy';

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
 * Style-rewrite metadata is already deliberately text-free. Preserve its
 * outcome and opaque lineage identifiers in the display payload without
 * introducing either answer version to the trace surface.
 */
export const sanitizeStyleRewriteForDisplay = (
    styleRewrite: StyleRewriteMetadata | undefined
): StyleRewriteMetadata | null => styleRewrite ?? null;
