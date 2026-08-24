/**
 * @description: Separates temporary administrator authorization from OIDC identity admission and account sessions.
 * @footnote-scope: core
 * @footnote-module: AdminAuthorization
 * @footnote-risk: high - An authorization mistake can expose governance-sensitive settings operations.
 * @footnote-ethics: high - Administrator decisions control who may change a Footnote instance.
 */

import { createHash } from 'node:crypto';
import type { AuthenticatedPrincipal } from '@footnote/contracts/web';
import type { AccountAuthService } from './accountAuth.js';

export type AdministratorAccountAuthorization = {
    actorSource: 'account-session';
    actorHash: string;
    csrfToken: string;
};

export type AdminAuthorizationService = {
    authorizeAccountSession: (
        sessionId: string
    ) => AdministratorAccountAuthorization | null;
};

/** Creates a short, deterministic actor identifier without retaining claims. */
export const hashAuthenticatedPrincipal = (
    principal: AuthenticatedPrincipal
): string =>
    createHash('sha256')
        .update(principal.issuer)
        .update('\0')
        .update(principal.subject)
        .digest('hex')
        .slice(0, 24);

/**
 * Builds the administrator policy seam for the current account-only stage.
 *
 * OIDC admission proves identity, while this explicit policy grants temporary
 * administrator access to every admitted account session. Later account work
 * can replace this decision without changing the account identity shape.
 */
export const createAdminAuthorizationService = ({
    accountAuthService,
}: {
    accountAuthService: AccountAuthService;
}): AdminAuthorizationService => ({
    authorizeAccountSession: (sessionId) => {
        const session = accountAuthService.getSession(sessionId);
        if (!session) {
            return null;
        }

        return {
            actorSource: 'account-session',
            actorHash: hashAuthenticatedPrincipal(session.principal),
            csrfToken: session.csrfToken,
        };
    },
});
