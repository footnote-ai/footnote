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
): Promise<{ baseUrl: string; stop: () => Promise<void> }> => {
    let tokenIndex = 0;
    const service = createAccountAuthService({
        provider: enabled ? provider : null,
        randomToken: () => `opaque-token-${++tokenIndex}`,
    });
    const handlers = createAccountAuthHandlers({
        accountAuthService: service,
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
        csrfToken: string;
    };
    assert.equal(sessionPayload.authenticated, true);
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
