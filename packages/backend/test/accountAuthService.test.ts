/**
 * @description: Verifies bounded one-time OIDC transactions and local account session lifecycle.
 * @footnote-scope: test
 * @footnote-module: AccountAuthServiceTests
 * @footnote-risk: high - Regressions could permit callback replay or unbounded auth state.
 * @footnote-ethics: high - Tests protect identity admission and short-lived data retention.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExternalIdentityKey } from '@footnote/contracts';
import { createAccountAuthService } from '../src/services/accountAuth.js';
import { createInMemoryAccountStore } from '../src/storage/accounts/sqliteAccountStore.js';
import type {
    OidcAccountClient,
    OidcCallbackInput,
} from '../src/services/oidcClient.js';

const principal = {
    issuer: 'https://identity.example/',
    subject: 'subject-1',
    displayName: 'Administrator',
};

const createProvider = (
    options: {
        startError?: boolean | (() => boolean);
        callbackError?: boolean;
        callbackInputs?: OidcCallbackInput[];
        callbackPrincipal?: typeof principal;
    } = {}
): OidcAccountClient => ({
    startAuthorization: async () => {
        const startError =
            typeof options.startError === 'function'
                ? options.startError()
                : options.startError;
        if (startError) {
            throw new Error('provider unavailable');
        }
        return {
            authorizationUrl: 'https://identity.example/authorize',
            state: 'state-value',
            nonce: 'nonce-value',
            codeVerifier: 'verifier-value',
        };
    },
    exchangeCallback: async (input) => {
        options.callbackInputs?.push(input);
        if (options.callbackError) {
            throw new Error('invalid callback');
        }
        return options.callbackPrincipal ?? principal;
    },
});

test('disabled and unavailable providers create no login transaction', async () => {
    const disabled = createAccountAuthService({
        accountStore: createInMemoryAccountStore(),
        provider: null,
    });
    assert.deepEqual(await disabled.startLogin(), {
        ok: false,
        reason: 'disabled',
    });

    const unavailable = createAccountAuthService({
        accountStore: createInMemoryAccountStore(),
        provider: createProvider({ startError: true }),
    });
    assert.deepEqual(await unavailable.startLogin(), {
        ok: false,
        reason: 'provider_unavailable',
    });
});

test('callback consumes a transaction once and creates an expiring session', async () => {
    let nowMs = 1_000;
    let tokenIndex = 0;
    const callbackInputs: OidcCallbackInput[] = [];
    const service = createAccountAuthService({
        accountStore: createInMemoryAccountStore(),
        provider: createProvider({ callbackInputs }),
        administratorIdentityKeys: new Set([
            'https://identity.example/|subject-1',
        ]),
        now: () => nowMs,
        randomToken: () => `token-${++tokenIndex}`,
        transactionTtlMs: 100,
        sessionTtlMs: 500,
    });

    const started = await service.startLogin();
    assert.equal(started.ok, true);
    if (!started.ok) {
        return;
    }

    const completed = await service.completeLogin(
        started.transactionId,
        '?code=code-value&state=state-value'
    );
    assert.equal(completed.ok, true);
    assert.deepEqual(callbackInputs, [
        {
            callbackQuery: '?code=code-value&state=state-value',
            state: 'state-value',
            nonce: 'nonce-value',
            codeVerifier: 'verifier-value',
        },
    ]);
    assert.deepEqual(
        await service.completeLogin(started.transactionId, '?code=replay'),
        { ok: false, reason: 'invalid_transaction' }
    );
    if (!completed.ok) {
        return;
    }

    assert.deepEqual(
        service.getSession(completed.session.sessionId),
        completed.session
    );
    assert.match(completed.session.accountId, /^[0-9a-f-]{36}$/);
    assert.equal(completed.session.isAdministrator, true);
    const repeatedLogin = await service.startLogin();
    assert.equal(repeatedLogin.ok, true);
    if (repeatedLogin.ok) {
        const repeatedCompletion = await service.completeLogin(
            repeatedLogin.transactionId,
            '?code=second-login'
        );
        assert.equal(repeatedCompletion.ok, true);
        if (repeatedCompletion.ok) {
            assert.equal(
                repeatedCompletion.session.accountId,
                completed.session.accountId
            );
        }
    }
    nowMs += 501;
    assert.equal(service.getSession(completed.session.sessionId), null);
});

test('resolves regular accounts without granting administrator access', async () => {
    const service = createAccountAuthService({
        accountStore: createInMemoryAccountStore(),
        provider: createProvider(),
        administratorIdentityKeys: new Set([
            'https://identity.example/|administrator-subject',
        ]),
    });
    const started = await service.startLogin();
    assert.equal(started.ok, true);
    if (!started.ok) {
        return;
    }

    const completed = await service.completeLogin(
        started.transactionId,
        '?code=regular'
    );
    assert.equal(completed.ok, true);
    if (completed.ok) {
        assert.equal(completed.session.isAdministrator, false);
    }
});

test('administrator lookup canonicalizes issuer URLs and preserves subject matching', async () => {
    const complete = async (
        configuredIdentity: string,
        issuer: string,
        subject: string
    ): Promise<boolean> => {
        const service = createAccountAuthService({
            accountStore: createInMemoryAccountStore(),
            provider: createProvider({
                callbackPrincipal: {
                    issuer,
                    subject,
                    displayName: 'Administrator',
                },
            }),
            administratorIdentityKeys: new Set([
                buildExternalIdentityKey(
                    configuredIdentity.slice(
                        0,
                        configuredIdentity.lastIndexOf('|')
                    ),
                    configuredIdentity.slice(
                        configuredIdentity.lastIndexOf('|') + 1
                    )
                ),
            ]),
        });
        const started = await service.startLogin();
        assert.equal(started.ok, true);
        if (!started.ok) {
            return false;
        }
        const completed = await service.completeLogin(
            started.transactionId,
            '?code=administrator'
        );
        return completed.ok && completed.session.isAdministrator;
    };

    assert.equal(
        await complete(
            'https://identity.example|subject-1',
            'https://identity.example/',
            'subject-1'
        ),
        true
    );
    assert.equal(
        await complete(
            'https://identity.example/|subject-1',
            'https://identity.example',
            'subject-1'
        ),
        true
    );
    assert.equal(
        await complete(
            'https://other.example/|subject-1',
            'https://identity.example/',
            'subject-1'
        ),
        false
    );
    assert.equal(
        await complete(
            'https://identity.example/|subject-1',
            'https://identity.example/',
            'subject-2'
        ),
        false
    );
});

test('does not create a session when durable account storage is unavailable', async () => {
    const service = createAccountAuthService({
        provider: createProvider(),
        accountStore: null,
    });
    const started = await service.startLogin();
    assert.equal(started.ok, true);
    if (!started.ok) {
        return;
    }

    assert.deepEqual(
        await service.completeLogin(
            started.transactionId,
            '?code=storage-down'
        ),
        { ok: false, reason: 'account_storage_unavailable' }
    );
});

test('failed callbacks remain consumed', async () => {
    const service = createAccountAuthService({
        accountStore: createInMemoryAccountStore(),
        provider: createProvider({ callbackError: true }),
        randomToken: () => 'transaction-token',
    });
    const started = await service.startLogin();
    assert.equal(started.ok, true);
    if (!started.ok) {
        return;
    }

    assert.deepEqual(
        await service.completeLogin(started.transactionId, '?error=denied'),
        { ok: false, reason: 'provider_rejected' }
    );
    assert.deepEqual(
        await service.completeLogin(started.transactionId, '?code=replay'),
        { ok: false, reason: 'invalid_transaction' }
    );
});

test('transaction capacity evicts the oldest login and preserves zero capacity', async () => {
    let tokenIndex = 0;
    const transactionService = createAccountAuthService({
        accountStore: createInMemoryAccountStore(),
        provider: createProvider(),
        randomToken: () => `transaction-${++tokenIndex}`,
        maxTransactions: 1,
    });

    const firstTransaction = await transactionService.startLogin();
    const secondTransaction = await transactionService.startLogin();
    assert.equal(firstTransaction.ok, true);
    assert.equal(secondTransaction.ok, true);
    if (!firstTransaction.ok || !secondTransaction.ok) {
        return;
    }
    assert.deepEqual(
        await transactionService.completeLogin(
            firstTransaction.transactionId,
            '?code=first'
        ),
        { ok: false, reason: 'invalid_transaction' }
    );
    assert.equal(
        (
            await transactionService.completeLogin(
                secondTransaction.transactionId,
                '?code=second'
            )
        ).ok,
        true
    );

    const zeroCapacityService = createAccountAuthService({
        accountStore: createInMemoryAccountStore(),
        provider: createProvider(),
        maxTransactions: 0,
    });
    assert.deepEqual(await zeroCapacityService.startLogin(), {
        ok: false,
        reason: 'capacity',
    });

    tokenIndex = 0;
    const sessionService = createAccountAuthService({
        accountStore: createInMemoryAccountStore(),
        provider: createProvider(),
        randomToken: () => `session-${++tokenIndex}`,
        maxSessions: 1,
    });
    const first = await sessionService.startLogin();
    assert.equal(first.ok, true);
    if (!first.ok) {
        return;
    }
    assert.equal(
        (await sessionService.completeLogin(first.transactionId, '?code=one'))
            .ok,
        true
    );
    const second = await sessionService.startLogin();
    assert.equal(second.ok, true);
    if (!second.ok) {
        return;
    }
    assert.deepEqual(
        await sessionService.completeLogin(second.transactionId, '?code=two'),
        { ok: false, reason: 'session_capacity' }
    );
});

test('provider startup failure at capacity preserves the existing transaction', async () => {
    let failStart = false;
    const service = createAccountAuthService({
        accountStore: createInMemoryAccountStore(),
        provider: createProvider({ startError: () => failStart }),
        maxTransactions: 1,
    });

    const first = await service.startLogin();
    assert.equal(first.ok, true);
    if (!first.ok) {
        return;
    }

    failStart = true;
    assert.deepEqual(await service.startLogin(), {
        ok: false,
        reason: 'provider_unavailable',
    });

    failStart = false;
    assert.equal(
        (await service.completeLogin(first.transactionId, '?code=first')).ok,
        true
    );
});

test('clearing a session is idempotent', async () => {
    let tokenIndex = 0;
    const service = createAccountAuthService({
        accountStore: createInMemoryAccountStore(),
        provider: createProvider(),
        randomToken: () => `token-${++tokenIndex}`,
    });
    const started = await service.startLogin();
    assert.equal(started.ok, true);
    if (!started.ok) {
        return;
    }
    const completed = await service.completeLogin(
        started.transactionId,
        '?code=one'
    );
    assert.equal(completed.ok, true);
    if (!completed.ok) {
        return;
    }
    assert.equal(service.clearSession(completed.session.sessionId), true);
    assert.equal(service.clearSession(completed.session.sessionId), false);
});
