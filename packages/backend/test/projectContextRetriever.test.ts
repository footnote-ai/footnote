/**
 * @description: Covers project-context retrieval: index build, last-known-good fallback, and query embedding failure.
 * @footnote-scope: test
 * @footnote-module: ProjectContextRetrieverTests
 * @footnote-risk: medium - Missing tests could hide stale-index or silent-failure behavior.
 * @footnote-ethics: high - Retrieval facts feed provenance, so failures must stay observable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createProjectContextRetriever,
    type ProjectContextRetrieverOptions,
} from '../src/services/contextIntegrations/projectContext/retriever.js';
import type { ProjectDocumentSource } from '../src/services/contextIntegrations/projectContext/documentLoader.js';
import type { ProjectIndexIdentity } from '../src/services/contextIntegrations/projectContext/vectorStore.js';
import type { EmbeddingRuntimeResult } from '@footnote/agent-runtime';

const identity: ProjectIndexIdentity = {
    provider: 'openai',
    model: 'text-embedding-3-small',
    chunkerVersion: 1,
    indexVersion: 1,
};

const documents: ProjectDocumentSource[] = [
    {
        path: 'docs/Philosophy.md',
        content: '# Philosophy\nFootnote is transparency-first.',
    },
    {
        path: 'docs/status/plan.md',
        content: '# Plan\nTrustGraph loading is not implemented yet.',
    },
];

const embedSuccess = (texts: string[]): EmbeddingRuntimeResult => ({
    status: 'success',
    embeddings: texts.map((text) => [
        text.includes('transparency') ? 1 : 0,
        text.includes('Plan') ? 1 : 0,
    ]),
    model: identity.model,
    provider: identity.provider,
    texts,
    generationTimeMs: 1,
});

const createRetriever = (
    overrides: Partial<ProjectContextRetrieverOptions> = {}
) =>
    createProjectContextRetriever({
        identity,
        resolveDocuments: async () => documents,
        embedTexts: async (texts) => embedSuccess(texts),
        maxChunkBytes: 2000,
        maxChunks: 100,
        topKPerCategory: 5,
        now: () => 1_755_000_000_000,
        ...overrides,
    });

test('retriever builds an index and returns ranked facts for a query', async () => {
    const retriever = createRetriever();
    const outcome = await retriever.retrieve(
        'How does Footnote handle provenance?',
        ['documented_intent']
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.status, 'current');
    assert.equal(outcome.indexedAt, '2025-08-12T12:00:00.000Z');
    assert.ok(outcome.matches.length >= 1);
    for (const match of outcome.matches) {
        assert.equal(match.category, 'documented_intent');
        assert.ok(typeof match.text === 'string');
        assert.ok(typeof match.contentHash === 'string');
    }
});

test('retriever surfaces query-embedding failure as an observable error', async () => {
    let embedCalls = 0;
    const retriever = createRetriever({
        embedTexts: async (texts) => {
            embedCalls += 1;
            // The first call embeds the complete index batch; the second is the query.
            if (embedCalls > 1) {
                return {
                    status: 'error',
                    reason: 'Embedding request failed: upstream down',
                };
            }
            return embedSuccess(texts);
        },
    });
    const outcome = await retriever.retrieve('What is Footnote?', [
        'documented_intent',
    ]);
    assert.equal(embedCalls, 2);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
        assert.match(outcome.reason, /query embedding/i);
    }
});

test('retriever reuses an unchanged index without re-embedding documents', async () => {
    let embedCalls = 0;
    const retriever = createRetriever({
        embedTexts: async (texts) => {
            embedCalls += 1;
            return embedSuccess(texts);
        },
    });

    await retriever.retrieve('Footnote transparency', ['documented_intent']);
    await retriever.retrieve('What is Footnote?', ['documented_intent']);

    assert.equal(embedCalls, 3);
});

test('retriever falls back to last-known-good index when rebuild fails', async () => {
    let failRebuild = false;
    const retriever = createRetriever({
        resolveDocuments: async () => {
            if (failRebuild) throw new Error('disk read failed');
            return documents;
        },
        embedTexts: async (texts) => embedSuccess(texts),
    });
    const first = await retriever.retrieve('Footnote transparency', [
        'documented_intent',
    ]);
    assert.equal(first.ok, true);
    failRebuild = true;
    const stale = await retriever.retrieve('Footnote transparency', [
        'documented_intent',
    ]);
    assert.equal(stale.ok, true);
    if (stale.ok) {
        assert.equal(stale.status, 'stale');
        assert.equal(stale.indexedAt, '2025-08-12T12:00:00.000Z');
        assert.ok(stale.matches.length >= 1);
    }
});

test('retriever returns no matches when no category intersects the index', async () => {
    const retriever = createRetriever({
        resolveDocuments: async () => [
            {
                path: 'docs/Philosophy.md',
                content: '# Philosophy\nNo status here.',
            },
        ],
    });
    const outcome = await retriever.retrieve('anything', ['current_state']);
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
        assert.deepEqual(outcome.matches, []);
    }
});
