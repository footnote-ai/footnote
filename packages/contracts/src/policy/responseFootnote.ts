/**
 * @description: Defines the response metadata fields that form Footnote's canonical response footnote.
 * @footnote-scope: interface
 * @footnote-module: ResponseFootnote
 * @footnote-risk: low - This view selects existing metadata without changing runtime behavior.
 * @footnote-ethics: high - A shared inspection boundary helps surfaces present response context consistently.
 */

import type { ResponseMetadata } from './types.js';

/**
 * Stable sections for response-footnote surfaces. These name the
 * information a person can inspect; they do not require a particular button,
 * layout, or platform interaction.
 */
export const RESPONSE_FOOTNOTE_SECTIONS = [
    'sources',
    'workflow',
    'controls',
    'details',
] as const;

export type ResponseFootnoteSection =
    (typeof RESPONSE_FOOTNOTE_SECTIONS)[number];

/**
 * The portable, response-level inspection view for a completed Footnote
 * answer. It deliberately reuses `ResponseMetadata` rather than creating a
 * second serialized record. Each surface can disclose the fields it supports
 * through its own interaction model. The shared sections are
 * `sources`, `workflow`, `controls`, and `details`.
 *
 * `steerabilityControls` records controls that influenced this response. It
 * does not describe controls currently available to the user or surface.
 */
export type ResponseFootnote = Pick<
    ResponseMetadata,
    | 'responseId'
    | 'provenance'
    | 'provenanceAssessment'
    | 'citations'
    | 'safetyTier'
    | 'evaluator'
    | 'workflow'
    | 'reviewRuntime'
    | 'execution'
    | 'steerabilityControls'
    | 'trace_target'
    | 'trace_final'
    | 'trace_final_reason_code'
    | 'evidenceScore'
    | 'freshnessScore'
>;
