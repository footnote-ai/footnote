/**
 * @description: Compatibility adapter from the live response boundary to the canonical response-footnote component.
 * @footnote-scope: web
 * @footnote-module: ProvenanceFooter
 * @footnote-risk: medium - The adapter must not claim trace or report artifacts that the live response cannot prove.
 * @footnote-ethics: high - The adapter preserves inspectable provenance while being honest about storage races and unavailable actions.
 */

import type { ResponseMetadata } from '@footnote/contracts/policy';
import CanonicalResponseFootnote from './CanonicalResponseFootnote';

interface ProvenanceFooterProps {
    metadata?: ResponseMetadata | null;
}

/**
 * Live chat stores trace records asynchronously, so Trace remains linkable but
 * explicitly unconfirmed. Web Report has no anonymous trusted-auth seam.
 */
const ProvenanceFooter = ({ metadata }: ProvenanceFooterProps): JSX.Element => (
    <CanonicalResponseFootnote
        metadata={metadata ?? null}
        artifacts={{ trace: 'unknown', report: 'unavailable' }}
    />
);

export default ProvenanceFooter;
