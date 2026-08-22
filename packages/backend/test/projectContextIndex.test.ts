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
import { selectProjectContextChunks } from '../src/services/contextIntegrations/projectContext/retriever.js';

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
    assert.equal(
        defaultCategoryForPath('docs/status.md.bak'),
        'documented_intent'
    );
    assert.equal(defaultCategoryForPath('docs/status.md'), 'current_state');
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

test('chunk selection rotates categories so a bounded index retains current-state evidence', () => {
    const chunks = selectProjectContextChunks(
        [
            {
                path: 'README.md',
                category: 'documented_intent',
                content: '# Intent\n'.concat('intent '.repeat(40)),
            },
            {
                path: 'docs/architecture/workflow.md',
                category: 'documented_behavior',
                content: '# Behavior\n'.concat('behavior '.repeat(40)),
            },
            {
                path: 'docs/status/repository-context-status.md',
                category: 'current_state',
                content: '# State\n'.concat('state '.repeat(40)),
            },
        ],
        { maxChunkBytes: 40, maxChunks: 6 }
    );
    assert.deepEqual(
        [...new Set(chunks.map((chunk) => chunk.category))].sort(),
        ['current_state', 'documented_behavior', 'documented_intent']
    );
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

test('chunkProjectDocument enforces UTF-8 byte caps and preserves fenced headings', () => {
    const chunks = chunkProjectDocument(
        {
            path: 'docs/architecture/workflow.md',
            content: [
                '# Example',
                '```md',
                '# not a heading',
                '🙂🙂🙂',
                '```',
            ].join('\n'),
        },
        {
            maxChunkBytes: 64,
            categoryForPath: defaultCategoryForPath,
        }
    );

    assert.equal(chunks.length, 1);
    assert.match(chunks[0]?.text ?? '', /# not a heading/);
    assert.ok(Buffer.byteLength(chunks[0]?.text ?? '', 'utf8') <= 64);
    const unicodeChunks = chunkProjectDocument(
        { path: 'docs/architecture/unicode.md', content: '🙂'.repeat(20) },
        { maxChunkBytes: 16, categoryForPath: defaultCategoryForPath }
    );
    assert.ok(unicodeChunks.length > 1);
    assert.ok(
        unicodeChunks.every(
            (chunk) => Buffer.byteLength(chunk.text, 'utf8') <= 16
        )
    );
});

test('vector store upserts chunks keyed by chunk id', () => {
    const store = createProjectVectorStore({ identity, maxChunks: 100 });
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
    store.upsert([
        {
            ...chunk,
            text: 'Replacement chunk.',
            contentHash: 'sha256:replacement',
        },
    ]);
    assert.equal(
        store.search([1, 0, 0], ['documented_intent'], 5)[0]?.text,
        'Replacement chunk.'
    );
});

test('vector store search filters by category and returns cosine scores', () => {
    const store = createProjectVectorStore({ identity, maxChunks: 100 });
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

test('vector store applies topK independently within each category', () => {
    const store = createProjectVectorStore({ identity, maxChunks: 100 });
    store.upsert([
        {
            id: 'intent-a#0',
            path: 'docs/Philosophy.md',
            category: 'documented_intent',
            contentHash: 'sha256:intent-a',
            text: 'intent a',
            embedding: [1, 0, 0],
        },
        {
            id: 'intent-b#0',
            path: 'docs/Goals.md',
            category: 'documented_intent',
            contentHash: 'sha256:intent-b',
            text: 'intent b',
            embedding: [0.9, 0, 0],
        },
        {
            id: 'state-a#0',
            path: 'docs/status/plan.md',
            category: 'current_state',
            contentHash: 'sha256:state-a',
            text: 'state a',
            embedding: [0.8, 0, 0],
        },
        {
            id: 'state-b#0',
            path: 'docs/status/recent.md',
            category: 'current_state',
            contentHash: 'sha256:state-b',
            text: 'state b',
            embedding: [0.7, 0, 0],
        },
    ]);

    const matches = store.search(
        [1, 0, 0],
        ['documented_intent', 'current_state'],
        1
    );
    assert.deepEqual(
        matches.map((match) => match.path),
        ['docs/Philosophy.md', 'docs/status/plan.md']
    );
});

test('vector store applies a global relevance budget and removes duplicate evidence', () => {
    const store = createProjectVectorStore({ identity, maxChunks: 100 });
    store.upsert([
        {
            id: 'best#0',
            path: 'docs/status/best.md',
            category: 'current_state',
            contentHash: 'sha256:duplicate',
            text: 'best evidence',
            embedding: [1, 0, 0],
        },
        {
            id: 'duplicate#0',
            path: 'docs/status/copy.md',
            category: 'current_state',
            contentHash: 'sha256:duplicate',
            text: 'same evidence',
            embedding: [0.99, 0, 0],
        },
        {
            id: 'weak#0',
            path: 'docs/status/weak.md',
            category: 'current_state',
            contentHash: 'sha256:weak',
            text: 'weak evidence',
            embedding: [0, 1, 0],
        },
    ]);
    const matches = store.search(
        [1, 0, 0],
        ['current_state'],
        5,
        identity,
        0.5,
        1
    );
    assert.deepEqual(
        matches.map((match) => match.path),
        ['docs/status/best.md']
    );
});

test('vector store skips embeddings with mismatched dimensions', () => {
    const store = createProjectVectorStore({ identity, maxChunks: 100 });
    store.upsert([
        {
            id: 'mismatch#0',
            path: 'docs/Philosophy.md',
            category: 'documented_intent',
            contentHash: 'sha256:mismatch',
            text: 'mismatch',
            embedding: [1, 0],
        },
    ]);
    assert.deepEqual(store.search([1, 0, 0], ['documented_intent'], 5), []);
});

test('vector store rejects queries with a different index identity', () => {
    const store = createProjectVectorStore({ identity, maxChunks: 100 });
    store.upsert([
        {
            id: 'identity#0',
            path: 'docs/Philosophy.md',
            category: 'documented_intent',
            contentHash: 'sha256:identity',
            text: 'identity',
            embedding: [1, 0, 0],
        },
    ]);
    assert.deepEqual(
        store.search([1, 0, 0], ['documented_intent'], 5, {
            ...identity,
            model: 'other-model',
        }),
        []
    );
});

test('vector store enforces its bounded chunk capacity deterministically', () => {
    const store = createProjectVectorStore({ identity, maxChunks: 2 });
    store.upsert([
        {
            id: 'first#0',
            path: 'docs/first.md',
            category: 'documented_intent',
            contentHash: 'sha256:first',
            text: 'first',
            embedding: [1, 0, 0],
        },
        {
            id: 'second#0',
            path: 'docs/second.md',
            category: 'documented_intent',
            contentHash: 'sha256:second',
            text: 'second',
            embedding: [0.9, 0, 0],
        },
        {
            id: 'third#0',
            path: 'docs/third.md',
            category: 'documented_intent',
            contentHash: 'sha256:third',
            text: 'third',
            embedding: [0.8, 0, 0],
        },
    ]);

    assert.equal(store.chunkCount(), 2);
    assert.deepEqual(
        store
            .search([1, 0, 0], ['documented_intent'], 5)
            .map((match) => match.path),
        ['docs/second.md', 'docs/third.md']
    );
});

test('vector store keeps last-known-good chunks when identity changes', () => {
    const store = createProjectVectorStore({ identity, maxChunks: 100 });
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
        maxChunks: 100,
    });
    assert.equal(rebuilt.identity.chunkerVersion, 2);
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
    assert.equal(store.chunkCount(), 1);
});
