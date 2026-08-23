/**
 * @description: Typed browser-facing client methods for account session reads and local logout.
 * @footnote-scope: interface
 * @footnote-module: AccountAuthApi
 * @footnote-risk: medium - Incorrect request wiring can expose stale account state or break local logout.
 * @footnote-ethics: high - Session and CSRF handling affect user identity privacy and account control.
 */

import type { GetAuthSessionResponse } from '@footnote/contracts/web';
import type { ApiRequester } from './client.js';
import { loadGetAuthSessionResponseValidator } from './lazyWebValidators.js';

export type AccountAuthApi = {
    getAuthSession: (signal?: AbortSignal) => Promise<GetAuthSessionResponse>;
    logoutAccount: (csrfToken: string, signal?: AbortSignal) => Promise<void>;
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

    return {
        getAuthSession,
        logoutAccount,
    };
};
