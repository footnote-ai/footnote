/**
 * @description: Covers fixed image-context expiry, conversation scoping, and ambiguity.
 * @footnote-scope: test
 * @footnote-module: ConversationImageContextStoreTests
 * @footnote-risk: low - Tests protect bounded backend context reuse behavior.
 * @footnote-ethics: medium - Tests guard image-derived context retention boundaries.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationImageContextStore } from '../src/services/contextIntegrations/fileScanning/conversationImageContextStore.js';
import type { ContextStepResult } from '../src/services/workflowCore/reviewedChatWorkflow.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const scope = { surface: 'web', sessionId: 'session-a', userId: 'user-a' };
const result: ContextStepResult = {
    outcome: 'executed',
    executionContext: { toolName: 'file_scan', status: 'executed' },
    evidence: { content: ['a bounded image description'] },
};

test('image context is conversation-scoped and expires at a fixed 24 hours', () => {
    const store = new ConversationImageContextStore();
    store.record({
        scope,
        imageUrl: 'https://images.test/a',
        result,
        now: 1_000,
    });

    assert.equal(
        store.lookup({
            scope,
            toolName: 'file_scan',
            refersToImage: true,
            refresh: false,
            now: 1_000 + DAY_MS - 1,
        }).status,
        'reused'
    );
    store.record({
        scope,
        imageUrl: 'https://images.test/b',
        result,
        now: 2_000,
    });
    assert.equal(
        store.lookup({
            scope: { ...scope, sessionId: 'another-session' },
            toolName: 'file_scan',
            refersToImage: true,
            refresh: false,
            now: 2_000,
        }).status,
        'unavailable'
    );
    assert.equal(
        store.lookup({
            scope: { ...scope, userId: 'other-user' },
            toolName: 'file_scan',
            refersToImage: true,
            refresh: false,
            now: 2_000,
        }).status,
        'unavailable'
    );
    assert.equal(
        store.lookup({
            scope,
            toolName: 'file_scan',
            imageUrl: 'https://images.test/a',
            refersToImage: true,
            refresh: false,
            now: 1_000 + DAY_MS,
        }).status,
        'expired'
    );
});

test('retained scan evidence has a bounded number of facts', () => {
    const store = new ConversationImageContextStore();
    store.record({
        scope,
        imageUrl: 'https://images.test/a',
        result: {
            ...result,
            evidence: {
                content: Array.from(
                    { length: 20 },
                    (_, index) => `fact ${index}`
                ),
            },
        },
        now: 1_000,
    });

    const lookup = store.lookup({
        scope,
        imageUrl: 'https://images.test/a',
        toolName: 'file_scan',
        refersToImage: true,
        refresh: false,
        now: 1_000,
    });

    assert.equal(lookup.status, 'reused');
    if (lookup.status === 'reused') {
        assert.equal(
            'evidence' in lookup.result
                ? lookup.result.evidence?.content.length
                : undefined,
            8
        );
    }
});

test('ambiguous images are not guessed; refresh and missing session do not reuse', () => {
    const store = new ConversationImageContextStore();
    store.record({
        scope,
        imageUrl: 'https://images.test/a',
        result,
        now: 1_000,
    });
    store.record({
        scope,
        imageUrl: 'https://images.test/b',
        result,
        now: 2_000,
    });

    assert.equal(
        store.lookup({
            scope,
            toolName: 'file_scan',
            refersToImage: true,
            refresh: false,
            now: 2_000,
        }).status,
        'ambiguous'
    );
    assert.equal(
        store.lookup({
            scope,
            toolName: 'file_scan',
            imageUrl: 'https://images.test/a',
            refersToImage: true,
            refresh: false,
            now: 2_000,
        }).status,
        'reused'
    );
    assert.equal(
        store.lookup({
            scope,
            toolName: 'file_scan',
            imageUrl: 'https://images.test/a',
            refersToImage: true,
            refresh: true,
            now: 2_000,
        }).status,
        'unavailable'
    );
    store.record({ imageUrl: 'https://images.test/a', result, now: 2_000 });
    assert.equal(
        store.lookup({
            toolName: 'file_scan',
            refersToImage: true,
            refresh: false,
            now: 2_000,
        }).status,
        'unavailable'
    );
});
