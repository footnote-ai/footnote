/**
 * @description: Builds backend CORS and CSP allowlists for web-facing responses.
 * @footnote-scope: utility
 * @footnote-module: BackendWebSection
 * @footnote-risk: medium - Wrong allowlists can break embeds or expose the API too broadly.
 * @footnote-ethics: medium - Origin policy affects who can access and embed Footnote safely.
 */

import { envDefaultValues } from '@footnote/config-spec';
import { parseBooleanEnv, parseCsvEnv } from '../parsers.js';
import type { RuntimeConfig, WarningSink } from '../types.js';

/**
 * Builds CORS and CSP allowlists used by the backend's web-facing responses.
 */
export const buildWebSection = (
    env: NodeJS.ProcessEnv,
    _warn: WarningSink
): Pick<RuntimeConfig, 'cors' | 'csp' | 'publicContext'> => ({
    cors: {
        allowedOrigins: parseCsvEnv(env.ALLOWED_ORIGINS, [
            ...envDefaultValues.ALLOWED_ORIGINS,
        ]),
    },
    csp: {
        frameAncestors: parseCsvEnv(env.FRAME_ANCESTORS, [
            ...envDefaultValues.FRAME_ANCESTORS,
        ]),
    },
    publicContext: {
        // This is an explicit readiness gate, not a retrieval selector. It
        // must remain disabled until TrustGraph raw evidence is supported.
        nycSept11RecordsEnabled: parseBooleanEnv(
            env.FOOTNOTE_PUBLIC_NYC_SEPT11_RECORDS_ENABLED,
            false,
            'FOOTNOTE_PUBLIC_NYC_SEPT11_RECORDS_ENABLED',
            _warn
        ),
    },
});
