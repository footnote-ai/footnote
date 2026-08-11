/**
 * @description: Verifies the SQLite recoverable-task store only retains delivery recovery metadata.
 * @footnote-scope: test
 * @footnote-module: RecoverableTaskStoreTests
 * @footnote-risk: medium - Missing lifecycle tests could strand Discord replies after a restart.
 * @footnote-ethics: high - Confirms prompts and image artifacts cannot enter the recovery schema.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SqliteRecoverableTaskStore } from '../src/storage/recoverableTaskStore.js';

const withStore = async (
    run: (
        store: SqliteRecoverableTaskStore,
        dbPath: string
    ) => void | Promise<void>
): Promise<void> => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-recovery-')
    );
    const dbPath = path.join(directory, 'recoverable.db');
    const store = new SqliteRecoverableTaskStore({ dbPath });
    try {
        await run(store, dbPath);
    } finally {
        store.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
};

test('recoverable task store transitions once and makes terminal retries idempotent', async () => {
    await withStore((store) => {
        const task = store.create({
            kind: 'image_generation',
            botProfileId: 'bot-a',
            discordChannelId: 'channel-a',
            discordMessageId: 'message-a',
        });
        const complete = store.finish(task.id, 'complete');
        assert.equal(complete.changed, true);
        assert.equal(complete.task?.state, 'complete');
        const repeated = store.finish(task.id, 'complete');
        assert.equal(repeated.changed, false);
        assert.equal(repeated.task?.state, 'complete');
        const failedAfterComplete = store.finish(task.id, 'failed');
        assert.equal(failedAfterComplete.changed, false);
        assert.equal(failedAfterComplete.task?.state, 'complete');
    });
});

test('recoverable task claim is profile-scoped and terminalizes claimed stale tasks', async () => {
    await withStore((store) => {
        const own = store.create({
            kind: 'image_generation',
            botProfileId: 'bot-a',
            discordChannelId: 'channel-a',
            discordMessageId: 'message-a',
        });
        const other = store.create({
            kind: 'image_generation',
            botProfileId: 'bot-b',
            discordChannelId: 'channel-b',
            discordMessageId: 'message-b',
        });
        const claimed = store.claimUnfinishedForBotProfile('bot-a');
        assert.deepEqual(
            claimed.map((task) => task.id),
            [own.id]
        );
        assert.equal(claimed[0]?.state, 'failed');
        assert.deepEqual(store.claimUnfinishedForBotProfile('bot-a'), []);
        assert.equal(store.finish(other.id, 'complete').changed, true);
    });
});

test('recoverable task table has no prompt or artifact columns', async () => {
    await withStore((store, dbPath) => {
        store.create({
            kind: 'image_generation',
            botProfileId: 'bot-a',
            discordChannelId: 'channel-a',
            discordMessageId: 'message-a',
        });
        const db = new Database(dbPath);
        try {
            const columns = db
                .prepare('PRAGMA table_info(recoverable_tasks)')
                .all() as Array<{ name: string }>;
            assert.equal(
                columns.some((column) =>
                    /prompt|image|artifact|error/i.test(column.name)
                ),
                false
            );
            const insert = db.prepare(`
                INSERT INTO recoverable_tasks (
                    id, kind, state, bot_profile_id, discord_channel_id,
                    discord_message_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const now = new Date().toISOString();
            assert.throws(
                () =>
                    insert.run(
                        'invalid-kind',
                        'unsupported',
                        'started',
                        'bot-a',
                        'channel-a',
                        'message-a',
                        now,
                        now
                    ),
                /CHECK constraint failed/
            );
            assert.throws(
                () =>
                    insert.run(
                        'invalid-state',
                        'image_generation',
                        'unknown',
                        'bot-a',
                        'channel-a',
                        'message-a',
                        now,
                        now
                    ),
                /CHECK constraint failed/
            );
        } finally {
            db.close();
        }
    });
});
