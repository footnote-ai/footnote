/**
 * @description: Persists the minimal state required to recover interrupted Discord-facing work.
 * It intentionally stores only delivery identifiers and lifecycle metadata, never prompts or generated artifacts.
 * @footnote-scope: utility
 * @footnote-module: SqliteRecoverableTaskStore
 * @footnote-risk: medium - Incorrect transitions could leave public Discord replies in an unclear state.
 * @footnote-ethics: high - The store deliberately excludes user prompts and image data to minimize retained content.
 */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
    RecoverableTask,
    RecoverableTaskKind,
    RecoverableTaskState,
} from '@footnote/contracts/web';

const TERMINAL_TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type CreateRecoverableTaskInput = {
    kind: RecoverableTaskKind;
    botProfileId: string;
    discordChannelId: string;
    discordMessageId: string;
};

type RecoverableTaskRow = {
    id: string;
    kind: RecoverableTaskKind;
    state: RecoverableTaskState;
    bot_profile_id: string;
    discord_channel_id: string;
    discord_message_id: string;
    created_at: string;
    updated_at: string;
};

const toTask = (row: RecoverableTaskRow): RecoverableTask => ({
    id: row.id,
    kind: row.kind,
    state: row.state,
    botProfileId: row.bot_profile_id,
    discordChannelId: row.discord_channel_id,
    discordMessageId: row.discord_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

/** SQLite store for state-only recovery records. */
export class SqliteRecoverableTaskStore {
    private readonly db: Database.Database;

    public constructor({ dbPath }: { dbPath: string }) {
        const resolvedPath = path.resolve(dbPath);
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
        this.db = new Database(resolvedPath);
        this.db.pragma('journal_mode = WAL');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS recoverable_tasks (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                state TEXT NOT NULL,
                bot_profile_id TEXT NOT NULL,
                discord_channel_id TEXT NOT NULL,
                discord_message_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                CHECK (kind IN ('image_generation')),
                CHECK (state IN ('started', 'complete', 'failed'))
            );
            CREATE INDEX IF NOT EXISTS idx_recoverable_tasks_profile_state
                ON recoverable_tasks (bot_profile_id, state);
            CREATE INDEX IF NOT EXISTS idx_recoverable_tasks_updated_at
                ON recoverable_tasks (updated_at);
        `);
        this.removeExpiredTerminalTasks();
    }

    /** Removes expired terminal records while preserving active delivery recovery. */
    private removeExpiredTerminalTasks(nowMs: number = Date.now()): void {
        const expiresBefore = new Date(
            nowMs - TERMINAL_TASK_RETENTION_MS
        ).toISOString();
        this.db
            .prepare(
                `DELETE FROM recoverable_tasks
                 WHERE state IN ('complete', 'failed') AND updated_at < ?`
            )
            .run(expiresBefore);
    }

    /** Creates one new task after the public Discord reply exists. */
    public create(input: CreateRecoverableTaskInput): RecoverableTask {
        this.removeExpiredTerminalTasks();
        const now = new Date().toISOString();
        const task: RecoverableTask = {
            id: crypto.randomUUID(),
            kind: input.kind,
            state: 'started',
            botProfileId: input.botProfileId,
            discordChannelId: input.discordChannelId,
            discordMessageId: input.discordMessageId,
            createdAt: now,
            updatedAt: now,
        };
        this.db
            .prepare(
                `INSERT INTO recoverable_tasks (
                    id, kind, state, bot_profile_id, discord_channel_id,
                    discord_message_id, created_at, updated_at
                ) VALUES (
                    @id, @kind, @state, @botProfileId, @discordChannelId,
                    @discordMessageId, @createdAt, @updatedAt
                )`
            )
            .run(task);
        return task;
    }

    /** Marks a started task terminally. Repeated terminal calls are idempotent. */
    public finish(
        taskId: string,
        state: Extract<RecoverableTaskState, 'complete' | 'failed'>
    ): { task: RecoverableTask | null; changed: boolean } {
        const finishTask = this.db.transaction(
            (
                id: string,
                terminalState: Extract<
                    RecoverableTaskState,
                    'complete' | 'failed'
                >
            ) => {
                const result = this.db
                    .prepare(
                        `UPDATE recoverable_tasks
                         SET state = ?, updated_at = ?
                         WHERE id = ? AND state = 'started'`
                    )
                    .run(terminalState, new Date().toISOString(), id);
                const row = this.db
                    .prepare('SELECT * FROM recoverable_tasks WHERE id = ?')
                    .get(id) as RecoverableTaskRow | undefined;
                return {
                    task: row ? toTask(row) : null,
                    changed: result.changes > 0,
                };
            }
        );
        return finishTask(taskId, state);
    }

    /**
     * Atomically claims all unfinished tasks for one bot profile by making them
     * terminal failures before Discord reconciliation begins. This makes a
     * repeated startup safe and never re-runs provider work.
     */
    public claimUnfinishedForBotProfile(
        botProfileId: string
    ): RecoverableTask[] {
        this.removeExpiredTerminalTasks();
        const claim = this.db.transaction((profileId: string) => {
            const rows = this.db
                .prepare(
                    `SELECT * FROM recoverable_tasks
                     WHERE bot_profile_id = ? AND state = 'started'
                     ORDER BY created_at ASC`
                )
                .all(profileId) as RecoverableTaskRow[];
            if (rows.length === 0) {
                return [] as RecoverableTask[];
            }
            const now = new Date().toISOString();
            const update = this.db.prepare(
                `UPDATE recoverable_tasks
                 SET state = 'failed', updated_at = ?
                 WHERE id = ? AND state = 'started'`
            );
            return rows.flatMap((row) =>
                update.run(now, row.id).changes > 0
                    ? [toTask({ ...row, state: 'failed', updated_at: now })]
                    : []
            );
        });
        return claim(botProfileId);
    }

    public close(): void {
        this.db.close();
    }

    public checkpointWalTruncate(): void {
        this.db.pragma('wal_checkpoint(TRUNCATE)');
    }
}
