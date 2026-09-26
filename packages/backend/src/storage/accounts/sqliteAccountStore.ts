/**
 * @description: Persists stable Footnote accounts and their external OIDC identity mappings.
 * @footnote-scope: core
 * @footnote-module: SqliteAccountStore
 * @footnote-risk: high - Identity mapping errors can attach future data to the wrong account.
 * @footnote-ethics: high - This store defines durable ownership without retaining provider claims.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type ExternalIdentityKey = {
    issuer: string;
    subject: string;
};

export type FootnoteAccount = {
    id: string;
    createdAt: string;
    updatedAt: string;
};

export type AccountStore = {
    resolveOrCreateAccount: (identity: ExternalIdentityKey) => FootnoteAccount;
    close?: () => void;
};

/** Test-only fallback used when the auth service is constructed without persistence. */
export const createInMemoryAccountStore = (): AccountStore => {
    const accounts = new Map<string, FootnoteAccount>();
    return {
        resolveOrCreateAccount: ({ issuer, subject }) => {
            const key = `${issuer}|${subject}`;
            const existing = accounts.get(key);
            if (existing) {
                return existing;
            }
            const now = new Date().toISOString();
            const account = {
                id: randomUUID(),
                createdAt: now,
                updatedAt: now,
            };
            accounts.set(key, account);
            return account;
        },
    };
};

type AccountRow = {
    account_id: string;
    created_at: string;
    updated_at: string;
};

/**
 * Uses one SQLite transaction for the identity lookup and first-account
 * creation. SQLite's uniqueness constraint makes repeated or concurrent first
 * sign-ins resolve to the same internal account.
 */
export class SqliteAccountStore implements AccountStore {
    private readonly db: Database.Database;
    private readonly resolveStatement: Database.Statement;
    private readonly insertAccountStatement: Database.Statement;
    private readonly insertIdentityStatement: Database.Statement;
    private readonly touchIdentityStatement: Database.Statement;

    constructor(config: { dbPath: string }) {
        const resolvedPath = path.resolve(config.dbPath);
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
        this.db = new Database(resolvedPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS accounts (
                account_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS external_identities (
                issuer TEXT NOT NULL,
                subject TEXT NOT NULL,
                account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                PRIMARY KEY (issuer, subject)
            );
            CREATE INDEX IF NOT EXISTS idx_external_identities_account_id
                ON external_identities(account_id);
        `);

        this.resolveStatement = this.db.prepare(`
            SELECT a.account_id, a.created_at, a.updated_at
            FROM external_identities AS identity
            INNER JOIN accounts AS a ON a.account_id = identity.account_id
            WHERE identity.issuer = ? AND identity.subject = ?
            LIMIT 1
        `);
        this.insertAccountStatement = this.db.prepare(`
            INSERT INTO accounts(account_id, created_at, updated_at)
            VALUES (?, ?, ?)
        `);
        this.insertIdentityStatement = this.db.prepare(`
            INSERT INTO external_identities(
                issuer, subject, account_id, created_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?)
        `);
        this.touchIdentityStatement = this.db.prepare(`
            UPDATE external_identities SET last_seen_at = ?
            WHERE issuer = ? AND subject = ?
        `);
    }

    resolveOrCreateAccount({
        issuer,
        subject,
    }: ExternalIdentityKey): FootnoteAccount {
        const now = new Date().toISOString();
        const resolve = this.db.transaction((): FootnoteAccount => {
            const existing = this.resolveStatement.get(issuer, subject) as
                AccountRow | undefined;
            if (existing) {
                this.touchIdentityStatement.run(now, issuer, subject);
                return {
                    id: existing.account_id,
                    createdAt: existing.created_at,
                    updatedAt: existing.updated_at,
                };
            }

            const account = {
                id: randomUUID(),
                createdAt: now,
                updatedAt: now,
            };
            this.insertAccountStatement.run(
                account.id,
                account.createdAt,
                account.updatedAt
            );
            this.insertIdentityStatement.run(
                issuer,
                subject,
                account.id,
                now,
                now
            );
            return account;
        });

        return resolve.immediate();
    }

    close(): void {
        this.db.close();
    }
}
