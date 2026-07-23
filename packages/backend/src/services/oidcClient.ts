/**
 * @description: Wraps the narrow openid-client surface used for Footnote account sign-in.
 * @footnote-scope: core
 * @footnote-module: OidcAccountClient
 * @footnote-risk: high - Provider validation mistakes could create unverified account sessions.
 * @footnote-ethics: high - This boundary validates identity while minimizing retained provider data.
 */

import * as openidClient from 'openid-client';
import type { AuthenticatedPrincipal } from '@footnote/contracts/web';

export type OidcAuthorizationRequest = {
    authorizationUrl: string;
    state: string;
    nonce: string;
    codeVerifier: string;
};

export type OidcCallbackInput = {
    callbackQuery: string;
    state: string;
    nonce: string;
    codeVerifier: string;
};

export type OidcAccountClient = {
    startAuthorization: () => Promise<OidcAuthorizationRequest>;
    exchangeCallback: (
        input: OidcCallbackInput
    ) => Promise<AuthenticatedPrincipal>;
};

type OidcLibrary = Pick<
    typeof openidClient,
    | 'ClientSecretBasic'
    | 'authorizationCodeGrant'
    | 'buildAuthorizationUrl'
    | 'calculatePKCECodeChallenge'
    | 'discovery'
    | 'randomNonce'
    | 'randomPKCECodeVerifier'
    | 'randomState'
>;

type CreateOidcAccountClientDeps = {
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    library?: OidcLibrary;
};

const normalizeDisplayClaim = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized.slice(0, 256) : null;
};

/**
 * Lazily discovers provider metadata. Only successful discovery is cached, so
 * a temporary provider outage never prevents public startup or later retries.
 */
export const createOidcAccountClient = ({
    issuerUrl,
    clientId,
    clientSecret,
    redirectUri,
    library = openidClient,
}: CreateOidcAccountClientDeps): OidcAccountClient => {
    let configurationPromise: Promise<openidClient.Configuration> | null = null;

    const getConfiguration = async (): Promise<openidClient.Configuration> => {
        if (!configurationPromise) {
            configurationPromise = library
                .discovery(
                    new URL(issuerUrl),
                    clientId,
                    {
                        token_endpoint_auth_method: 'client_secret_basic',
                    },
                    library.ClientSecretBasic(clientSecret),
                    { timeout: 10 }
                )
                .then((configuration) => {
                    if (!configuration.serverMetadata().supportsPKCE()) {
                        throw new Error(
                            'OIDC provider does not advertise PKCE S256 support'
                        );
                    }
                    return configuration;
                })
                .catch((error: unknown) => {
                    configurationPromise = null;
                    throw error;
                });
        }
        return configurationPromise;
    };

    const startAuthorization = async (): Promise<OidcAuthorizationRequest> => {
        const configuration = await getConfiguration();
        const codeVerifier = library.randomPKCECodeVerifier();
        const codeChallenge =
            await library.calculatePKCECodeChallenge(codeVerifier);
        const state = library.randomState();
        const nonce = library.randomNonce();
        const authorizationUrl = library.buildAuthorizationUrl(configuration, {
            redirect_uri: redirectUri,
            scope: 'openid profile',
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            state,
            nonce,
        });

        return {
            authorizationUrl: authorizationUrl.href,
            state,
            nonce,
            codeVerifier,
        };
    };

    const exchangeCallback = async ({
        callbackQuery,
        state,
        nonce,
        codeVerifier,
    }: OidcCallbackInput): Promise<AuthenticatedPrincipal> => {
        const configuration = await getConfiguration();
        const callbackUrl = new URL(redirectUri);
        callbackUrl.search = callbackQuery.startsWith('?')
            ? callbackQuery
            : `?${callbackQuery}`;
        const tokens = await library.authorizationCodeGrant(
            configuration,
            callbackUrl,
            {
                pkceCodeVerifier: codeVerifier,
                expectedState: state,
                expectedNonce: nonce,
                idTokenExpected: true,
            }
        );
        const claims = tokens.claims();
        if (
            !claims ||
            typeof claims.iss !== 'string' ||
            claims.iss.length === 0 ||
            typeof claims.sub !== 'string' ||
            claims.sub.length === 0
        ) {
            throw new Error('OIDC callback did not contain required ID claims');
        }

        return {
            issuer: claims.iss,
            subject: claims.sub,
            displayName:
                normalizeDisplayClaim(claims.name) ??
                normalizeDisplayClaim(claims.preferred_username),
        };
    };

    return {
        startAuthorization,
        exchangeCallback,
    };
};
