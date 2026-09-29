/**
 * @description: Exercises account authentication HTTP status, cookie, session, and CSRF behavior.
 * @footnote-scope: test
 * @footnote-module: AccountAuthHandlerTests
 * @footnote-risk: high - Handler regressions can weaken callback or logout protections.
 * @footnote-ethics: high - Tests protect identity cookies and privacy-safe failures.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {
    ACCOUNT_SESSION_COOKIE_NAME,
    ACCOUNT_TRANSACTION_COOKIE_NAME,
    createAccountAuthHandlers,
} from '../src/handlers/accountAuth.js';
import { createAccountAuthService } from '../src/services/accountAuth.js';
import type { AccountAuthService } from '../src/services/accountAuth.js';
import { createInMemoryAccountStore } from '../src/storage/accounts/sqliteAccountStore.js';
import type { OidcAccountClient } from '../src/services/oidcClient.js';

const provider: OidcAccountClient = {
    startAuthorization: async () => ({
        authorizationUrl: 'https://identity.example/authorize',
        state: 'state-value',
        nonce: 'nonce-value',
        codeVerifier: 'verifier-value',
    }),
    exchangeCallback: async () => ({
        issuer: 'https://identity.example/',
        subject: 'subject-1',
        displayName: 'Administrator',
    }),
};

const startServer = async (
    enabled: boolean
): Promise<{
    baseUrl: string;
    accountStore: ReturnType<typeof createInMemoryAccountStore>;
    accountAuthService: AccountAuthService;
    deletedAssociationAccountIds: string[];
    setAssociationDeletionFailure: (shouldFail: boolean) => void;
    stop: () => Promise<void>;
}> => {
    let tokenIndex = 0;
    let associationDeletionFails = false;
    const accountStore = createInMemoryAccountStore();
    const deletedAssociationAccountIds: string[] = [];
    const service = createAccountAuthService({
        accountStore,
        provider: enabled ? provider : null,
        administratorIdentityKeys: new Set([
            'https://identity.example/|subject-1',
        ]),
        randomToken: () => `opaque-token-${++tokenIndex}`,
    });
    const handlers = createAccountAuthHandlers({
        accountAuthService: service,
        accountStore,
        incidentService: {
            deleteAccountAssociations: (accountId) => {
                if (associationDeletionFails) {
                    throw new Error('incident store unavailable');
                }
                deletedAssociationAccountIds.push(accountId);
            },
        },
        secureCookies: false,
        logger: {
            info: () => undefined,
            warn: () => undefined,
        },
        logRequest: () => undefined,
    });
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        const handler =
            pathname === '/api/auth/login'
                ? handlers.handleAuthLoginRequest
                : pathname === '/api/auth/callback'
                  ? handlers.handleAuthCallbackRequest
                  : pathname === '/api/auth/session'
                    ? handlers.handleAuthSessionRequest
                    : pathname === '/api/auth/delete'
                      ? handlers.handleAccountDeletionRequest
                      : handlers.handleAuthLogoutRequest;
        void handler(req, res);
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Failed to bind auth test server');
    }
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        accountStore,
        accountAuthService: service,
        deletedAssociationAccountIds,
        setAssociationDeletionFailure: (shouldFail) => {
            associationDeletionFails = shouldFail;
        },
        stop: async () =>
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            ),
    };
};

const readCookieValue = (header: string, name: string): string => {
    const match = new RegExp(`${name}=([^;,]*)`).exec(header);
    assert.ok(match);
    return match[1] ?? '';
};

test('disabled auth stays available as a public session response', async (t) => {
    const server = await startServer(false);
    t.after(server.stop);

    const sessionResponse = await fetch(`${server.baseUrl}/api/auth/session`);
    assert.equal(sessionResponse.status, 200);
    assert.equal(sessionResponse.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await sessionResponse.json(), {
        enabled: false,
        authenticated: false,
    });

    const loginResponse = await fetch(`${server.baseUrl}/api/auth/login`);
    assert.equal(loginResponse.status, 503);
});

test('login callback session and CSRF logout complete one local flow', async (t) => {
    const server = await startServer(true);
    t.after(server.stop);

    const loginResponse = await fetch(`${server.baseUrl}/api/auth/login`, {
        redirect: 'manual',
    });
    assert.equal(loginResponse.status, 302);
    assert.equal(
        loginResponse.headers.get('location'),
        'https://identity.example/authorize'
    );
    const transactionSetCookie = loginResponse.headers.get('set-cookie') ?? '';
    assert.match(transactionSetCookie, /Path=\/api\/auth\/callback/);
    assert.match(transactionSetCookie, /HttpOnly/);
    assert.match(transactionSetCookie, /SameSite=Lax/);
    assert.doesNotMatch(transactionSetCookie, /Secure/);
    const transactionId = readCookieValue(
        transactionSetCookie,
        ACCOUNT_TRANSACTION_COOKIE_NAME
    );

    const callbackResponse = await fetch(
        `${server.baseUrl}/api/auth/callback?code=code-value&state=state-value`,
        {
            headers: {
                cookie: `${ACCOUNT_TRANSACTION_COOKIE_NAME}=${transactionId}`,
            },
            redirect: 'manual',
        }
    );
    assert.equal(callbackResponse.status, 302);
    assert.equal(callbackResponse.headers.get('location'), '/account');
    const callbackSetCookie = callbackResponse.headers.get('set-cookie') ?? '';
    assert.match(callbackSetCookie, /Max-Age=0/);
    assert.match(
        callbackSetCookie,
        /footnote_account_session=[^,]+; Path=\/api;/
    );
    assert.doesNotMatch(
        callbackSetCookie,
        /footnote_account_session=[^,]+; Path=\/api\/auth/
    );
    const sessionId = readCookieValue(
        callbackSetCookie,
        ACCOUNT_SESSION_COOKIE_NAME
    );
    assert.ok(sessionId.length > 0);

    const sessionResponse = await fetch(`${server.baseUrl}/api/auth/session`, {
        headers: {
            cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${sessionId}`,
        },
    });
    const sessionPayload = (await sessionResponse.json()) as {
        authenticated: boolean;
        isAdministrator: boolean;
        csrfToken: string;
    };
    assert.equal(sessionPayload.authenticated, true);
    assert.equal(sessionPayload.isAdministrator, true);
    assert.ok(sessionPayload.csrfToken.length > 0);

    const rejectedLogout = await fetch(`${server.baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
            cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${sessionId}`,
            'x-auth-csrf': 'wrong-value',
        },
    });
    assert.equal(rejectedLogout.status, 403);

    const logoutResponse = await fetch(`${server.baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
            cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${sessionId}`,
            'x-auth-csrf': sessionPayload.csrfToken,
        },
    });
    assert.equal(logoutResponse.status, 204);
    assert.match(logoutResponse.headers.get('set-cookie') ?? '', /Max-Age=0/);
});

test('account deletion requires CSRF, removes account links, and permits clean sign-in', async (t) => {
    const server = await startServer(true);
    t.after(server.stop);

    const login = await fetch(`${server.baseUrl}/api/auth/login`, {
        redirect: 'manual',
    });
    const transactionCookie = login.headers.get('set-cookie') ?? '';
    const transactionId = readCookieValue(
        transactionCookie,
        ACCOUNT_TRANSACTION_COOKIE_NAME
    );
    const callback = await fetch(
        `${server.baseUrl}/api/auth/callback?code=first`,
        {
            redirect: 'manual',
            headers: {
                cookie: `${ACCOUNT_TRANSACTION_COOKIE_NAME}=${transactionId}`,
            },
        }
    );
    const sessionCookie = callback.headers.get('set-cookie') ?? '';
    const sessionId = readCookieValue(
        sessionCookie,
        ACCOUNT_SESSION_COOKIE_NAME
    );
    const accountBefore = server.accountStore.resolveOrCreateAccount({
        issuer: 'https://identity.example/',
        subject: 'subject-1',
    });

    const denied = await fetch(`${server.baseUrl}/api/auth/delete`, {
        method: 'POST',
        headers: { cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${sessionId}` },
    });
    assert.equal(denied.status, 403);

    const sessionResponse = await fetch(`${server.baseUrl}/api/auth/session`, {
        headers: { cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${sessionId}` },
    });
    const sessionPayload = (await sessionResponse.json()) as {
        csrfToken: string;
    };
    const deleted = await fetch(`${server.baseUrl}/api/auth/delete`, {
        method: 'POST',
        headers: {
            cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${sessionId}`,
            'x-auth-csrf': sessionPayload.csrfToken,
        },
    });
    assert.equal(deleted.status, 204);
    assert.match(deleted.headers.get('set-cookie') ?? '', /Max-Age=0/);
    assert.deepEqual(server.deletedAssociationAccountIds, [accountBefore.id]);
    assert.equal(
        server.accountStore.resolveOrCreateAccount({
            issuer: 'https://identity.example/',
            subject: 'subject-1',
        }).id === accountBefore.id,
        false
    );

    const nextLogin = await server.accountAuthService.startLogin();
    assert.equal(nextLogin.ok, true);
    if (!nextLogin.ok) throw new Error('subsequent login did not start');
    const nextSession = await server.accountAuthService.completeLogin(
        nextLogin.transactionId,
        '?code=after-deletion'
    );
    assert.equal(nextSession.ok, true);
    if (!nextSession.ok) throw new Error('subsequent login did not complete');
    assert.notEqual(nextSession.session.accountId, accountBefore.id);

    const signedOut = await fetch(`${server.baseUrl}/api/auth/session`, {
        headers: { cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${sessionId}` },
    });
    assert.equal((await signedOut.json()).authenticated, false);
});

test('partial deletion failures revoke sessions and can be retried after sign-in', async (t) => {
    const server = await startServer(true);
    t.after(server.stop);
    server.setAssociationDeletionFailure(true);

    const login = await fetch(`${server.baseUrl}/api/auth/login`, {
        redirect: 'manual',
    });
    const transactionId = readCookieValue(
        login.headers.get('set-cookie') ?? '',
        ACCOUNT_TRANSACTION_COOKIE_NAME
    );
    const callback = await fetch(
        `${server.baseUrl}/api/auth/callback?code=first`,
        {
            redirect: 'manual',
            headers: {
                cookie: `${ACCOUNT_TRANSACTION_COOKIE_NAME}=${transactionId}`,
            },
        }
    );
    const firstSessionId = readCookieValue(
        callback.headers.get('set-cookie') ?? '',
        ACCOUNT_SESSION_COOKIE_NAME
    );
    const firstSession = server.accountAuthService.getSession(firstSessionId);
    assert.ok(firstSession);

    const failed = await fetch(`${server.baseUrl}/api/auth/delete`, {
        method: 'POST',
        headers: {
            cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${firstSessionId}`,
            'x-auth-csrf': firstSession.csrfToken,
        },
    });
    assert.equal(failed.status, 503);
    assert.equal(server.accountAuthService.getSession(firstSessionId), null);
    assert.equal(
        server.accountStore.resolveOrCreateAccount({
            issuer: 'https://identity.example/',
            subject: 'subject-1',
        }).id,
        firstSession.accountId
    );

    server.setAssociationDeletionFailure(false);
    const retryLogin = await server.accountAuthService.startLogin();
    assert.equal(retryLogin.ok, true);
    if (!retryLogin.ok) throw new Error('retry sign-in did not start');
    const retrySession = await server.accountAuthService.completeLogin(
        retryLogin.transactionId,
        '?code=retry'
    );
    assert.equal(retrySession.ok, true);
    if (!retrySession.ok) throw new Error('retry sign-in did not complete');

    const deleteAccount = server.accountStore.deleteAccount;
    server.accountStore.deleteAccount = () => {
        throw new Error('account store unavailable');
    };
    const partial = await fetch(`${server.baseUrl}/api/auth/delete`, {
        method: 'POST',
        headers: {
            cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${retrySession.session.sessionId}`,
            'x-auth-csrf': retrySession.session.csrfToken,
        },
    });
    assert.equal(partial.status, 503);
    server.accountStore.deleteAccount = deleteAccount;
    assert.equal(
        server.accountStore.resolveOrCreateAccount({
            issuer: 'https://identity.example/',
            subject: 'subject-1',
        }).id,
        firstSession.accountId
    );

    const finalLogin = await server.accountAuthService.startLogin();
    assert.equal(finalLogin.ok, true);
    if (!finalLogin.ok) throw new Error('final sign-in did not start');
    const finalSession = await server.accountAuthService.completeLogin(
        finalLogin.transactionId,
        '?code=final'
    );
    assert.equal(finalSession.ok, true);
    if (!finalSession.ok) throw new Error('final sign-in did not complete');
    const retried = await fetch(`${server.baseUrl}/api/auth/delete`, {
        method: 'POST',
        headers: {
            cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${finalSession.session.sessionId}`,
            'x-auth-csrf': finalSession.session.csrfToken,
        },
    });
    assert.equal(retried.status, 204);
    assert.deepEqual(server.deletedAssociationAccountIds, [
        firstSession.accountId,
        firstSession.accountId,
    ]);
});

test('invalid callback clears transaction state and uses a generic redirect', async (t) => {
    const server = await startServer(true);
    t.after(server.stop);

    const response = await fetch(
        `${server.baseUrl}/api/auth/callback?error=access_denied&secret=hidden`,
        { redirect: 'manual' }
    );
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/account?auth=failed');
    assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=0/);
});
