/**
 * @description: Verifies account memory selection remains private, bounded, and
 * fail-open before model input projection.
 * @footnote-scope: test
 * @footnote-module: AccountMemoryContextTests
 * @footnote-risk: high - Ownership or bounds regressions can leak private memory into generation.
 * @footnote-ethics: high - User-owned context must remain controllable and advisory.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAdvisoryUserMemories } from '../src/services/accountMemoryContext.js';

const makeAuth = (accountId: string | null) => ({
    findAccountByDiscordUserId: () =>
        accountId === null
            ? null
            : { id: accountId, createdAt: '', updatedAt: '' },
});

const makeStore = (records: unknown[]) => {
    const requestedAccounts: string[] = [];
    return {
        requestedAccounts,
        listMemories: (accountId: string) => {
            requestedAccounts.push(accountId);
            return records;
        },
    };
};

const session = (accountId: string) => ({ accountId });

test('uses only the validated account session for web memories', () => {
    const store = makeStore([
        { id: 'private-id', text: 'I prefer concise answers.', createdAt: '' },
    ]);
    const result = resolveAdvisoryUserMemories({
        surface: 'web',
        session: session('account-a'),
        trustedDiscordUserId: undefined,
        accountAuthService: makeAuth(null),
        accountStore: store,
    });

    assert.deepEqual(result.memories, ['I prefer concise answers.']);
    assert.deepEqual(store.requestedAccounts, ['account-a']);
});

test('anonymous web and unlinked Discord requests do not query memories', () => {
    const store = makeStore([{ id: 'id', text: 'private', createdAt: '' }]);
    const anonymous = resolveAdvisoryUserMemories({
        surface: 'web',
        session: null,
        trustedDiscordUserId: undefined,
        accountAuthService: makeAuth(null),
        accountStore: store,
    });
    const unlinked = resolveAdvisoryUserMemories({
        surface: 'discord',
        session: null,
        trustedDiscordUserId: 'discord-user',
        accountAuthService: makeAuth(null),
        accountStore: store,
    });

    assert.deepEqual(anonymous.memories, []);
    assert.deepEqual(unlinked.memories, []);
    assert.deepEqual(store.requestedAccounts, []);
});

test('resolves trusted Discord only through its existing account mapping', () => {
    const store = makeStore([
        { id: 'private-id', text: 'Use metric units.', createdAt: '' },
    ]);
    const result = resolveAdvisoryUserMemories({
        surface: 'discord',
        session: null,
        trustedDiscordUserId: 'linked-discord-user',
        accountAuthService: makeAuth('linked-account'),
        accountStore: store,
    });

    assert.deepEqual(result.memories, ['Use metric units.']);
    assert.deepEqual(store.requestedAccounts, ['linked-account']);
});

test('keeps account selections isolated and forget removes future context', () => {
    const byAccount = new Map([
        ['account-a', [{ id: 'a-id', text: 'A-only fact.', createdAt: '' }]],
        ['account-b', [{ id: 'b-id', text: 'B-only fact.', createdAt: '' }]],
    ]);
    const store = {
        listMemories: (accountId: string) => byAccount.get(accountId) ?? [],
    };
    const resolveWeb = (accountId: string) =>
        resolveAdvisoryUserMemories({
            surface: 'web',
            session: session(accountId),
            trustedDiscordUserId: undefined,
            accountAuthService: makeAuth(null),
            accountStore: store,
        });

    assert.deepEqual(resolveWeb('account-a').memories, ['A-only fact.']);
    assert.deepEqual(resolveWeb('account-b').memories, ['B-only fact.']);
    byAccount.set('account-a', []);
    assert.deepEqual(resolveWeb('account-a').memories, []);
});

test('omits deleted memories and applies deterministic item and character bounds', () => {
    const memories = Array.from({ length: 12 }, (_, index) => ({
        id: `memory-${index}`,
        text: `Memory ${index} ${'x'.repeat(500)}`,
        createdAt: '',
    }));
    const bounded = resolveAdvisoryUserMemories({
        surface: 'web',
        session: session('account-a'),
        trustedDiscordUserId: undefined,
        accountAuthService: makeAuth(null),
        accountStore: makeStore(memories),
    });
    const deleted = resolveAdvisoryUserMemories({
        surface: 'web',
        session: session('account-a'),
        trustedDiscordUserId: undefined,
        accountAuthService: makeAuth(null),
        accountStore: makeStore([]),
    });

    assert.equal(bounded.memories.length, 7);
    assert.ok(bounded.memories.join('').length <= 4000);
    assert.equal(bounded.memories[0]?.startsWith('Memory 11'), true);
    assert.equal(bounded.memories.at(-1)?.startsWith('Memory 5'), true);
    assert.deepEqual(deleted.memories, []);
});

test('unavailable storage differs from failed reads and corrupt rows are skipped safely', () => {
    const unavailable = resolveAdvisoryUserMemories({
        surface: 'web',
        session: session('account-a'),
        trustedDiscordUserId: undefined,
        accountAuthService: makeAuth(null),
        accountStore: null,
    });
    const failed = resolveAdvisoryUserMemories({
        surface: 'web',
        session: session('account-a'),
        trustedDiscordUserId: undefined,
        accountAuthService: makeAuth(null),
        accountStore: {
            listMemories: () => {
                throw new Error('private database detail');
            },
        },
    });
    const failedDiscordLink = resolveAdvisoryUserMemories({
        surface: 'discord',
        session: null,
        trustedDiscordUserId: 'discord-user',
        accountAuthService: {
            findAccountByDiscordUserId: () => {
                throw new Error('private mapping detail');
            },
        },
        accountStore: makeStore([]),
    });
    const corrupt = resolveAdvisoryUserMemories({
        surface: 'web',
        session: session('account-a'),
        trustedDiscordUserId: undefined,
        accountAuthService: makeAuth(null),
        accountStore: makeStore([
            { id: 'private-id', text: 'x'.repeat(2001), createdAt: '' },
            { id: 'private-id-2', text: 'Still useful.', createdAt: '' },
        ]),
    });

    assert.equal(unavailable.status, 'unavailable');
    assert.deepEqual(unavailable.memories, []);
    assert.equal(failed.status, 'failed');
    assert.deepEqual(failed.memories, []);
    assert.equal(failedDiscordLink.status, 'failed');
    assert.deepEqual(failedDiscordLink.memories, []);
    assert.equal(corrupt.status, 'corrupt');
    assert.deepEqual(corrupt.memories, ['Still useful.']);
    assert.equal(JSON.stringify(corrupt).includes('private-id'), false);
});
