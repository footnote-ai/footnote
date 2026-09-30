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
    authEpoch: number;
};

type DiscordConnectionTransaction = {
    discordUserId: string;
    expiresAtMs: number;
    capability: string | null;
    connectionSessionId: string | null;
    approvedAccountId: string | null;
    approvedSessionId: string | null;
    confirmationCode: string | null;
    failedAttempts: number;
};

export type DiscordConnectionState =
    | 'waiting-for-sign-in'
    | 'waiting-for-approval'
    | 'waiting-for-discord-confirmation';
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
          reason:
              'disabled' | 'capacity' | 'provider_unavailable' | 'invalidated';
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
    invalidateAccountSessions: (accountId: string) => void;
    beginAccountDeletion: (accountId: string) => void;
    finishAccountDeletion: (accountId: string) => void;
};

export type DiscordAccountConnectionService = {
    discordConnectionsEnabled: boolean;
    startDiscordConnection: (
        discordUserId: string
    ) => { capability: string; expiresAt: string } | null;
    exchangeDiscordCapability: (capability: string) => string | null;
    getDiscordConnectionState: (
        connectionSessionId: string,
        sessionId?: string
    ) => DiscordConnectionState | null;
    getDiscordConfirmationCode: (
        connectionSessionId: string,
        sessionId?: string
    ) => string | null;
    approveDiscordConnection: (
        connectionSessionId: string,
        accountId: string,
        sessionId: string
    ) => string | null;
    cancelDiscordConnection: (connectionSessionId: string) => boolean;
    /** Cancels approved confirmations owned by an account during disconnect. */
    cancelDiscordConnectionsForAccount: (accountId: string) => void;
    confirmDiscordConnection: (
        discordUserId: string,
        code: string
    ) => DiscordConnectionResult;
    findAccountByDiscordUserId: (
        discordUserId: string
    ) => FootnoteAccount | null;
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
    const transactionByDiscordUserId = new Map<string, string>();
    const sessions = new Map<
        string,
        AccountSession & { expiresAtMs: number }
    >();
    const administratorKeys = administratorIdentityKeys ?? new Set<string>();
    let authEpoch = 0;
    const deletingAccounts = new Set<string>();

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

        const transactionEpoch = authEpoch;
        try {
            const authorization = await provider.startAuthorization();
            pruneExpired();
            if (transactionEpoch !== authEpoch) {
                return { ok: false, reason: 'invalidated' };
            }
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
                authEpoch: transactionEpoch,
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
        if (transaction.authEpoch !== authEpoch) {
            return { ok: false, reason: 'invalid_transaction' };
        }
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
        if (deletingAccounts.has(account.id)) {
            return { ok: false, reason: 'invalid_transaction' };
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

    /** Revokes every local session and approved Discord connection for an account. */
    const invalidateAccountSessions = (accountId: string): void => {
        for (const [sessionId, session] of sessions) {
            if (session.accountId === accountId) clearSession(sessionId);
        }
    };

    const beginAccountDeletion = (accountId: string): void => {
        // ponytail: one process-wide epoch invalidates unrelated pending OIDC logins; use per-identity fences only if that collateral impact matters.
        authEpoch += 1;
        deletingAccounts.add(accountId);
        transactions.clear();
        invalidateAccountSessions(accountId);
    };

    const finishAccountDeletion = (accountId: string): void => {
        deletingAccounts.delete(accountId);
    };

    const clearDiscordTransaction = (id: string): void => {
        const transaction = discordTransactions.get(id);
        if (!transaction) return;
        discordTransactions.delete(id);
        if (transactionByDiscordUserId.get(transaction.discordUserId) === id) {
            transactionByDiscordUserId.delete(transaction.discordUserId);
        }
    };

    const getActiveDiscordTransaction = (
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
        const activeId = transactionByDiscordUserId.get(discordUserId);
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
            connectionSessionId: null,
            approvedAccountId: null,
            approvedSessionId: null,
            confirmationCode: null,
            failedAttempts: 0,
        });
        transactionByDiscordUserId.set(discordUserId, id);
        return { capability, expiresAt: new Date(expiresAtMs).toISOString() };
    };

    const exchangeDiscordCapability = (capability: string): string | null => {
        for (const [id, tx] of discordTransactions) {
            if (
                tx.capability &&
                tx.capability === capability &&
                getActiveDiscordTransaction(id)
            ) {
                tx.capability = null;
                tx.connectionSessionId = randomToken(32);
                return tx.connectionSessionId;
            }
        }
        return null;
    };

    const getDiscordConnectionState = (
        connectionSessionId: string,
        sessionId?: string
    ): DiscordConnectionState | null => {
        for (const [id, tx] of discordTransactions) {
            if (
                tx.connectionSessionId === connectionSessionId &&
                getActiveDiscordTransaction(id)
            ) {
                if (
                    tx.approvedSessionId &&
                    tx.approvedSessionId !== sessionId
                ) {
                    clearDiscordTransaction(id);
                    return null;
                }
                if (tx.confirmationCode)
                    return 'waiting-for-discord-confirmation';
                return sessionId
                    ? 'waiting-for-approval'
                    : 'waiting-for-sign-in';
            }
        }
        return null;
    };

    const getDiscordConfirmationCode = (
        connectionSessionId: string,
        sessionId?: string
    ): string | null => {
        for (const [id, tx] of discordTransactions) {
            if (
                tx.connectionSessionId === connectionSessionId &&
                getActiveDiscordTransaction(id)
            )
                return tx.approvedSessionId === sessionId
                    ? tx.confirmationCode
                    : null;
        }
        return null;
    };

    const approveDiscordConnection = (
        connectionSessionId: string,
        accountId: string,
        sessionId: string
    ): string | null => {
        for (const [id, tx] of discordTransactions) {
            if (
                tx.connectionSessionId !== connectionSessionId ||
                !getActiveDiscordTransaction(id)
            )
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

    const cancelDiscordConnection = (connectionSessionId: string): boolean => {
        for (const [id, tx] of discordTransactions) {
            if (tx.connectionSessionId === connectionSessionId) {
                clearDiscordTransaction(id);
                return true;
            }
        }
        return false;
    };

    const cancelDiscordConnectionsForAccount = (accountId: string): void => {
        for (const [id, tx] of discordTransactions) {
            if (tx.approvedAccountId === accountId) clearDiscordTransaction(id);
        }
    };

    const confirmDiscordConnection = (
        discordUserId: string,
        code: string
    ): DiscordConnectionResult => {
        if (!accountStore) return 'invalid';
        const id = transactionByDiscordUserId.get(discordUserId);
        const tx = id ? getActiveDiscordTransaction(id) : null;
        if (!id || !tx?.approvedAccountId || !tx.confirmationCode)
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
            result = accountStore.linkDiscordUserToAccount(
                discordUserId,
                tx.approvedAccountId
            );
        } catch {
            return 'unavailable';
        }
        clearDiscordTransaction(id);
        return result;
    };

    const findAccountByDiscordUserId = (
        discordUserId: string
    ): FootnoteAccount | null => {
        return accountStore?.findAccountByDiscordUserId(discordUserId) ?? null;
    };

    return {
        enabled: provider !== null,
        discordConnectionsEnabled: provider !== null && accountStore !== null,
        startLogin,
        completeLogin,
        getSession,
        clearSession,
        invalidateAccountSessions,
        beginAccountDeletion,
        finishAccountDeletion,
        startDiscordConnection,
        exchangeDiscordCapability,
        getDiscordConnectionState,
        getDiscordConfirmationCode,
        approveDiscordConnection,
        cancelDiscordConnection,
        cancelDiscordConnectionsForAccount,
        confirmDiscordConnection,
        findAccountByDiscordUserId,
    };
};
