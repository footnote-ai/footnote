/**
 * @description: Verifies canonical conversation context assembly and deterministic projection behavior.
 * @footnote-scope: test
 * @footnote-module: ConversationContextServiceTests
 * @footnote-risk: medium - Regressions can break canonical planner/generation context assembly.
 * @footnote-ethics: high - Identity/visibility regressions could misattribute speakers or leak backend-only context.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PostChatRequest } from '@footnote/contracts/web';
import {
    buildConversationContext,
    ConversationContextAssemblyError,
    projectConversationMessages,
    toSnapshotContextEnvelope,
} from '../src/services/conversationContextService.js';

const logger = {
    warn: () => undefined,
    debug: () => undefined,
};

const createRequest = (
    overrides: Partial<PostChatRequest> = {}
): PostChatRequest => ({
    surface: 'discord',
    trigger: { kind: 'direct' },
    latestUserInput: 'hello',
    conversation: [{ role: 'user', content: 'hello' }],
    capabilities: {
        canReact: true,
        canGenerateImages: true,
        canUseTts: true,
    },
    ...overrides,
});

test('buildConversationContext returns canonical messages and envelope metadata', () => {
    const result = buildConversationContext(
        createRequest({
            conversation: [
                {
                    role: 'user',
                    content: 'How are you?',
                    authorName: 'Jordan',
                    authorId: 'user-1',
                },
                {
                    role: 'assistant',
                    content: 'Doing well.',
                    authorName: 'Footnote',
                    authorId: 'bot-1',
                },
            ],
        }),
        logger
    );

    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[0]?.content, 'How are you?');
    assert.equal(result.messages[1]?.content, 'Doing well.');
    assert.equal(result.contextEnvelope.turns.length, 2);
    assert.equal(result.contextEnvelope.diagnostics.projectedMessageCount, 2);
});

test('web context does not duplicate the latest user turn when it is already last', () => {
    const result = buildConversationContext(
        createRequest({
            surface: 'web',
            latestUserInput: 'hello',
            conversation: [{ role: 'user', content: 'hello' }],
        }),
        logger
    );

    assert.deepEqual(result.messages, [{ role: 'user', content: 'hello' }]);
    assert.equal(
        result.messages.filter((message) => message.content === 'hello').length,
        1
    );
    assert.equal(result.contextEnvelope.diagnostics.totalInputMessages, 1);
    assert.equal(result.contextEnvelope.diagnostics.projectedMessageCount, 1);
    assert.equal(result.contextEnvelope.diagnostics.trimmedMessageCount, 0);
});

test('web context keeps the authoritative current turn even when it falls outside the recent window', () => {
    const conversation = [
        { role: 'user' as const, content: 'current request' },
        ...Array.from({ length: 13 }, (_, index) => ({
            role: index % 2 === 0 ? ('assistant' as const) : ('user' as const),
            content: `history-${index}`,
        })),
    ];
    const result = buildConversationContext(
        createRequest({
            surface: 'web',
            latestUserInput: 'current request',
            conversation,
        }),
        logger
    );

    assert.equal(result.messages.length, 12);
    assert.equal(result.messages.at(-1)?.role, 'user');
    assert.equal(result.messages.at(-1)?.content, 'current request');
    assert.equal(
        result.messages.filter(
            (message) => message.content === 'current request'
        ).length,
        1
    );
    assert.equal(result.contextEnvelope.diagnostics.totalInputMessages, 14);
    assert.equal(result.contextEnvelope.diagnostics.projectedMessageCount, 12);
    assert.equal(result.contextEnvelope.diagnostics.trimmedMessageCount, 2);
});

test('web context appends an omitted current turn and counts dropped input separately', () => {
    const conversation = Array.from({ length: 14 }, (_, index) => ({
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `history-${index}`,
    }));
    const result = buildConversationContext(
        createRequest({
            surface: 'web',
            latestUserInput: 'new current request',
            conversation,
        }),
        logger
    );

    assert.equal(result.messages.length, 12);
    assert.deepEqual(result.messages.at(-1), {
        role: 'user',
        content: 'new current request',
    });
    assert.equal(
        result.messages.filter(
            (message) => message.content === 'new current request'
        ).length,
        1
    );
    assert.equal(result.contextEnvelope.diagnostics.totalInputMessages, 14);
    assert.equal(result.contextEnvelope.diagnostics.projectedMessageCount, 12);
    assert.equal(result.contextEnvelope.diagnostics.trimmedMessageCount, 3);
});

test('web context retains system messages and the latest twelve history turns in order', () => {
    const conversation = [
        { role: 'system' as const, content: 'system context' },
        ...Array.from({ length: 13 }, (_, index) => ({
            role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
            content: `turn-${index}`,
        })),
    ];
    const result = buildConversationContext(
        createRequest({
            surface: 'web',
            latestUserInput: 'turn-12',
            conversation,
        }),
        logger
    );

    assert.deepEqual(
        result.messages.map((message) => `${message.role}:${message.content}`),
        [
            'system:system context',
            ...conversation
                .slice(2, 13)
                .map((message) => `${message.role}:${message.content}`),
            'user:turn-12',
        ]
    );
    assert.equal(result.messages.at(-1)?.content, 'turn-12');
    assert.equal(result.contextEnvelope.diagnostics.totalInputMessages, 14);
    assert.equal(result.contextEnvelope.diagnostics.projectedMessageCount, 13);
    assert.equal(result.contextEnvelope.diagnostics.trimmedMessageCount, 1);
});

test('web context diagnostics identify the bounded policy without message content', () => {
    const result = buildConversationContext(
        createRequest({
            surface: 'web',
            latestUserInput: 'private message body',
            conversation: [{ role: 'user', content: 'private message body' }],
        }),
        logger
    );

    assert.deepEqual(result.contextEnvelope.diagnostics, {
        surface: 'web',
        policy: 'web_recent_12_v1',
        totalInputMessages: 1,
        projectedMessageCount: 1,
        trimmedMessageCount: 0,
        sanitizedTimestampCount: 0,
        projectedSpeakerLabelCount: 0,
    });
    const snapshot = toSnapshotContextEnvelope(result.contextEnvelope);
    assert.equal(snapshot.diagnostics.policy, 'web_recent_12_v1');
    assert.equal(
        JSON.stringify(snapshot.diagnostics).includes('private message body'),
        false
    );
});

test('Discord keeps its existing 24 non-system-message window', () => {
    const conversation = Array.from({ length: 25 }, (_, index) => ({
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `turn-${index}`,
    }));
    const result = buildConversationContext(
        createRequest({ conversation }),
        logger
    );

    assert.equal(result.messages.length, 24);
    assert.equal(result.messages[0]?.content, 'turn-1');
    assert.equal(result.messages.at(-1)?.content, 'turn-24');
    assert.equal(result.contextEnvelope.diagnostics.trimmedMessageCount, 1);
    assert.equal(
        result.contextEnvelope.diagnostics.policy,
        'discord_recent_24_v1'
    );
});

test('buildConversationContext projects speaker labels only for multi-human windows', () => {
    const result = buildConversationContext(
        createRequest({
            conversation: [
                {
                    role: 'user',
                    content: 'First speaker',
                    authorName: 'Jordan',
                    authorId: 'user-1',
                },
                {
                    role: 'user',
                    content: 'Second speaker',
                    authorName: 'Taylor',
                    authorId: 'user-2',
                },
            ],
        }),
        logger
    );

    assert.match(result.messages[0]?.content ?? '', /^\[Jordan\]/);
    assert.match(result.messages[1]?.content ?? '', /^\[Taylor\]/);
    assert.equal(
        result.contextEnvelope.diagnostics.projectedSpeakerLabelCount,
        2
    );
});

test('Danny/Myuri/Winter regression keeps both user-mentioned names in one conversation turn', () => {
    const result = buildConversationContext(
        createRequest({
            latestUserInput:
                '@Winter compare yourself with Myuri, Danny, and generic Footnote.',
            conversation: [
                {
                    role: 'user',
                    content:
                        '@Winter compare yourself with Myuri, Danny, and generic Footnote.',
                },
            ],
        }),
        logger
    );

    const projected = result.messages[0]?.content ?? '';
    assert.match(projected, /Myuri/u);
    assert.match(projected, /Danny/u);
    assert.equal(result.contextEnvelope.turns[0]?.authority, 'conversation');
    assert.equal(result.contextEnvelope.turns[0]?.visibility, 'model_visible');
});

test('buildConversationContext sanitizes invalid timestamps without changing role semantics', () => {
    const result = buildConversationContext(
        createRequest({
            conversation: [
                {
                    role: 'assistant',
                    content: 'ok',
                    createdAt: 'not-a-date',
                },
            ],
        }),
        logger
    );

    assert.equal(result.messages[0]?.role, 'assistant');
    assert.equal(result.contextEnvelope.turns[0]?.createdAt, undefined);
    assert.equal(result.contextEnvelope.diagnostics.sanitizedTimestampCount, 1);
});

test('buildConversationContext fails loudly on invalid role identity', () => {
    assert.throws(
        () =>
            buildConversationContext(
                createRequest({
                    conversation: [
                        {
                            role: 'user-ish' as unknown as 'user',
                            content: 'bad',
                        },
                    ],
                }),
                logger
            ),
        (error: unknown) =>
            error instanceof ConversationContextAssemblyError &&
            error.reasonCode === 'invalid_role'
    );
});

test('projectConversationMessages excludes backend_only turns', () => {
    const projected = projectConversationMessages([
        {
            role: 'system',
            content: 'model-visible',
            speakerId: 'system',
            speakerLabel: 'System',
            visibility: 'model_visible',
        },
        {
            role: 'system',
            content: 'must-not-project',
            speakerId: 'system',
            speakerLabel: 'System',
            visibility: 'backend_only',
        },
    ]);
    assert.equal(projected.length, 1);
    assert.equal(projected[0]?.content, 'model-visible');
});
