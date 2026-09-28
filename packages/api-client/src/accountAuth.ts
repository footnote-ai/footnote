/**
 * @description: Typed browser-facing client methods for account session reads and local logout.
 * @footnote-scope: interface
 * @footnote-module: AccountAuthApi
 * @footnote-risk: medium - Incorrect request wiring can expose stale account state or break local logout.
 * @footnote-ethics: high - Session and CSRF handling affect user identity privacy and account control.
 */

import type {
    DiscordConnectionStateResponse,
    DiscordAccountExchangeRequest,
    GetAuthSessionResponse,
} from '@footnote/contracts/web';
import type { ApiRequester } from './client.js';
import {
    DiscordConnectionStateResponseSchema,
    DiscordAccountConsentResponseSchema,
    createSchemaResponseValidator,
} from '@footnote/contracts/web/schemas';
import { loadGetAuthSessionResponseValidator } from './lazyWebValidators.js';

export type AccountAuthApi = {
    getAuthSession: (signal?: AbortSignal) => Promise<GetAuthSessionResponse>;
    logoutAccount: (csrfToken: string, signal?: AbortSignal) => Promise<void>;
    exchangeDiscordConnection: (
        capability: string
    ) => Promise<DiscordConnectionStateResponse>;
    getDiscordConnectionState: (
        signal?: AbortSignal
    ) => Promise<DiscordConnectionStateResponse>;
    consentDiscordConnection: (csrfToken: string) => Promise<{ code: string }>;
    cancelDiscordConnection: (csrfToken: string) => Promise<void>;
};

/**
 * Creates the thin typed client for backend-owned account authentication.
 */
export const createAccountAuthApi = (
    requestJson: ApiRequester
): AccountAuthApi => {
    /**
     * @api.operationId: getAuthSession
     * @api.path: GET /api/auth/session
     */
    const getAuthSession = async (
        signal?: AbortSignal
    ): Promise<GetAuthSessionResponse> => {
        const validateResponse = await loadGetAuthSessionResponseValidator();
        const response = await requestJson<GetAuthSessionResponse>(
            '/api/auth/session',
            {
                method: 'GET',
                signal,
                cache: 'no-store',
                validateResponse,
            }
        );

        return response.data;
    };

    /**
     * @api.operationId: postAuthLogout
     * @api.path: POST /api/auth/logout
     */
    const logoutAccount = async (
        csrfToken: string,
        signal?: AbortSignal
    ): Promise<void> => {
        await requestJson<unknown>('/api/auth/logout', {
            method: 'POST',
            signal,
            cache: 'no-store',
            headers: {
                'x-auth-csrf': csrfToken,
            },
        });
    };

    /** @api.operationId: postDiscordConnectionExchange @api.path: POST /api/auth/discord-connection/exchange */
    const exchangeDiscordConnection = async (
        capability: string
    ): Promise<DiscordConnectionStateResponse> => {
        const response = await requestJson<DiscordConnectionStateResponse>(
            '/api/auth/discord-connection/exchange',
            {
                method: 'POST',
                cache: 'no-store',
                body: { capability } satisfies DiscordAccountExchangeRequest,
                validateResponse: createSchemaResponseValidator(
                    DiscordConnectionStateResponseSchema
                ),
            }
        );
        return response.data;
    };
    /** @api.operationId: getDiscordConnectionState @api.path: GET /api/auth/discord-connection */
    const getDiscordConnectionState = async (
        signal?: AbortSignal
    ): Promise<DiscordConnectionStateResponse> => {
        const response = await requestJson<DiscordConnectionStateResponse>(
            '/api/auth/discord-connection',
            {
                method: 'GET',
                signal,
                cache: 'no-store',
                validateResponse: createSchemaResponseValidator(
                    DiscordConnectionStateResponseSchema
                ),
            }
        );
        return response.data;
    };
    /** @api.operationId: postDiscordConnectionConsent @api.path: POST /api/auth/discord-connection/consent */
    const consentDiscordConnection = async (
        csrfToken: string
    ): Promise<{ code: string }> => {
        const response = await requestJson<{ code: string }>(
            '/api/auth/discord-connection/consent',
            {
                method: 'POST',
                cache: 'no-store',
                headers: { 'x-auth-csrf': csrfToken },
                body: {},
                validateResponse: createSchemaResponseValidator(
                    DiscordAccountConsentResponseSchema
                ),
            }
        );
        return response.data;
    };
    /** @api.operationId: postDiscordConnectionCancel @api.path: POST /api/auth/discord-connection/cancel */
    const cancelDiscordConnection = async (
        csrfToken: string
    ): Promise<void> => {
        await requestJson<unknown>('/api/auth/discord-connection/cancel', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'x-auth-csrf': csrfToken },
            body: {},
        });
    };

    return {
        getAuthSession,
        logoutAccount,
        exchangeDiscordConnection,
        getDiscordConnectionState,
        consentDiscordConnection,
        cancelDiscordConnection,
    };
};
