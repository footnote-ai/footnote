/**
 * @description: Verifies reserved landing conversation persistence in the SQLite trace store.
 * @footnote-scope: test
 * @footnote-module: SqliteTraceStoreTests
 * @footnote-risk: medium - Storage regressions can break prepared examples or trace lookup.
 * @footnote-ethics: high - Reserved examples must stay aligned with their provenance traces.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteTraceStore } from './sqliteTraceStore.js';
import { loadPreparedLandingConversationSeeds } from '../../data/preparedLandingConversations.js';

const createTempStore = (): { store: SqliteTraceStore; directory: string } => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-trace-store-')
    );
    return {
        store: new SqliteTraceStore({
            dbPath: path.join(directory, 'provenance.db'),
        }),
        directory,
    };
};

test('reserved landing conversations seed idempotently with retrievable traces', async () => {
    const { store, directory } = createTempStore();
    try {
        const seeds = loadPreparedLandingConversationSeeds().slice(0, 2);

        store.seedReservedLandingConversations(seeds);
        store.seedReservedLandingConversations(seeds);

        const conversations = await store.listReservedLandingConversations();
        assert.equal(conversations.length, 2);
        assert.deepEqual(
            conversations.map((conversation) => conversation.scenarioId),
            seeds.map((seed) => seed.scenarioId)
        );

        for (const [index, conversation] of conversations.entries()) {
            const seed = seeds[index]!;
            assert.equal(conversation.threadId, seed.threadId);
            assert.equal(conversation.question, seed.question);
            assert.equal(
                conversation.response.metadata.responseId,
                seed.response.metadata.responseId
            );
            assert.equal(conversation.response.message, seed.response.message);

            const metadata = await store.retrieve(
                seed.response.metadata.responseId
            );
            assert.equal(metadata?.responseId, seed.response.metadata.responseId);
        }
    } finally {
        store.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
