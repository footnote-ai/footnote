/**
 * @description: Persists stable Footnote accounts and their OIDC and Discord links.
 * @footnote-scope: core
 * @footnote-module: SqliteAccountStore
 * @footnote-risk: high - Identity mapping errors can attach future data to the wrong account.
 * @footnote-ethics: high - This store defines durable ownership without retaining provider claims.
 */

import Database from 'better-sqlite3';
import { buildExternalIdentityKey } from '@footnote/contracts';
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

export type AccountExportData = {
    account: FootnoteAccount;
    externalIdentityMappings: Array<
        ExternalIdentityKey & { createdAt: string; lastSeenAt: string }
    >;
    discordMappings: Array<{ discordUserId: string; createdAt: string }>;
    memories: AccountMemory[];
};

export type AccountMemory = { id: string; text: string; createdAt: string };
const MAX_ACCOUNT_MEMORIES = 50;

export type AccountStore = {
    resolveOrCreateAccount: (identity: ExternalIdentityKey) => FootnoteAccount;
    deleteAccount: (accountId: string) => void;
    findAccountByDiscordUserId: (
        discordUserId: string
    ) => FootnoteAccount | null;
    linkDiscordUserToAccount: (
        discordUserId: string,
        accountId: string
    ) => 'linked' | 'already-linked' | 'conflict';
    getAccountExportData: (accountId: string) => AccountExportData | null;
    listMemories: (accountId: string) => AccountMemory[];
    addMemory: (accountId: string, text: string) => AccountMemory | null;
    forgetMemory: (accountId: string, memoryId: string) => boolean;
    close?: () => void;
};

