/**
 * @description: Owns bounded in-memory OIDC login transactions and local Footnote account sessions.
 * @footnote-scope: core
 * @footnote-module: AccountAuthService
 * @footnote-risk: high - Session lifecycle mistakes could allow replay or unbounded memory growth.
 * @footnote-ethics: high - This service controls identity admission and minimizes retained account data.
 */

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { buildExternalIdentityKey } from '@footnote/contracts';
import type { AuthenticatedPrincipal } from '@footnote/contracts/web';
import type {
    AccountStore,
    FootnoteAccount,
} from '../storage/accounts/sqliteAccountStore.js';
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

type DiscordConnectionTransaction = {
    discordUserId: string;
    expiresAtMs: number;
    capability: string | null;
    browserId: string | null;
    approvedAccountId: string | null;
    approvedSessionId: string | null;
    confirmationCode: string | null;
    failedAttempts: number;
};

export type DiscordConnectionStatus =
    'waiting-for-sign-in' | 'ready-to-confirm' | 'approved';
export type DiscordConnectionResult =
    | 'linked'
    | 'already-linked'
    | 'conflict'
    | 'invalid'
    | 'wrong-code'
    | 'attempts-exhausted'
    | 'unavailable';

export type AccountSession = {
    sessionId: string;
    accountId: FootnoteAccount['id'];
    isAdministrator: boolean;
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
              | 'account_storage_unavailable'
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

export type DiscordAccountConnectionService = {
    discordConnectionsEnabled: boolean;
    startDiscordConnection: (
        discordUserId: string
    ) => { capability: string; expiresAt: string } | null;
    exchangeDiscordCapability: (capability: string) => string | null;
    getDiscordConnection: (
        browserId: string,
        sessionId?: string
    ) => DiscordConnectionStatus | null;
    getDiscordConfirmationCode: (
        browserId: string,
        sessionId?: string
    ) => string | null;
    approveDiscordConnection: (
        browserId: string,
        accountId: string,
        sessionId: string
    ) => string | null;
    cancelDiscordConnection: (browserId: string) => boolean;
    confirmDiscordConnection: (
        discordUserId: string,
        code: string
    ) => DiscordConnectionResult;
    getDiscordAccount: (discordUserId: string) => FootnoteAccount | null;
};

type CreateAccountAuthServiceDeps = {
    provider: OidcAccountClient | null;
    accountStore: AccountStore | null;
    administratorIdentityKeys?: ReadonlySet<string>;
    now?: () => number;
    randomToken?: (byteLength: number) => string;
    transactionTtlMs?: number;
    sessionTtlMs?: number;
    maxTransactions?: number;
    maxSessions?: number;
};

/**
 * Keeps OIDC sessions and bounded Discord connection transactions process-local.
 * Identity, storage, and provider failures fail closed for account operations
 * without affecting public Footnote routes.
 */
export const createAccountAuthService = ({
    provider,
    accountStore,
    administratorIdentityKeys,
    now = () => Date.now(),
    randomToken = (byteLength: number) =>
        randomBytes(byteLength).toString('base64url'),
    transactionTtlMs = DEFAULT_TRANSACTION_TTL_MS,
    sessionTtlMs = DEFAULT_SESSION_TTL_MS,
    maxTransactions = DEFAULT_MAX_TRANSACTIONS,
    maxSessions = DEFAULT_MAX_SESSIONS,
}: CreateAccountAuthServiceDeps): AccountAuthService &
    DiscordAccountConnectionService => {
    const transactions = new Map<string, LoginTransaction>();
    const discordTransactions = new Map<string, DiscordConnectionTransaction>();
    const discordByUser = new Map<string, string>();
    const sessions = new Map<
        string,
        AccountSession & { expiresAtMs: number }
    >();
    const administratorKeys = administratorIdentityKeys ?? new Set<string>();

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
        if (maxTransactions <= 0) {
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

        let principal: AuthenticatedPrincipal;
        try {
            principal = await provider.exchangeCallback({
                callbackQuery,
                state: transaction.state,
                nonce: transaction.nonce,
                codeVerifier: transaction.codeVerifier,
            });
        } catch {
            return { ok: false, reason: 'provider_rejected' };
        }

        pruneExpired();
        if (!accountStore) {
            return { ok: false, reason: 'account_storage_unavailable' };
        }
        if (sessions.size >= maxSessions) {
            return { ok: false, reason: 'session_capacity' };
        }

        let account: FootnoteAccount;
        try {
            account = accountStore.resolveOrCreateAccount({
                issuer: principal.issuer,
                subject: principal.subject,
            });
        } catch {
            return { ok: false, reason: 'account_storage_unavailable' };
        }

        const sessionId = randomToken(32);
        const csrfToken = randomToken(32);
        const expiresAtMs = now() + sessionTtlMs;
        const session = {
            sessionId,
            accountId: account.id,
            isAdministrator: administratorKeys.has(
                buildExternalIdentityKey(principal.issuer, principal.subject)
            ),
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
                accountId: session.accountId,
                isAdministrator: session.isAdministrator,
                principal,
                csrfToken,
                expiresAt: session.expiresAt,
            },
        };
    };

    const getSession = (sessionId: string): AccountSession | null => {
        pruneExpired();
        const session = sessions.get(sessionId);
        if (!session) {
            return null;
        }
        return {
            sessionId: session.sessionId,
            accountId: session.accountId,
            isAdministrator: session.isAdministrator,
            principal: session.principal,
            csrfToken: session.csrfToken,
            expiresAt: session.expiresAt,
        };
    };

    const clearSession = (sessionId: string): boolean => {
        for (const [id, tx] of discordTransactions) {
            if (tx.approvedSessionId === sessionId) clearDiscordTransaction(id);
        }
        return sessions.delete(sessionId);
    };

    const clearDiscordTransaction = (id: string): void => {
        const transaction = discordTransactions.get(id);
        if (!transaction) return;
        discordTransactions.delete(id);
        if (discordByUser.get(transaction.discordUserId) === id) {
            discordByUser.delete(transaction.discordUserId);
        }
    };

    const activeDiscordTransaction = (
        id: string
    ): DiscordConnectionTransaction | null => {
        const transaction = discordTransactions.get(id);
        if (!transaction || transaction.expiresAtMs <= now()) {
            clearDiscordTransaction(id);
            return null;
        }
        return transaction;
    };

    const startDiscordConnection = (
        discordUserId: string
    ): { capability: string; expiresAt: string } | null => {
        if (!provider || !accountStore || maxTransactions <= 0) return null;
        const activeId = discordByUser.get(discordUserId);
        if (activeId) clearDiscordTransaction(activeId);
        for (const [id, tx] of discordTransactions) {
            if (tx.expiresAtMs <= now()) clearDiscordTransaction(id);
        }
        while (discordTransactions.size >= maxTransactions) {
            const oldest = discordTransactions.keys().next().value;
            if (oldest === undefined) return null;
            clearDiscordTransaction(oldest);
        }
        const id = randomToken(32);
        const capability = randomToken(32);
        const expiresAtMs = now() + transactionTtlMs;
        discordTransactions.set(id, {
            discordUserId,
            expiresAtMs,
            capability,
            browserId: null,
            approvedAccountId: null,
            approvedSessionId: null,
            confirmationCode: null,
            failedAttempts: 0,
        });
        discordByUser.set(discordUserId, id);
        return { capability, expiresAt: new Date(expiresAtMs).toISOString() };
    };

    const exchangeDiscordCapability = (capability: string): string | null => {
        for (const [id, tx] of discordTransactions) {
            if (
                tx.capability &&
                tx.capability === capability &&
                activeDiscordTransaction(id)
            ) {
                tx.capability = null;
                tx.browserId = randomToken(32);
                return tx.browserId;
            }
        }
        return null;
    };

    const getDiscordConnection = (
        browserId: string,
        sessionId?: string
    ): DiscordConnectionStatus | null => {
        for (const [id, tx] of discordTransactions) {
            if (tx.browserId === browserId && activeDiscordTransaction(id)) {
                if (
                    tx.approvedSessionId &&
                    tx.approvedSessionId !== sessionId
                ) {
                    clearDiscordTransaction(id);
                    return null;
                }
                if (tx.confirmationCode) return 'approved';
                return tx.approvedAccountId
                    ? 'ready-to-confirm'
                    : 'waiting-for-sign-in';
            }
        }
        return null;
    };

    const getDiscordConfirmationCode = (
        browserId: string,
        sessionId?: string
    ): string | null => {
        for (const [id, tx] of discordTransactions) {
            if (tx.browserId === browserId && activeDiscordTransaction(id))
                return tx.approvedSessionId === sessionId
                    ? tx.confirmationCode
                    : null;
        }
        return null;
    };

    const approveDiscordConnection = (
        browserId: string,
        accountId: string,
        sessionId: string
    ): string | null => {
        for (const [id, tx] of discordTransactions) {
            if (tx.browserId !== browserId || !activeDiscordTransaction(id))
                continue;
            if (tx.approvedAccountId && tx.approvedAccountId !== accountId)
                return null;
            if (!tx.approvedAccountId) {
                tx.approvedAccountId = accountId;
                tx.approvedSessionId = sessionId;
            } else if (tx.approvedSessionId !== sessionId) return null;
            if (!tx.confirmationCode)
                tx.confirmationCode = Array.from(
                    { length: 8 },
                    () => '0123456789'[randomInt(10)]
                ).join('');
            return tx.confirmationCode;
        }
        return null;
    };

    const cancelDiscordConnection = (browserId: string): boolean => {
        for (const [id, tx] of discordTransactions) {
            if (tx.browserId === browserId) {
                clearDiscordTransaction(id);
                return true;
            }
        }
        return false;
    };

    const confirmDiscordConnection = (
        discordUserId: string,
        code: string
    ): DiscordConnectionResult => {
        if (!accountStore) return 'invalid';
        const id = discordByUser.get(discordUserId);
        const tx = id ? activeDiscordTransaction(id) : null;
        if (!id || !tx || !tx.approvedAccountId || !tx.confirmationCode)
            return 'invalid';
        const expected = Buffer.from(tx.confirmationCode);
        const supplied = Buffer.from(code);
        if (
            expected.length !== supplied.length ||
            !timingSafeEqual(expected, supplied)
        ) {
            tx.failedAttempts += 1;
            if (tx.failedAttempts >= 5) {
                clearDiscordTransaction(id);
                return 'attempts-exhausted';
            }
            return 'wrong-code';
        }
        let result: 'linked' | 'already-linked' | 'conflict';
        try {
            result = accountStore.linkDiscordAccount(
                discordUserId,
                tx.approvedAccountId
            );
        } catch {
            return 'unavailable';
        }
        clearDiscordTransaction(id);
        return result;
    };

    const getDiscordAccount = (
        discordUserId: string
    ): FootnoteAccount | null => {
        return accountStore?.getDiscordAccount(discordUserId) ?? null;
    };

    return {
        enabled: provider !== null,
        discordConnectionsEnabled: provider !== null && accountStore !== null,
        startLogin,
        completeLogin,
        getSession,
        clearSession,
        startDiscordConnection,
        exchangeDiscordCapability,
        getDiscordConnection,
        getDiscordConfirmationCode,
        approveDiscordConnection,
        cancelDiscordConnection,
        confirmDiscordConnection,
        getDiscordAccount,
    };
};
