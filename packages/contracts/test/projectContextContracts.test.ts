/**
 * @description: Verifies the project-context contract surface stays narrow and serializable.
 * @footnote-scope: test
 * @footnote-module: ProjectContextContractsTests
 * @footnote-risk: low - Tests only cover deterministic type-surface and identity rules.
 * @footnote-ethics: high - Project-context provenance labels decide how claims get attributed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CONTEXT_INTEGRATION_NAMES,
    PROJECT_CONTEXT_CATEGORIES,
    type ProjectContextCategory,
    type ProjectContextMatch,
    type ProjectContextMetadata,
} from '../src/policy';

test('CONTEXT_INTEGRATION_NAMES includes project_context for routing', () => {
    assert.ok(
        (CONTEXT_INTEGRATION_NAMES as readonly string[]).includes(
            'project_context'
        )
    );
});

test('PROJECT_CONTEXT_CATEGORIES exposes the supported evidence categories', () => {
    assert.deepEqual(PROJECT_CONTEXT_CATEGORIES, [
        'documented_intent',
        'documented_behavior',
        'current_state',
    ]);
    for (const category of PROJECT_CONTEXT_CATEGORIES) {
        assert.equal(typeof category, 'string');
    }
});

test('ProjectContextMatch serializes to plain JSON fields', () => {
    const match: ProjectContextMatch = {
        category: 'documented_intent',
        path: 'docs/Philosophy.md',
        contentHash: 'sha256:abc123',
        text: 'Footnote prioritizes provenance and human oversight.',
        score: 0.87,
    };
    const serialized = JSON.parse(JSON.stringify(match));
    assert.equal(serialized.category, 'documented_intent');
    assert.equal(serialized.path, 'docs/Philosophy.md');
    assert.equal(serialized.text, match.text);
    assert.equal(serialized.score, 0.87);
});

test('ProjectContextMatch keeps provenance-independent retrieval facts together', () => {
    const match: ProjectContextMatch = {
        category: 'current_state',
        path: 'docs/status/repository-context-status.md',
        contentHash: 'sha256:def456',
        text: 'TrustGraph loading is not implemented yet.',
        score: 0.62,
        revisionLabel: 'docs/status/repository-context-status.md@abc',
    };
    assert.equal(match.category, 'current_state');
    assert.equal(match.contentHash, 'sha256:def456');
});

test('ProjectContextMetadata exposes bounded index identity facts', () => {
    const metadata: ProjectContextMetadata = {
        repository: 'footnote-ai/footnote',
        provider: 'openai',
        model: 'text-embedding-3-small',
        chunkerVersion: 1,
        indexVersion: 1,
        requestedCategories: ['documented_intent'],
        returnedCounts: { documented_intent: 2 },
        maxChunks: 200,
        topKPerCategory: 5,
        status: 'current',
        reasonCodes: [],
    };
    assert.equal(metadata.provider, 'openai');
    assert.equal(metadata.model, 'text-embedding-3-small');
    assert.equal(metadata.status, 'current');
    const roundTrip = JSON.parse(JSON.stringify(metadata));
    assert.deepEqual(roundTrip.returnedCounts, { documented_intent: 2 });
});

test('ProjectContextCategory is a narrow additive string union', () => {
    const categories = new Set<string>(PROJECT_CONTEXT_CATEGORIES);
    const category: ProjectContextCategory = 'documented_behavior';
    assert.ok(categories.has(category));
});
