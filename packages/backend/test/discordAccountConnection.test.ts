/**
 * @description: Protects Discord connection transaction ownership and single-use confirmation.
 * @footnote-scope: test
 * @footnote-module: DiscordAccountConnectionTests
 * @footnote-risk: high - Regressions could bind a Discord identity to the wrong account.
 * @footnote-ethics: high - Tests keep identity linking explicit and private.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountAuthService } from '../src/services/accountAuth.js';
import { createInMemoryAccountStore } from '../src/storage/accounts/sqliteAccountStore.js';
import type { OidcAccountClient } from '../src/services/oidcClient.js';

const provider: OidcAccountClient = {
    startAuthorization: async () => ({
        authorizationUrl: 'https://idp.test',
        state: 's',
        nonce: 'n',
        codeVerifier: 'v',
    }),
    exchangeCallback: async () => ({
        issuer: 'https://idp.test',
        subject: 'account-a',
        displayName: null,
    }),
};

test('Discord linking requires browser approval and the initiating Discord user', async () => {
    let token = 0;
    const store = createInMemoryAccountStore();
    const service = createAccountAuthService({
        provider,
        accountStore: store,
        randomToken: () => `token-${++token}`,
    });
    const login = await service.startLogin();
    assert.equal(login.ok, true);
    if (!login.ok) return;
    const auth = await service.completeLogin(
        login.transactionId,
        'code=ok&state=s'
    );
    assert.equal(auth.ok, true);
    if (!auth.ok) return;

    const started = service.startDiscordConnection('discord-user-a', 'jordan');
    assert.ok(started);
    const connectionSessionId = service.exchangeDiscordCapability(
        started.capability
    );
    assert.ok(connectionSessionId);
    assert.equal(service.exchangeDiscordCapability(started.capability), null);
    assert.equal(
        service.getDiscordConnectionState(connectionSessionId),
        'waiting-for-sign-in'
    );
    assert.equal(
        service.getDiscordConnectionState(
            connectionSessionId,
            auth.session.sessionId
        ),
        'waiting-for-approval'
    );
    const code = service.approveDiscordConnection(
        connectionSessionId,
        auth.session.accountId,
        auth.session.sessionId
    );
    assert.match(code ?? '', /^\d{8}$/);
    assert.equal(
        service.getDiscordConnectionState(
            connectionSessionId,
            auth.session.sessionId
        ),
        'waiting-for-discord-confirmation'
    );
    assert.equal(
        service.confirmDiscordConnection('discord-user-b', code ?? ''),
        'invalid'
    );
    assert.equal(service.findAccountByDiscordUserId('discord-user-a'), null);
    assert.equal(
        service.confirmDiscordConnection('discord-user-a', code ?? ''),
        'linked'
    );
    assert.equal(
        service.findAccountByDiscordUserId('discord-user-a')?.id,
        auth.session.accountId
    );
    assert.equal(
        store.listDiscordLinksForAccount(auth.session.accountId)[0]
            ?.discordUsername,
        'jordan'
    );
    assert.equal(
        service.confirmDiscordConnection('discord-user-a', code ?? ''),
        'invalid'
    );

    const secondStart = service.startDiscordConnection(
        'discord-user-c',
        'other'
    );
    assert.ok(secondStart);
    const secondBrowser = service.exchangeDiscordCapability(
        secondStart.capability
    );
    assert.ok(secondBrowser);
    const secondCode = service.approveDiscordConnection(
        secondBrowser,
        auth.session.accountId,
        auth.session.sessionId
    );
    assert.ok(secondCode);
    assert.equal(
        service.getDiscordConnectionState(secondBrowser, 'different-session'),
        null
    );
    assert.equal(
        service.confirmDiscordConnection('discord-user-c', secondCode),
        'invalid'
    );
});

test('Discord connection expires and invalidates after five wrong codes', async () => {
    let now = 1_000;
    let token = 0;
    const store = createInMemoryAccountStore();
    const service = createAccountAuthService({
        provider,
        accountStore: store,
        now: () => now,
        randomToken: () => `token-${++token}`,
    });
    const login = await service.startLogin();
    assert.equal(login.ok, true);
    if (!login.ok) return;
    const auth = await service.completeLogin(
        login.transactionId,
        'code=ok&state=s'
    );
    assert.equal(auth.ok, true);
    if (!auth.ok) return;
    const started = service.startDiscordConnection('discord-user-a', 'jordan');
    assert.ok(started);
    const connectionSessionId = service.exchangeDiscordCapability(
        started.capability
    );
    assert.ok(connectionSessionId);
    service.approveDiscordConnection(
        connectionSessionId,
        auth.session.accountId,
        auth.session.sessionId
    );
    for (let attempt = 1; attempt < 5; attempt += 1) {
        assert.equal(
            service.confirmDiscordConnection('discord-user-a', '00000000'),
            'wrong-code'
        );
    }
    assert.equal(
        service.confirmDiscordConnection('discord-user-a', '00000000'),
        'attempts-exhausted'
    );
    const expired = service.startDiscordConnection('discord-user-a', 'jordan');
    assert.ok(expired);
    now += 10 * 60 * 1_000;
    assert.equal(service.exchangeDiscordCapability(expired.capability), null);
});

test('transient storage failure blocks confirmation without losing the approval', async () => {
    let token = 0;
    const store = createInMemoryAccountStore();
    const link = store.linkDiscordUserToAccount;
    store.linkDiscordUserToAccount = () => {
        throw new Error('storage unavailable');
    };
    const service = createAccountAuthService({
        provider,
        accountStore: store,
        randomToken: () => `token-${++token}`,
    });
    const login = await service.startLogin();
    assert.equal(login.ok, true);
    if (!login.ok) return;
    const auth = await service.completeLogin(
        login.transactionId,
        'code=ok&state=s'
    );
    assert.equal(auth.ok, true);
    if (!auth.ok) return;
    const started = service.startDiscordConnection('discord-user-a', 'jordan');
    assert.ok(started);
    const connectionSessionId = service.exchangeDiscordCapability(
        started.capability
    );
    assert.ok(connectionSessionId);
    const code = service.approveDiscordConnection(
        connectionSessionId,
        auth.session.accountId,
        auth.session.sessionId
    );
    assert.ok(code);
    assert.equal(
        service.confirmDiscordConnection('discord-user-a', code),
        'unavailable'
    );
    store.linkDiscordUserToAccount = link;
    assert.equal(
        service.confirmDiscordConnection('discord-user-a', code),
        'linked'
    );
});

test('disconnect cancellation invalidates only that account’s pending Discord confirmations', async () => {
    let token = 0;
    let subject = 'account-a';
    const store = createInMemoryAccountStore();
    const service = createAccountAuthService({
        provider: {
            ...provider,
            exchangeCallback: async () => ({
                issuer: 'https://idp.test',
                subject,
                displayName: null,
            }),
        },
        accountStore: store,
        randomToken: () => `token-${++token}`,
    });
    const createSession = async (nextSubject: string) => {
        subject = nextSubject;
        const login = await service.startLogin();
        assert.equal(login.ok, true);
        if (!login.ok) throw new Error('Test login did not start');
        const result = await service.completeLogin(
            login.transactionId,
            'code=ok&state=s'
        );
        assert.equal(result.ok, true);
        if (!result.ok) throw new Error('Test login did not complete');
        return result.session;
    };
    const accountA = await createSession('account-a');
    const accountB = await createSession('account-b');
    const pendingA = service.startDiscordConnection('discord-user-a', 'user-a');
    const pendingB = service.startDiscordConnection('discord-user-b', 'user-b');
    assert.ok(pendingA && pendingB);
    const connectionA = service.exchangeDiscordCapability(pendingA.capability);
    const connectionB = service.exchangeDiscordCapability(pendingB.capability);
    assert.ok(connectionA && connectionB);
    const codeA = service.approveDiscordConnection(
        connectionA,
        accountA.accountId,
        accountA.sessionId
    );
    const codeB = service.approveDiscordConnection(
        connectionB,
        accountB.accountId,
        accountB.sessionId
    );
    assert.ok(codeA && codeB);

    service.cancelDiscordConnectionsForAccount(accountA.accountId);

    assert.equal(
        service.confirmDiscordConnection('discord-user-a', codeA),
        'invalid'
    );
    assert.equal(
        service.confirmDiscordConnection('discord-user-b', codeB),
        'linked'
    );
    assert.equal(store.hasDiscordLinkForAccount(accountA.accountId), false);
    assert.equal(store.hasDiscordLinkForAccount(accountB.accountId), true);
});
