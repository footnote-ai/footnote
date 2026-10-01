/**
 * @description: Verifies account memory writes and Discord identity reads stay scoped to the signed-in account.
 * @footnote-scope: test
 * @footnote-module: AccountMemoryHandlerTests
 * @footnote-risk: high - Tests exercise CSRF and account ownership at the HTTP boundary.
 * @footnote-ethics: high - Private memories and connected identities must not cross account boundaries.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createAccountAuthService } from '../src/services/accountAuth.js';
import type { OidcAccountClient } from '../src/services/oidcClient.js';
import { createAccountMemoryHandlers } from '../src/handlers/accountMemories.js';
import { createAccountDiscordConnectionHandlers } from '../src/handlers/accountDiscordConnection.js';
import { ACCOUNT_SESSION_COOKIE_NAME } from '../src/handlers/accountAuth.js';
import { createInMemoryAccountStore } from '../src/storage/accounts/sqliteAccountStore.js';

const provider: OidcAccountClient = {
    startAuthorization: async () => ({
        authorizationUrl: 'https://identity.example/authorize',
        state: 'state-value',
        nonce: 'nonce-value',
        codeVerifier: 'verifier-value',
    }),
    exchangeCallback: async () => ({
        issuer: 'https://identity.example/',
        subject: 'owner',
        displayName: 'Owner',
    }),
};

test('account memory updates require CSRF and remain owner-scoped; Discord status returns owned usernames', async (t) => {
    let tokenNumber = 0;
    const accountStore = createInMemoryAccountStore();
    const accountAuthService = createAccountAuthService({
        provider,
        accountStore,
        randomToken: () => `token-${++tokenNumber}`,
    });
    const login = await accountAuthService.startLogin();
    assert.equal(login.ok, true);
    if (!login.ok) throw new Error('Test login did not start');
    const auth = await accountAuthService.completeLogin(
        login.transactionId,
        'code=ok&state=state-value'
    );
    assert.equal(auth.ok, true);
    if (!auth.ok) throw new Error('Test login did not complete');

    const otherAccount = accountStore.resolveOrCreateAccount({
        issuer: 'https://identity.example/',
        subject: 'other',
    });
    const ownedMemory = accountStore.addMemory(
        auth.session.accountId,
        'owner memory'
    );
    const otherMemory = accountStore.addMemory(otherAccount.id, 'other memory');
    assert.ok(ownedMemory && otherMemory);
    accountStore.linkDiscordUserToAccount(
        '123456789012345678',
        auth.session.accountId,
        'memory-owner'
    );
    accountStore.linkDiscordUserToAccount(
        '987654321098765432',
        otherAccount.id,
        'memory-other'
    );

    const memoryHandlers = createAccountMemoryHandlers({
        accountAuthService,
        accountStore,
        logRequest: () => undefined,
    });
    const discordHandlers = createAccountDiscordConnectionHandlers({
        accountAuthService,
        accountStore,
        logRequest: () => undefined,
    });
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (pathname === '/api/account/discord-connection') {
            void discordHandlers.handleAccountDiscordStatusRequest(req, res);
            return;
        }
        if (pathname.startsWith('/api/account/memories/')) {
            void (req.method === 'PATCH'
                ? memoryHandlers.handleAccountMemoryUpdateRequest(req, res)
                : memoryHandlers.handleAccountMemoryDeleteRequest(req, res));
            return;
        }
        res.statusCode = 404;
        res.end();
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Failed to bind account test server');
    }
    t.after(
        async () =>
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            )
    );
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const sessionCookie = `${ACCOUNT_SESSION_COOKIE_NAME}=${auth.session.sessionId}`;

    const statusResponse = await fetch(
        `${baseUrl}/api/account/discord-connection`,
        { headers: { cookie: sessionCookie } }
    );
    assert.equal(statusResponse.status, 200);
    assert.deepEqual(await statusResponse.json(), {
        connected: true,
        accounts: [{ username: 'memory-owner' }],
    });

    const rejectedUpdate = await fetch(
        `${baseUrl}/api/account/memories/${ownedMemory.id}`,
        {
            method: 'PATCH',
            headers: {
                cookie: sessionCookie,
                'content-type': 'application/json',
                'x-auth-csrf': 'wrong-token',
            },
            body: JSON.stringify({ text: 'should not save' }),
        }
    );
    assert.equal(rejectedUpdate.status, 403);

    const foreignUpdate = await fetch(
        `${baseUrl}/api/account/memories/${otherMemory.id}`,
        {
            method: 'PATCH',
            headers: {
                cookie: sessionCookie,
                'content-type': 'application/json',
                'x-auth-csrf': auth.session.csrfToken,
            },
            body: JSON.stringify({ text: 'should not save' }),
        }
    );
    assert.equal(foreignUpdate.status, 404);

    const updateResponse = await fetch(
        `${baseUrl}/api/account/memories/${ownedMemory.id}`,
        {
            method: 'PATCH',
            headers: {
                cookie: sessionCookie,
                'content-type': 'application/json',
                'x-auth-csrf': auth.session.csrfToken,
            },
            body: JSON.stringify({ text: 'updated owner memory' }),
        }
    );
    assert.equal(updateResponse.status, 200);
    assert.deepEqual(await updateResponse.json(), {
        memory: { ...ownedMemory, text: 'updated owner memory' },
    });
    assert.deepEqual(accountStore.listMemories(otherAccount.id), [otherMemory]);
});
