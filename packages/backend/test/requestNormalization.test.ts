/**
 * @description: Verifies deployment-owned scope defaults override caller-selected chat selectors.
 * @footnote-scope: test
 * @footnote-module: ChatRequestNormalizationTests
 * @footnote-risk: high - Scope normalization mistakes can route retrieval to an unintended collection.
 * @footnote-ethics: high - Caller-controlled scope selectors affect provenance and access boundaries.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PostChatRequest } from '@footnote/contracts/web';
import { buildExecutionContractScopeTuple } from '../src/services/chatOrchestrator/requestNormalization.js';

const request: PostChatRequest = {
    surface: 'discord',
    trigger: { kind: 'direct' },
    latestUserInput: 'What changed?',
    conversation: [{ role: 'user', content: 'What changed?' }],
    capabilities: {
        canReact: true,
        canGenerateImages: true,
        canUseTts: true,
    },
    surfaceContext: {
        userId: 'user_1',
        channelId: 'caller-selected-project',
        guildId: 'caller-selected-collection',
    },
};

test('deployment collection default takes precedence over caller selectors', () => {
    assert.deepEqual(
        buildExecutionContractScopeTuple(request, {
            collectionId: 'footnote-repository-context',
        }),
        {
            userId: 'user_1',
            collectionId: 'footnote-repository-context',
        }
    );
});

test('scope normalization keeps existing caller mapping without deployment defaults', () => {
    assert.deepEqual(buildExecutionContractScopeTuple(request), {
        userId: 'user_1',
        projectId: 'caller-selected-project',
    });
});
