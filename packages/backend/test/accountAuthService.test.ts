/**
 * @description: Verifies bounded one-time OIDC transactions and local account session lifecycle.
 * @footnote-scope: test
 * @footnote-module: AccountAuthServiceTests
 * @footnote-risk: high - Regressions could permit callback replay or unbounded auth state.
 * @footnote-ethics: high - Tests protect identity admission and short-lived data retention.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountAuthService } from '../src/services/accountAuth.js';
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
        startError?: boolean;
        callbackError?: boolean;
        callbackInputs?: OidcCallbackInput[];
    } = {}
): OidcAccountClient => ({
    startAuthorization: async () => {
        if (options.startError) {
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
        return principal;
    },
});

test('disabled and unavailable providers create no login transaction', async () => {
    const disabled = createAccountAuthService({ provider: null });
    assert.deepEqual(await disabled.startLogin(), {
        ok: false,
        reason: 'disabled',
    });

    const unavailable = createAccountAuthService({
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
        provider: createProvider({ callbackInputs }),
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
    nowMs += 501;
    assert.equal(service.getSession(completed.session.sessionId), null);
});

test('failed callbacks remain consumed', async () => {
    const service = createAccountAuthService({
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
        provider: createProvider(),
        maxTransactions: 0,
    });
    assert.deepEqual(await zeroCapacityService.startLogin(), {
        ok: false,
        reason: 'capacity',
    });

    tokenIndex = 0;
    const sessionService = createAccountAuthService({
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

test('clearing a session is idempotent', async () => {
    let tokenIndex = 0;
    const service = createAccountAuthService({
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
