/**
 * @description: Exercises trusted Discord identity, browser-session consent, and confirmation over HTTP.
 * @footnote-scope: test
 * @footnote-module: DiscordAccountConnectionHandlerTests
 * @footnote-risk: high - HTTP boundary regressions could link an identity without trusted proof.
 * @footnote-ethics: high - Tests enforce explicit consent and keep secrets out of request logs.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {
    createAccountAuthHandlers,
    ACCOUNT_SESSION_COOKIE_NAME,
    ACCOUNT_TRANSACTION_COOKIE_NAME,
} from '../src/handlers/accountAuth.js';
import { createDiscordAccountConnectionHandlers } from '../src/handlers/discordAccountConnection.js';
import { createAccountAuthService } from '../src/services/accountAuth.js';
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
        displayName: 'User',
    }),
};
const cookieValue = (header: string, name: string): string => {
    const value = new RegExp(`${name}=([^;,]*)`).exec(header)?.[1];
    assert.ok(value);
    return value;
};

test('trusted start, browser exchange, OIDC consent, and original-user confirmation', async (t) => {
    let tokenIndex = 0;
    const service = createAccountAuthService({
        provider,
        accountStore: createInMemoryAccountStore(),
        randomToken: () =>
            `opaque-token-${String(++tokenIndex).padStart(40, '0')}`,
    });
    const logs: string[] = [];
    const logRequest = (
        _req: http.IncomingMessage,
        _res: http.ServerResponse,
        extra?: string
    ): void => {
        logs.push(extra ?? '');
    };
    const auth = createAccountAuthHandlers({
        accountAuthService: service,
        secureCookies: false,
        logger: { info: () => undefined, warn: () => undefined },
        logRequest,
    });
    const connection = createDiscordAccountConnectionHandlers({
        service,
        traceApiToken: null,
        serviceToken: 'trusted-service',
        maxBodyBytes: 1024,
        secureCookies: false,
        publicOrigin: 'https://footnote.example',
        logRequest,
    });
    const server = http.createServer((req, res) => {
        const path = new URL(req.url ?? '/', 'http://localhost').pathname;
        const handlers: Record<
            string,
            (
                req: http.IncomingMessage,
                res: http.ServerResponse
            ) => Promise<void>
        > = {
            '/api/internal/discord/account/start':
                connection.handleTrustedStart,
            '/api/internal/discord/account/status':
                connection.handleTrustedStatus,
            '/api/internal/discord/account/confirm':
                connection.handleTrustedConfirm,
            '/api/auth/login': auth.handleAuthLoginRequest,
            '/api/auth/callback': auth.handleAuthCallbackRequest,
            '/api/auth/session': auth.handleAuthSessionRequest,
            '/api/auth/discord-connection/exchange':
                connection.handleBrowserExchange,
            '/api/auth/discord-connection': connection.handleBrowserStatus,
            '/api/auth/discord-connection/consent':
                connection.handleBrowserConsent,
            '/api/auth/discord-connection/cancel':
                connection.handleBrowserCancel,
        };
        const handler = handlers[path];
        if (handler) void handler(req, res);
        else {
            res.statusCode = 404;
            res.end();
        }
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    t.after(
        async () =>
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            )
    );
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const startBody = JSON.stringify({ discordUserId: '12345678901234567' });
    const rejected = await fetch(
        `${baseUrl}/api/internal/discord/account/start`,
        { method: 'POST', body: startBody }
    );
    assert.equal(rejected.status, 401);

    const started = await fetch(
        `${baseUrl}/api/internal/discord/account/start`,
        {
            method: 'POST',
            headers: {
                'x-service-token': 'trusted-service',
                'content-type': 'application/json',
            },
            body: startBody,
        }
    );
    assert.equal(started.status, 200);
    assert.equal(started.headers.get('cache-control'), 'no-store');
    const startResult = (await started.json()) as { connectionUrl: string };
    const capability = new URL(startResult.connectionUrl).hash
        .slice(1)
        .replace(/^connect=/, '');
    assert.ok(capability);

    const exchanged = await fetch(
        `${baseUrl}/api/auth/discord-connection/exchange`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ capability }),
        }
    );
    assert.equal(exchanged.status, 200);
    const connectionCookie = cookieValue(
        exchanged.headers.get('set-cookie') ?? '',
        'footnote_discord_connection'
    );
    const replay = await fetch(
        `${baseUrl}/api/auth/discord-connection/exchange`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ capability }),
        }
    );
    assert.equal(replay.status, 410);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
        redirect: 'manual',
    });
    const loginCookie = cookieValue(
        login.headers.get('set-cookie') ?? '',
        ACCOUNT_TRANSACTION_COOKIE_NAME
    );
    const callback = await fetch(
        `${baseUrl}/api/auth/callback?code=code&state=state-value`,
        {
            redirect: 'manual',
            headers: {
                cookie: `${ACCOUNT_TRANSACTION_COOKIE_NAME}=${loginCookie}`,
            },
        }
    );
    const sessionCookie = cookieValue(
        callback.headers.get('set-cookie') ?? '',
        ACCOUNT_SESSION_COOKIE_NAME
    );
    const session = await fetch(`${baseUrl}/api/auth/session`, {
        headers: { cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${sessionCookie}` },
    });
    const sessionBody = (await session.json()) as { csrfToken: string };

    const csrfRejected = await fetch(
        `${baseUrl}/api/auth/discord-connection/consent`,
        {
            method: 'POST',
            headers: {
                cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${sessionCookie}; footnote_discord_connection=${connectionCookie}`,
                'content-type': 'application/json',
            },
            body: '{}',
        }
    );
    assert.equal(csrfRejected.status, 403);
    const consent = await fetch(
        `${baseUrl}/api/auth/discord-connection/consent`,
        {
            method: 'POST',
            headers: {
                cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${sessionCookie}; footnote_discord_connection=${connectionCookie}`,
                'x-auth-csrf': sessionBody.csrfToken,
                'content-type': 'application/json',
            },
            body: '{}',
        }
    );
    assert.equal(consent.status, 200);
    const { code } = (await consent.json()) as { code: string };
    assert.match(code, /^\d{8}$/);
    const otherUser = await fetch(
        `${baseUrl}/api/internal/discord/account/confirm`,
        {
            method: 'POST',
            headers: {
                'x-service-token': 'trusted-service',
                'content-type': 'application/json',
            },
            body: JSON.stringify({ discordUserId: '12345678901234568', code }),
        }
    );
    assert.equal(
        ((await otherUser.json()) as { result: string }).result,
        'invalid'
    );
    const confirmed = await fetch(
        `${baseUrl}/api/internal/discord/account/confirm`,
        {
            method: 'POST',
            headers: {
                'x-service-token': 'trusted-service',
                'content-type': 'application/json',
            },
            body: JSON.stringify({ discordUserId: '12345678901234567', code }),
        }
    );
    assert.equal(
        ((await confirmed.json()) as { result: string }).result,
        'linked'
    );
    const status = await fetch(
        `${baseUrl}/api/internal/discord/account/status`,
        {
            method: 'POST',
            headers: {
                'x-service-token': 'trusted-service',
                'content-type': 'application/json',
            },
            body: startBody,
        }
    );
    assert.deepEqual(await status.json(), { connected: true });

    const secondId = '12345678901234569';
    const secondStart = await fetch(
        `${baseUrl}/api/internal/discord/account/start`,
        {
            method: 'POST',
            headers: {
                'x-service-token': 'trusted-service',
                'content-type': 'application/json',
            },
            body: JSON.stringify({ discordUserId: secondId }),
        }
    );
    const secondLink = (await secondStart.json()) as { connectionUrl: string };
    const secondCapability = new URL(secondLink.connectionUrl).hash
        .slice(1)
        .replace(/^connect=/, '');
    const secondExchange = await fetch(
        `${baseUrl}/api/auth/discord-connection/exchange`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ capability: secondCapability }),
        }
    );
    const secondCookie = cookieValue(
        secondExchange.headers.get('set-cookie') ?? '',
        'footnote_discord_connection'
    );
    const cancelled = await fetch(
        `${baseUrl}/api/auth/discord-connection/cancel`,
        {
            method: 'POST',
            headers: {
                cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${sessionCookie}; footnote_discord_connection=${secondCookie}`,
                'x-auth-csrf': sessionBody.csrfToken,
                'content-type': 'application/json',
            },
            body: '{}',
        }
    );
    assert.equal(cancelled.status, 200);
    assert.equal(service.getDiscordConnection(secondCookie), null);
    assert.ok(
        logs.every(
            (entry) =>
                !entry.includes(capability) &&
                !entry.includes(code) &&
                !entry.includes('12345678901234567')
        )
    );
});
