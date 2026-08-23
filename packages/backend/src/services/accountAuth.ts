/**
 * @description: Owns bounded in-memory OIDC login transactions and local Footnote account sessions.
 * @footnote-scope: core
 * @footnote-module: AccountAuthService
 * @footnote-risk: high - Session lifecycle mistakes could allow replay or unbounded memory growth.
 * @footnote-ethics: high - This service controls identity admission and minimizes retained account data.
 */

import { randomBytes } from 'node:crypto';
import type { AuthenticatedPrincipal } from '@footnote/contracts/web';
import type { OidcAccountClient } from './oidcClient.js';

const DEFAULT_TRANSACTION_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
const DEFAULT_MAX_TRANSACTIONS = 256;
const DEFAULT_MAX_SESSIONS = 1_024;

type LoginTransaction = {
    state: string;
    nonce: string;
    codeVerifier: string;
    expiresAtMs: number;
};

export type AccountSession = {
    sessionId: string;
    principal: AuthenticatedPrincipal;
    csrfToken: string;
    expiresAt: string;
};

export type StartAccountLoginResult =
    | {
          ok: true;
          authorizationUrl: string;
          transactionId: string;
          expiresAtMs: number;
      }
    | {
          ok: false;
          reason: 'disabled' | 'capacity' | 'provider_unavailable';
      };

export type CompleteAccountLoginResult =
    | {
          ok: true;
          session: AccountSession;
      }
    | {
          ok: false;
          reason:
              | 'disabled'
              | 'invalid_transaction'
              | 'provider_rejected'
              | 'session_capacity';
      };

export type AccountAuthService = {
    enabled: boolean;
    startLogin: () => Promise<StartAccountLoginResult>;
    completeLogin: (
        transactionId: string,
        callbackQuery: string
    ) => Promise<CompleteAccountLoginResult>;
    getSession: (sessionId: string) => AccountSession | null;
    clearSession: (sessionId: string) => boolean;
};

type CreateAccountAuthServiceDeps = {
    provider: OidcAccountClient | null;
    now?: () => number;
    randomToken?: (byteLength: number) => string;
    transactionTtlMs?: number;
    sessionTtlMs?: number;
    maxTransactions?: number;
    maxSessions?: number;
};

/**
 * Keeps authentication state process-local for the first account slice.
 * Provider errors fail closed for session creation without affecting public
 * Footnote routes.
 */
export const createAccountAuthService = ({
    provider,
    now = () => Date.now(),
    randomToken = (byteLength: number) =>
        randomBytes(byteLength).toString('base64url'),
    transactionTtlMs = DEFAULT_TRANSACTION_TTL_MS,
    sessionTtlMs = DEFAULT_SESSION_TTL_MS,
    maxTransactions = DEFAULT_MAX_TRANSACTIONS,
    maxSessions = DEFAULT_MAX_SESSIONS,
}: CreateAccountAuthServiceDeps): AccountAuthService => {
    const transactions = new Map<string, LoginTransaction>();
    const sessions = new Map<
        string,
        AccountSession & { expiresAtMs: number }
    >();

    const pruneExpired = (): void => {
        const nowMs = now();
        for (const [transactionId, transaction] of transactions) {
            if (transaction.expiresAtMs <= nowMs) {
                transactions.delete(transactionId);
            }
        }
        for (const [sessionId, session] of sessions) {
            if (session.expiresAtMs <= nowMs) {
                sessions.delete(sessionId);
            }
        }
    };

    const makeRoomForTransaction = (): boolean => {
        if (maxTransactions <= 0) {
            return false;
        }
        while (transactions.size >= maxTransactions) {
            const oldestTransactionId = transactions.keys().next().value;
            if (oldestTransactionId === undefined) {
                return false;
            }
            transactions.delete(oldestTransactionId);
        }
        return true;
    };

    const startLogin = async (): Promise<StartAccountLoginResult> => {
        if (!provider) {
            return { ok: false, reason: 'disabled' };
        }
        pruneExpired();
        if (!makeRoomForTransaction()) {
            return { ok: false, reason: 'capacity' };
        }

        try {
            const authorization = await provider.startAuthorization();
            pruneExpired();
            if (!makeRoomForTransaction()) {
                return { ok: false, reason: 'capacity' };
            }
            const transactionId = randomToken(32);
            const expiresAtMs = now() + transactionTtlMs;
            transactions.set(transactionId, {
                state: authorization.state,
                nonce: authorization.nonce,
                codeVerifier: authorization.codeVerifier,
                expiresAtMs,
            });
            return {
                ok: true,
                authorizationUrl: authorization.authorizationUrl,
                transactionId,
                expiresAtMs,
            };
        } catch {
            return { ok: false, reason: 'provider_unavailable' };
        }
    };

    const completeLogin = async (
        transactionId: string,
        callbackQuery: string
    ): Promise<CompleteAccountLoginResult> => {
        if (!provider) {
            return { ok: false, reason: 'disabled' };
        }
        pruneExpired();
        const transaction = transactions.get(transactionId);
        if (!transaction) {
            return { ok: false, reason: 'invalid_transaction' };
        }
        transactions.delete(transactionId);

        try {
            const principal = await provider.exchangeCallback({
                callbackQuery,
                state: transaction.state,
                nonce: transaction.nonce,
                codeVerifier: transaction.codeVerifier,
            });
            pruneExpired();
            if (sessions.size >= maxSessions) {
                return { ok: false, reason: 'session_capacity' };
            }
            const sessionId = randomToken(32);
            const csrfToken = randomToken(32);
            const expiresAtMs = now() + sessionTtlMs;
            const session = {
                sessionId,
                principal,
                csrfToken,
                expiresAt: new Date(expiresAtMs).toISOString(),
                expiresAtMs,
            };
            sessions.set(sessionId, session);
            return {
                ok: true,
                session: {
                    sessionId,
                    principal,
                    csrfToken,
                    expiresAt: session.expiresAt,
                },
            };
        } catch {
            return { ok: false, reason: 'provider_rejected' };
        }
    };

    const getSession = (sessionId: string): AccountSession | null => {
        pruneExpired();
        const session = sessions.get(sessionId);
        if (!session) {
            return null;
        }
        return {
            sessionId: session.sessionId,
            principal: session.principal,
            csrfToken: session.csrfToken,
            expiresAt: session.expiresAt,
        };
    };

    const clearSession = (sessionId: string): boolean =>
        sessions.delete(sessionId);

    return {
        enabled: provider !== null,
        startLogin,
        completeLogin,
        getSession,
        clearSession,
    };
};
