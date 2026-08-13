/**
 * @description: Small, deterministic style-rewrite corpus for the backend-owned rewrite path.
 * @footnote-scope: test
 * @footnote-module: StyleRewriteEvaluationCorpus
 * @footnote-risk: medium - Narrow examples can miss visible preservation regressions.
 * @footnote-ethics: high - Each case protects answer meaning from presentation-only rewriting.
 */

import type { StyleRewriteIntensity } from '../../src/services/styleRewrite.js';

export type StyleRewriteEvaluationCase = {
    id: string;
    personaId: 'footnote' | 'danny' | 'myuri';
    presentationGuidance: string;
    original: string;
    writerOutput: string;
    validatorOutput?: string;
    caution?: 1 | 2 | 3 | 4 | 5;
    expectedOutcome: 'applied' | 'rejected' | 'skipped';
    expectedIntensity: StyleRewriteIntensity;
};

export const styleRewriteEvaluationCorpus: StyleRewriteEvaluationCase[] = [
    {
        id: 'footnote-brief-answer',
        personaId: 'footnote',
        presentationGuidance: 'Use calm, plain language.',
        original:
            'According to Ada Lovelace, the release has 12 fixes. It may not resolve every issue.',
        writerOutput:
            'According to Ada Lovelace, the release lists 12 fixes. It may not resolve every issue.',
        caution: 2,
        expectedOutcome: 'applied',
        expectedIntensity: 'standard',
    },
    {
        id: 'danny-concise-status',
        personaId: 'danny',
        presentationGuidance: 'Keep the status direct and friendly.',
        original: 'The deployment completed at 14:30 UTC.',
        writerOutput: 'The deployment finished at 14:30 UTC.',
        caution: 2,
        expectedOutcome: 'applied',
        expectedIntensity: 'standard',
    },
    {
        id: 'myuri-cautious-explanation',
        personaId: 'myuri',
        presentationGuidance: 'Use gentle, careful cadence.',
        original:
            'The report may be incomplete because two sources are unavailable.',
        writerOutput:
            'The report may be incomplete because two sources remain unavailable.',
        caution: 2,
        expectedOutcome: 'applied',
        expectedIntensity: 'standard',
    },
    {
        id: 'footnote-long-prose',
        personaId: 'footnote',
        presentationGuidance: 'Prefer clear, measured prose.',
        original:
            'The migration is scheduled for Friday. It will move 12 collections, retain existing identifiers, and leave the public API unchanged.',
        writerOutput:
            'The migration is planned for Friday. It will move 12 collections, retain existing identifiers, and leave the public API unchanged.',
        caution: 2,
        expectedOutcome: 'applied',
        expectedIntensity: 'standard',
    },
    {
        id: 'danny-negation-preserved',
        personaId: 'danny',
        presentationGuidance: 'Be approachable without adding emphasis.',
        original: 'Do not discard the source file; the rollback depends on it.',
        writerOutput:
            'Do not remove the source file; the rollback depends on it.',
        caution: 2,
        expectedOutcome: 'applied',
        expectedIntensity: 'standard',
    },
    {
        id: 'myuri-attribution-preserved',
        personaId: 'myuri',
        presentationGuidance: 'Keep attribution explicit.',
        original:
            'According to the incident report, the service recovered after 7 minutes.',
        writerOutput:
            'According to the incident report, the service recovered in 7 minutes.',
        caution: 2,
        expectedOutcome: 'applied',
        expectedIntensity: 'standard',
    },
    {
        id: 'footnote-restrained-uncertainty',
        personaId: 'footnote',
        presentationGuidance: 'Use restrained edits only.',
        original:
            'I may be mistaken, but the deployment will likely take 3 hours.',
        writerOutput:
            'I may be mistaken, but deployment will likely take 3 hours.',
        caution: 4,
        expectedOutcome: 'applied',
        expectedIntensity: 'restrained',
    },
    {
        id: 'danny-restrained-no-escalation',
        personaId: 'danny',
        presentationGuidance: 'Keep this low-key.',
        original: 'The change can wait until tomorrow.',
        writerOutput: 'The change can wait till tomorrow.',
        caution: 4,
        expectedOutcome: 'applied',
        expectedIntensity: 'restrained',
    },
    {
        id: 'myuri-high-caution-skip',
        personaId: 'myuri',
        presentationGuidance: 'Do not alter sensitive answers.',
        original:
            'I cannot verify that medical claim from the available evidence.',
        writerOutput: 'This output must never be requested.',
        caution: 5,
        expectedOutcome: 'skipped',
        expectedIntensity: 'skipped',
    },
    {
        id: 'footnote-structured-link-rejected',
        personaId: 'footnote',
        presentationGuidance: 'Plain prose only.',
        original: 'The decision is documented in the change record.',
        writerOutput:
            'The decision is documented at https://example.com/change-record.',
        caution: 2,
        expectedOutcome: 'rejected',
        expectedIntensity: 'standard',
    },
    {
        id: 'danny-large-edit-rejected',
        personaId: 'danny',
        presentationGuidance: 'Do not add details.',
        original: 'The worker restarted once.',
        writerOutput:
            'The worker restarted once, then carefully rebuilt every queued job and verified the result with a complete manual audit.',
        validatorOutput: '{"verdict":"drift","reasons":["added_claims"]}',
        caution: 2,
        expectedOutcome: 'rejected',
        expectedIntensity: 'standard',
    },
    {
        id: 'myuri-refusal-preserved',
        personaId: 'myuri',
        presentationGuidance: 'Keep refusals calm and exact.',
        original: 'I cannot provide instructions for bypassing that control.',
        writerOutput: 'I cannot offer instructions for bypassing that control.',
        caution: 2,
        expectedOutcome: 'skipped',
        expectedIntensity: 'standard',
    },
];
