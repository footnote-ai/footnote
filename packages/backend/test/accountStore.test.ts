/**
 * @description: Verifies durable account ownership and external identity resolution.
 * @footnote-scope: test
 * @footnote-module: AccountStoreTests
 * @footnote-risk: high - Mapping regressions can attach future data to the wrong account.
 * @footnote-ethics: high - Tests protect account ownership and minimize retained identity data.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SqliteAccountStore } from '../src/storage/accounts/sqliteAccountStore.js';

const identity = {
    issuer: 'https://identity.example/application/o/footnote/',
    subject: 'subject-1',
};

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