/** Test-only fallback used when the auth service is constructed without persistence. */
export const createInMemoryAccountStore = (): AccountStore => {
    const accounts = new Map<string, FootnoteAccount>();
    const identityMappings = new Map<
        string,
        ExternalIdentityKey & {
            accountId: string;
            createdAt: string;
            lastSeenAt: string;
        }
    >();
    const discordAccountLinks = new Map<string, string>();
    const discordMappingDates = new Map<string, string>();
    const memories = new Map<string, AccountMemory & { accountId: string }>();
    return {
        resolveOrCreateAccount: ({ issuer, subject }) => {
            const key = buildExternalIdentityKey(issuer, subject);
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
            identityMappings.set(key, {
                issuer,
                subject,
                accountId: account.id,
                createdAt: now,
                lastSeenAt: now,
            });
            return account;
        },
        deleteAccount: (accountId) => {
            for (const [key, account] of accounts) {
                if (account.id === accountId) accounts.delete(key);
            }
            for (const [key, identity] of identityMappings) {
                if (identity.accountId === accountId) {
                    identityMappings.delete(key);
                }
            }
            for (const [
                discordUserId,
                linkedAccountId,
            ] of discordAccountLinks) {
                if (linkedAccountId === accountId) {
                    discordAccountLinks.delete(discordUserId);
                    discordMappingDates.delete(discordUserId);
                }
            }
            for (const [id, memory] of memories) {
                if (memory.accountId === accountId) memories.delete(id);
            }
        },
        findAccountByDiscordUserId: (discordUserId) => {
            const accountId = discordAccountLinks.get(discordUserId);
            return accountId
                ? ([...accounts.values()].find(({ id }) => id === accountId) ??
                      null)
                : null;
        },
        linkDiscordUserToAccount: (discordUserId, accountId) => {
            const existing = discordAccountLinks.get(discordUserId);
            if (existing)
                return existing === accountId ? 'already-linked' : 'conflict';
            discordAccountLinks.set(discordUserId, accountId);
            discordMappingDates.set(discordUserId, new Date().toISOString());
            return 'linked';
        },
        getAccountExportData: (accountId) => {
            const account = [...accounts.values()].find(
                ({ id }) => id === accountId
            );
            if (!account) return null;
            return {
                account,
                externalIdentityMappings: [...identityMappings.values()]
                    .filter(({ accountId: ownerId }) => ownerId === accountId)
                    .map(({ issuer, subject, createdAt, lastSeenAt }) => ({
                        issuer,
                        subject,
                        createdAt,
                        lastSeenAt,
                    })),
                discordMappings: [...discordAccountLinks.entries()]
                    .filter(([, ownerId]) => ownerId === accountId)
                    .map(([discordUserId]) => ({
                        discordUserId,
                        createdAt: discordMappingDates.get(discordUserId) ?? '',
                    })),
                memories: [...memories.values()]
                    .filter(({ accountId: ownerId }) => ownerId === accountId)
                    .map(({ id, text, createdAt }) => ({
                        id,
                        text,
                        createdAt,
                    })),
            };
        },
        listMemories: (accountId) =>
            [...memories.values()]
                .filter(({ accountId: ownerId }) => ownerId === accountId)
                .map(({ id, text, createdAt }) => ({ id, text, createdAt })),
        addMemory: (accountId, text) => {
            if (
                [...memories.values()].filter(
                    (memory) => memory.accountId === accountId
                ).length >= MAX_ACCOUNT_MEMORIES
            ) {
                return null;
            }
            const memory = {
                id: randomUUID(),
                text,
                createdAt: new Date().toISOString(),
                accountId,
            };
            memories.set(memory.id, memory);
            return {
                id: memory.id,
                text: memory.text,
                createdAt: memory.createdAt,
            };
        },
        forgetMemory: (accountId, memoryId) => {
            const memory = memories.get(memoryId);
            return memory?.accountId === accountId
                ? memories.delete(memoryId)
                : false;
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
    private readonly findAccountByDiscordUserIdStatement: Database.Statement;
    private readonly linkDiscordUserToAccountStatement: Database.Statement;
    private readonly getAccountByIdStatement: Database.Statement;
    private readonly getIdentityMappingsByAccountIdStatement: Database.Statement;
    private readonly getDiscordMappingsByAccountIdStatement: Database.Statement;
    private readonly deleteAccountStatement: Database.Statement;
    private readonly listMemoriesStatement: Database.Statement;
    private readonly countMemoriesByAccountIdStatement: Database.Statement;
    private readonly addMemoryStatement: Database.Statement;
    private readonly forgetMemoryStatement: Database.Statement;

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
            CREATE TABLE IF NOT EXISTS discord_account_links (
                discord_user_id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_discord_account_links_account_id
                ON discord_account_links(account_id);
            CREATE TABLE IF NOT EXISTS account_memories (
                memory_id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
                memory_text TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_account_memories_account_id
                ON account_memories(account_id, created_at, memory_id);
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
        this.findAccountByDiscordUserIdStatement = this.db.prepare(`
            SELECT a.account_id, a.created_at, a.updated_at
            FROM discord_account_links AS discord_link
            INNER JOIN accounts AS a ON a.account_id = discord_link.account_id
            WHERE discord_link.discord_user_id = ? LIMIT 1
        `);
        this.linkDiscordUserToAccountStatement = this.db.prepare(`
            INSERT INTO discord_account_links(discord_user_id, account_id, created_at)
            VALUES (?, ?, ?)
        `);
        this.getAccountByIdStatement = this.db.prepare(`
            SELECT account_id, created_at, updated_at FROM accounts WHERE account_id = ?
        `);
        this.getIdentityMappingsByAccountIdStatement = this.db.prepare(`
            SELECT issuer, subject, created_at, last_seen_at FROM external_identities
            WHERE account_id = ? ORDER BY created_at, issuer, subject
        `);
        this.getDiscordMappingsByAccountIdStatement = this.db.prepare(`
            SELECT discord_user_id, created_at FROM discord_account_links
            WHERE account_id = ? ORDER BY created_at, discord_user_id
        `);
        this.deleteAccountStatement = this.db.prepare(
            'DELETE FROM accounts WHERE account_id = ?'
        );
        this.listMemoriesStatement = this.db.prepare(
            'SELECT memory_id AS id, memory_text AS text, created_at AS createdAt FROM account_memories WHERE account_id = ? ORDER BY created_at, memory_id'
        );
        this.countMemoriesByAccountIdStatement = this.db.prepare(
            'SELECT COUNT(*) AS count FROM account_memories WHERE account_id = ?'
        );
        this.addMemoryStatement = this.db.prepare(
            'INSERT INTO account_memories(memory_id, account_id, memory_text, created_at) VALUES (?, ?, ?, ?)'
        );
        this.forgetMemoryStatement = this.db.prepare(
            'DELETE FROM account_memories WHERE account_id = ? AND memory_id = ?'
        );
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

    /** Resolves the backend-owned account for a stable Discord snowflake. */
    findAccountByDiscordUserId(discordUserId: string): FootnoteAccount | null {
        const row = this.findAccountByDiscordUserIdStatement.get(
            discordUserId
        ) as AccountRow | undefined;
        return row
            ? {
                  id: row.account_id,
                  createdAt: row.created_at,
                  updatedAt: row.updated_at,
              }
            : null;
    }

    /** Atomically adds a Discord mapping without moving or merging identities. */
    linkDiscordUserToAccount(
        discordUserId: string,
        accountId: string
    ): 'linked' | 'already-linked' | 'conflict' {
        return this.db
            .transaction(() => {
                const existing = this.findAccountByDiscordUserIdStatement.get(
                    discordUserId
                ) as AccountRow | undefined;
                if (existing)
                    return existing.account_id === accountId
                        ? 'already-linked'
                        : 'conflict';
                this.linkDiscordUserToAccountStatement.run(
                    discordUserId,
                    accountId,
                    new Date().toISOString()
                );
                return 'linked';
            })
            .immediate();
    }

    /** Returns only retained identity records owned by the requested account. */
    getAccountExportData(accountId: string): AccountExportData | null {
        const account = this.getAccountByIdStatement.get(accountId) as
            AccountRow | undefined;
        if (!account) return null;
        const identities = this.getIdentityMappingsByAccountIdStatement.all(
            accountId
        ) as Array<{
            issuer: string;
            subject: string;
            created_at: string;
            last_seen_at: string;
        }>;
        const discordMappings = this.getDiscordMappingsByAccountIdStatement.all(
            accountId
        ) as Array<{ discord_user_id: string; created_at: string }>;
        return {
            account: {
                id: account.account_id,
                createdAt: account.created_at,
                updatedAt: account.updated_at,
            },
            externalIdentityMappings: identities.map((row) => ({
                issuer: row.issuer,
                subject: row.subject,
                createdAt: row.created_at,
                lastSeenAt: row.last_seen_at,
            })),
            discordMappings: discordMappings.map((row) => ({
                discordUserId: row.discord_user_id,
                createdAt: row.created_at,
            })),
            memories: this.listMemories(accountId),
        };
    }

    listMemories(accountId: string): AccountMemory[] {
        return this.listMemoriesStatement.all(accountId) as AccountMemory[];
    }

    addMemory(accountId: string, text: string): AccountMemory | null {
        const memory = {
            id: randomUUID(),
            text,
            createdAt: new Date().toISOString(),
        };
        const add = this.db.transaction(() => {
            const count = this.countMemoriesByAccountIdStatement.get(
                accountId
            ) as { count: number };
            if (count.count >= MAX_ACCOUNT_MEMORIES) return false;
            this.addMemoryStatement.run(
                memory.id,
                accountId,
                text,
                memory.createdAt
            );
            return true;
        });
        return add.immediate() ? memory : null;
    }

    forgetMemory(accountId: string, memoryId: string): boolean {
        return this.forgetMemoryStatement.run(accountId, memoryId).changes > 0;
    }

    /** Deletes the account and its provider/Discord mappings; missing accounts are already deleted. */
    deleteAccount(accountId: string): void {
        this.deleteAccountStatement.run(accountId);
    }

    close(): void {
        this.db.close();
    }
}
