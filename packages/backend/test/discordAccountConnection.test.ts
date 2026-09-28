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

    const started = service.startDiscordConnection('discord-user-a');
    assert.ok(started);
    const browserId = service.exchangeDiscordCapability(started.capability);
    assert.ok(browserId);
    assert.equal(service.exchangeDiscordCapability(started.capability), null);
    assert.equal(
        service.getDiscordConnection(browserId),
        'waiting-for-sign-in'
    );
    const code = service.approveDiscordConnection(
        browserId,
        auth.session.accountId,
        auth.session.sessionId
    );
    assert.match(code ?? '', /^\d{8}$/);
    assert.equal(
        service.confirmDiscordConnection('discord-user-b', code ?? ''),
        'invalid'
    );
    assert.equal(service.getDiscordAccount('discord-user-a'), null);
    assert.equal(
        service.confirmDiscordConnection('discord-user-a', code ?? ''),
        'linked'
    );
    assert.equal(
        service.getDiscordAccount('discord-user-a')?.id,
        auth.session.accountId
    );
    assert.equal(
        service.confirmDiscordConnection('discord-user-a', code ?? ''),
        'invalid'
    );

    const secondStart = service.startDiscordConnection('discord-user-c');
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
        service.getDiscordConnection(secondBrowser, 'different-session'),
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
    const started = service.startDiscordConnection('discord-user-a');
    assert.ok(started);
    const browserId = service.exchangeDiscordCapability(started.capability);
    assert.ok(browserId);
    service.approveDiscordConnection(
        browserId,
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
    const expired = service.startDiscordConnection('discord-user-a');
    assert.ok(expired);
    now += 10 * 60 * 1_000;
    assert.equal(service.exchangeDiscordCapability(expired.capability), null);
});

test('transient storage failure blocks confirmation without losing the approval', async () => {
    let token = 0;
    const store = createInMemoryAccountStore();
    const link = store.linkDiscordAccount;
    store.linkDiscordAccount = () => {
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
    const started = service.startDiscordConnection('discord-user-a');
    assert.ok(started);
    const browserId = service.exchangeDiscordCapability(started.capability);
    assert.ok(browserId);
    const code = service.approveDiscordConnection(
        browserId,
        auth.session.accountId,
        auth.session.sessionId
    );
    assert.ok(code);
    assert.equal(
        service.confirmDiscordConnection('discord-user-a', code),
        'unavailable'
    );
    store.linkDiscordAccount = link;
    assert.equal(
        service.confirmDiscordConnection('discord-user-a', code),
        'linked'
    );
});
