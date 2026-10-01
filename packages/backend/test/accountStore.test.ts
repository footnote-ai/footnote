/**
 * @description: Verifies durable account ownership and external identity resolution.
 * @footnote-scope: test
 * @footnote-module: AccountStoreTests
 * @footnote-risk: high - Mapping regressions can attach future data to the wrong account.
 * @footnote-ethics: high - Tests protect account ownership and minimize retained identity data.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SqliteAccountStore } from '../src/storage/accounts/sqliteAccountStore.js';

const identity = {
    issuer: 'https://identity.example/application/o/footnote/',
    subject: 'subject-1',
};
const execFileAsync = promisify(execFile);

test('creates one stable account for a repeated external identity', () => {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-account-store-')
    );
    const dbPath = path.join(tempDir, 'accounts.db');
    let store: SqliteAccountStore | null = null;

    try {
        store = new SqliteAccountStore({ dbPath });
        const first = store.resolveOrCreateAccount(identity);
        const repeated = store.resolveOrCreateAccount(identity);
        const otherSubject = store.resolveOrCreateAccount({
            ...identity,
            subject: 'subject-2',
        });
        const otherPath = store.resolveOrCreateAccount({
            ...identity,
            issuer: 'https://identity.example/application/o/other/',
        });
        const otherSlash = store.resolveOrCreateAccount({
            ...identity,
            issuer: 'https://identity.example/application/o/footnote',
        });

        assert.equal(first.id, repeated.id);
        assert.notEqual(first.id, otherSubject.id);
        assert.notEqual(first.id, otherPath.id);
        assert.notEqual(first.id, otherSlash.id);

        const db = new Database(dbPath, { readonly: true });
        assert.equal(
            (
                db.prepare('SELECT COUNT(*) AS count FROM accounts').get() as {
                    count: number;
                }
            ).count,
            4
        );
        assert.equal(
            (
                db
                    .prepare(
                        'SELECT COUNT(*) AS count FROM external_identities'
                    )
                    .get() as {
                    count: number;
                }
            ).count,
            4
        );
        assert.deepEqual(
            (
                db.prepare('PRAGMA table_info(accounts)').all() as Array<{
                    name: string;
                }>
            ).map((column) => column.name),
            ['account_id', 'created_at', 'updated_at']
        );
        db.close();
    } finally {
        store?.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('two stores resolving the same first identity converge on one account', () => {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-account-race-')
    );
    const dbPath = path.join(tempDir, 'accounts.db');
    let firstStore: SqliteAccountStore | null = null;
    let secondStore: SqliteAccountStore | null = null;

    try {
        firstStore = new SqliteAccountStore({ dbPath });
        secondStore = new SqliteAccountStore({ dbPath });
        const accounts = [
            firstStore.resolveOrCreateAccount(identity),
            secondStore.resolveOrCreateAccount(identity),
        ];

        assert.equal(accounts[0]?.id, accounts[1]?.id);
    } finally {
        firstStore?.close();
        secondStore?.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('Discord mappings survive reopen and disconnect only by account', () => {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-discord-account-')
    );
    const dbPath = path.join(tempDir, 'accounts.db');
    let store: SqliteAccountStore | null = null;
    try {
        store = new SqliteAccountStore({ dbPath });
        const accountA = store.resolveOrCreateAccount(identity);
        const accountB = store.resolveOrCreateAccount({
            ...identity,
            subject: 'subject-2',
        });
        assert.equal(
            store.linkDiscordUserToAccount(
                'discord-1',
                accountA.id,
                'first-user'
            ),
            'linked'
        );
        assert.equal(
            store.linkDiscordUserToAccount(
                'discord-1',
                accountA.id,
                'renamed-user'
            ),
            'already-linked'
        );
        assert.equal(
            store.linkDiscordUserToAccount(
                'discord-2',
                accountB.id,
                'second-user'
            ),
            'linked'
        );
        assert.equal(
            store.linkDiscordUserToAccount(
                'discord-1',
                accountB.id,
                'other-user'
            ),
            'conflict'
        );
        store.close();
        store = new SqliteAccountStore({ dbPath });
        assert.equal(
            store.findAccountByDiscordUserId('discord-1')?.id,
            accountA.id
        );
        assert.equal(
            store.findAccountByDiscordUserId('discord-2')?.id,
            accountB.id
        );
        assert.equal(store.hasDiscordLinkForAccount(accountA.id), true);
        const [discordLink] = store.listDiscordLinksForAccount(accountA.id);
        assert.equal(discordLink?.discordUserId, 'discord-1');
        assert.equal(discordLink?.discordUsername, 'renamed-user');
        assert.match(discordLink?.createdAt ?? '', /^\d{4}-\d\d-/);
        store.unlinkDiscordUserFromAccount(accountA.id);
        assert.equal(store.hasDiscordLinkForAccount(accountA.id), false);
        assert.deepEqual(store.listDiscordLinksForAccount(accountA.id), []);
        assert.equal(store.findAccountByDiscordUserId('discord-1'), null);
        assert.equal(
            store.findAccountByDiscordUserId('discord-2')?.id,
            accountB.id
        );
    } finally {
        store?.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('legacy Discord links migrate in place with no username', () => {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-discord-legacy-')
    );
    const dbPath = path.join(tempDir, 'accounts.db');
    let store: SqliteAccountStore | null = null;
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
        CREATE TABLE accounts (
            account_id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE discord_account_links (
            discord_user_id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
            created_at TEXT NOT NULL
        );
        INSERT INTO accounts VALUES ('legacy-account', '2026-01-01', '2026-01-01');
        INSERT INTO discord_account_links VALUES ('123456789012345678', 'legacy-account', '2026-01-01');
    `);
    legacyDb.close();
    try {
        store = new SqliteAccountStore({ dbPath });
        assert.deepEqual(store.listDiscordLinksForAccount('legacy-account'), [
            {
                discordUserId: '123456789012345678',
                discordUsername: null,
                createdAt: '2026-01-01',
            },
        ]);
    } finally {
        store?.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('deleting an account removes its identity and Discord mappings idempotently', () => {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-account-delete-')
    );
    let store: SqliteAccountStore | null = null;
    try {
        store = new SqliteAccountStore({
            dbPath: path.join(tempDir, 'accounts.db'),
        });
        const account = store.resolveOrCreateAccount(identity);
        const other = store.resolveOrCreateAccount({
            ...identity,
            subject: 'subject-2',
        });
        store.linkDiscordUserToAccount('discord-1', account.id, 'user-one');
        const memory = store.addMemory(account.id, 'remove with owner');
        assert.ok(memory);

        store.deleteAccount(account.id);
        store.deleteAccount(account.id);

        assert.notEqual(store.resolveOrCreateAccount(identity).id, account.id);
        assert.equal(store.findAccountByDiscordUserId('discord-1'), null);
        assert.deepEqual(store.listMemories(account.id), []);
        assert.equal(store.forgetMemory(other.id, memory.id), false);
        assert.equal(
            store.resolveOrCreateAccount({
                ...identity,
                subject: 'subject-2',
            }).id,
            other.id
        );
    } finally {
        store?.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('account export storage returns only the requested account mappings', () => {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-account-export-')
    );
    let store: SqliteAccountStore | null = null;
    try {
        store = new SqliteAccountStore({
            dbPath: path.join(tempDir, 'accounts.db'),
        });
        const owner = store.resolveOrCreateAccount(identity);
        const other = store.resolveOrCreateAccount({
            ...identity,
            subject: 'other-subject',
        });
        store.linkDiscordUserToAccount('discord-owner', owner.id, 'owner-name');
        store.linkDiscordUserToAccount('discord-other', other.id, 'other-name');
        const memory = store.addMemory(owner.id, 'only for owner');
        store.addMemory(other.id, 'not for owner');

        const exported = store.getAccountExportData(owner.id);
        assert.ok(exported);
        assert.deepEqual(exported.account, owner);
        assert.deepEqual(exported.externalIdentityMappings, [
            {
                ...identity,
                createdAt: owner.createdAt,
                lastSeenAt: owner.createdAt,
            },
        ]);
        assert.equal(
            exported.discordMappings[0]?.discordUserId,
            'discord-owner'
        );
        assert.equal(
            exported.discordMappings[0]?.discordUsername,
            'owner-name'
        );
        assert.match(
            exported.discordMappings[0]?.createdAt ?? '',
            /^\d{4}-\d\d-/
        );
        assert.deepEqual(exported.memories, [memory]);
        assert.equal(exported.discordMappings.length, 1);
        assert.equal(
            exported.discordMappings[0]?.discordUserId,
            'discord-owner'
        );
        assert.equal(store.getAccountExportData('not-an-account'), null);
        const serialized = JSON.stringify(exported);
        assert.ok(!serialized.includes('other-subject'));
        assert.ok(!serialized.includes('discord-other'));
    } finally {
        store?.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('account memories have a bounded persisted count', () => {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'account-memory-cap-')
    );
    let store: SqliteAccountStore | null = null;
    try {
        store = new SqliteAccountStore({
            dbPath: path.join(tempDir, 'accounts.db'),
        });
        const account = store.resolveOrCreateAccount(identity);
        for (let index = 0; index < 50; index += 1) {
            assert.ok(store.addMemory(account.id, `memory ${index}`));
        }
        assert.equal(store.addMemory(account.id, 'over the limit'), null);
        assert.equal(store.listMemories(account.id).length, 50);
    } finally {
        store?.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('account memory edits preserve identity and remain scoped to their owner', () => {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'account-memory-edit-')
    );
    let store: SqliteAccountStore | null = null;
    try {
        store = new SqliteAccountStore({
            dbPath: path.join(tempDir, 'accounts.db'),
        });
        const owner = store.resolveOrCreateAccount(identity);
        const other = store.resolveOrCreateAccount({
            ...identity,
            subject: 'other-subject',
        });
        const memory = store.addMemory(owner.id, 'original text');
        assert.ok(memory);

        assert.equal(
            store.updateMemory(other.id, memory.id, 'must not change'),
            null
        );
        assert.deepEqual(
            store.updateMemory(owner.id, memory.id, 'edited text'),
            {
                ...memory,
                text: 'edited text',
            }
        );
        assert.deepEqual(store.listMemories(owner.id), [
            { ...memory, text: 'edited text' },
        ]);
    } finally {
        store?.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('concurrent Discord links preserve one account and isolate conflicts', async () => {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-discord-race-')
    );
    const dbPath = path.join(tempDir, 'accounts.db');
    let store: SqliteAccountStore | null = null;
    try {
        store = new SqliteAccountStore({ dbPath });
        const accountA = store.resolveOrCreateAccount(identity);
        const accountB = store.resolveOrCreateAccount({
            ...identity,
            subject: 'subject-2',
        });
        store.close();
        store = null;
        const worker = `
            import { SqliteAccountStore } from './packages/backend/src/storage/accounts/sqliteAccountStore.ts';
            const store = new SqliteAccountStore({ dbPath: process.argv[1] });
            try { console.log(store.linkDiscordUserToAccount(process.argv[2], process.argv[3], 'worker-name')); }
            finally { store.close(); }
        `;
        const link = (accountId: string) =>
            execFileAsync(
                process.execPath,
                [
                    '--import',
                    'tsx',
                    '--input-type=module',
                    '--eval',
                    worker,
                    dbPath,
                    'discord-1',
                    accountId,
                ],
                { cwd: process.cwd() }
            ).then(({ stdout }) => stdout.trim());
        const outcomes = await Promise.all([
            link(accountA.id),
            link(accountB.id),
        ]);
        assert.equal(
            outcomes.filter((result) => result === 'linked').length,
            1
        );
        assert.equal(
            outcomes.filter((result) => result === 'conflict').length,
            1
        );
        store = new SqliteAccountStore({ dbPath });
        assert.ok(
            [accountA.id, accountB.id].includes(
                store.findAccountByDiscordUserId('discord-1')?.id ?? ''
            )
        );
    } finally {
        store?.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
