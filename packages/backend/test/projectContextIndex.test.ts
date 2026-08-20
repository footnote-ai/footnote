/**
 * @description: Covers project-document loading, chunking, category assignment, and vector-store identity.
 * @footnote-scope: test
 * @footnote-module: ProjectContextIndexTests
 * @footnote-risk: medium - Missing tests could let chunk identity or stale-index behavior drift silently.
 * @footnote-ethics: high - Evidence categories and index identity decide how claims get attributed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    chunkProjectDocument,
    defaultCategoryForPath,
    type ProjectDocumentSource,
} from '../src/services/contextIntegrations/projectContext/documentLoader.js';
import {
    createProjectVectorStore,
    type ProjectIndexIdentity,
    type StoredProjectChunk,
} from '../src/services/contextIntegrations/projectContext/vectorStore.js';

const identity: ProjectIndexIdentity = {
    provider: 'openai',
    model: 'text-embedding-3-small',
    chunkerVersion: 1,
    indexVersion: 1,
};

test('defaultCategoryForPath labels status docs as current state, not intent', () => {
    assert.equal(
        defaultCategoryForPath('docs/status/repository-context-status.md'),
        'current_state'
    );
});

test('defaultCategoryForPath labels architecture docs as documented behavior', () => {
    assert.equal(
        defaultCategoryForPath('docs/architecture/workflow.md'),
        'documented_behavior'
    );
});

test('defaultCategoryForPath labels philosophy and agent docs as documented intent', () => {
    assert.equal(
        defaultCategoryForPath('docs/Philosophy.md'),
        'documented_intent'
    );
    assert.equal(defaultCategoryForPath('AGENTS.md'), 'documented_intent');
});

test('chunkProjectDocument splits by markdown headings and keeps heading context', () => {
    const source: ProjectDocumentSource = {
        path: 'docs/Philosophy.md',
        content: [
            '# Philosophy',
            'Footnote is transparency-first.',
            '',
            '## Provenance',
            'Bring the receipts.',
        ].join('\n'),
    };
    const chunks = chunkProjectDocument(source, {
        maxChunkBytes: 2000,
        categoryForPath: defaultCategoryForPath,
    });
    assert.ok(chunks.length >= 2);
    const provenanceChunk = chunks.find((chunk) =>
        chunk.text.includes('## Provenance')
    );
    assert.ok(provenanceChunk);
    assert.match(provenanceChunk?.text ?? '', /Bring the receipts/);
    for (const chunk of chunks) {
        assert.equal(chunk.category, 'documented_intent');
        assert.equal(chunk.path, 'docs/Philosophy.md');
        assert.ok(chunk.contentHash.length > 0);
        assert.ok(chunk.id.length > 0);
    }
});

test('chunkProjectDocument caps chunk size and produces stable ids', () => {
    const source: ProjectDocumentSource = {
        path: 'docs/architecture/workflow.md',
        content: 'word '.repeat(10_000),
    };
    const first = chunkProjectDocument(source, {
        maxChunkBytes: 1024,
        categoryForPath: defaultCategoryForPath,
    });
    const second = chunkProjectDocument(source, {
        maxChunkBytes: 1024,
        categoryForPath: defaultCategoryForPath,
    });
    assert.ok(first.length > 1);
    for (const chunk of first) {
        assert.ok(Buffer.byteLength(chunk.text, 'utf8') <= 1024);
        assert.equal(chunk.category, 'documented_behavior');
    }
    assert.deepEqual(
        first.map((chunk) => chunk.id),
        second.map((chunk) => chunk.id)
    );
    assert.deepEqual(
        first.map((chunk) => chunk.contentHash),
        second.map((chunk) => chunk.contentHash)
    );
});

test('vector store upserts chunks keyed by identity and content hash', () => {
    const store = createProjectVectorStore({ identity });
    const chunk: StoredProjectChunk = {
        id: 'docs/Philosophy.md#0',
        path: 'docs/Philosophy.md',
        category: 'documented_intent',
        contentHash: 'sha256:abc',
        text: 'Footnote is transparency-first.',
        embedding: [1, 0, 0],
    };
    store.upsert([chunk]);
    const matches = store.search([1, 0, 0], ['documented_intent'], 5);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.path, 'docs/Philosophy.md');
    assert.equal(matches[0]?.text, 'Footnote is transparency-first.');
});

test('vector store search filters by category and returns cosine scores', () => {
    const store = createProjectVectorStore({ identity });
    store.upsert([
        {
            id: 'a#0',
            path: 'docs/Philosophy.md',
            category: 'documented_intent',
            contentHash: 'sha256:a',
            text: 'intent chunk',
            embedding: [1, 0, 0],
        },
        {
            id: 'b#0',
            path: 'docs/status/plan.md',
            category: 'current_state',
            contentHash: 'sha256:b',
            text: 'state chunk',
            embedding: [0, 1, 0],
        },
    ]);
    const intentMatches = store.search([1, 0, 0], ['documented_intent'], 5);
    assert.equal(intentMatches.length, 1);
    assert.equal(intentMatches[0]?.path, 'docs/Philosophy.md');
    const stateMatches = store.search([1, 0, 0], ['current_state'], 5);
    assert.equal(stateMatches.length, 1);
    assert.equal(stateMatches[0]?.path, 'docs/status/plan.md');
    assert.equal(typeof stateMatches[0]?.score, 'number');
});

test('vector store keeps last-known-good chunks when identity changes', () => {
    const store = createProjectVectorStore({ identity });
    store.upsert([
        {
            id: 'a#0',
            path: 'docs/Philosophy.md',
            category: 'documented_intent',
            contentHash: 'sha256:abc',
            text: 'original chunk',
            embedding: [1, 0, 0],
        },
    ]);
    const rebuilt = createProjectVectorStore({
        identity: {
            ...identity,
            chunkerVersion: 2,
        },
    });
    rebuilt.upsert([
        {
            id: 'a#0',
            path: 'docs/Philosophy.md',
            category: 'documented_intent',
            contentHash: 'sha256:abc',
            text: 'original chunk',
            embedding: [1, 0, 0],
        },
    ]);
    const originalMatches = store.search([1, 0, 0], ['documented_intent'], 5);
    assert.equal(originalMatches.length, 1);
    assert.equal(originalMatches[0]?.text, 'original chunk');
});
