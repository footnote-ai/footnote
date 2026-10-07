/**
 * @description: Builds the deliberately small public page projection from a validated stored trace.
 * @footnote-scope: core
 * @footnote-module: PublicResponseProjection
 * @footnote-risk: high - An allowlist mistake could expose private trace or context fields.
 * @footnote-ethics: high - Publication is an explicit privacy boundary for user-visible answers.
 */
import type { ResponseMetadata } from '@footnote/contracts/policy';
import type { PublicResponseProjection } from '@footnote/contracts/web';

const PUBLIC_LIMITATION_MAX_LENGTH = 500;
const PUBLIC_LIMITATIONS_MAX_COUNT = 8;

/**
 * Projects an explicitly published delivered answer without serializing raw metadata.
 * The client-supplied answer is checked against a backend-recorded digest before use.
 */
export const projectPublicResponse = ({
    answer,
    metadata,
    publishedAt,
    expiresAt,
}: {
    answer: string;
    metadata: ResponseMetadata & {
        displayIntegrity?: { status: 'complete' | 'partial' };
    };
    publishedAt: string;
    expiresAt: string;
}): PublicResponseProjection => ({
    answer,
    provenance: metadata.provenance,
    // Citations do not carry a public/private marker; HTTP(S) alone cannot
    // distinguish public references from private GitHub or signed attachment URLs.
    sources: [],
    limitations: [
        ...(metadata.provenanceAssessment?.limitations ?? []),
        ...(metadata.citations.length === 0
            ? ['No sources were recorded for this response.']
            : [
                  'Source links were omitted because saved citations are not classified as public.',
              ]),
        ...(metadata.displayIntegrity?.status === 'partial'
            ? ['Some provenance details are unavailable.']
            : []),
    ]
        .filter(
            (limitation): limitation is string =>
                typeof limitation === 'string' && limitation.trim().length > 0
        )
        .slice(0, PUBLIC_LIMITATIONS_MAX_COUNT)
        .map((limitation) =>
            limitation.trim().slice(0, PUBLIC_LIMITATION_MAX_LENGTH)
        ),
    publishedAt,
    expiresAt,
});
