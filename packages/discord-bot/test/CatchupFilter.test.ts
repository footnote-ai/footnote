/**
 * @description: Verifies that the catchup filter treats common emoji modifier sequences as emoji-only content.
 * @footnote-scope: test
 * @footnote-module: CatchupFilterTests
 * @footnote-risk: low - These tests only validate deterministic catchup heuristics.
 * @footnote-ethics: medium - Correct emoji-only detection helps avoid unnecessary bot replies in human conversations.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CatchupFilter } from '../src/utils/CatchupFilter.js';

interface CatchupMessageLike {
    attachments: { size: number };
    author: { bot: boolean };
    content: string;
}

function createMessage(content: string): CatchupMessageLike {
    return {
        attachments: { size: 0 },
        author: { bot: false },
        content,
    };
}

function isEmojiOnly(message: CatchupMessageLike): boolean {
    const filter = new CatchupFilter();
    const emojiOnlyMethod = Reflect.get(filter as object, 'isEmojiOnly') as (
        message: CatchupMessageLike
    ) => boolean;

    return emojiOnlyMethod.call(filter, message);
}

test('isEmojiOnly accepts emoji with skin-tone modifiers', () => {
    assert.equal(isEmojiOnly(createMessage('👍🏻')), true);
});

test('isEmojiOnly accepts emoji modifier and ZWJ chains', () => {
    assert.equal(isEmojiOnly(createMessage('👨🏽‍💻 👩🏻‍💻')), true);
});

const createDiscordMessage = (
    content: string,
    overrides: Record<string, unknown> = {}
) =>
    ({
        content,
        createdTimestamp: Date.now(),
        guildId: 'guild-1',
        channelId: 'channel-1',
        attachments: { size: 0 },
        author: {
            id: 'user-1',
            bot: false,
            username: 'Jordan',
        },
        client: {
            user: {
                id: 'bot-1',
                username: 'FootnoteBot',
            },
        },
        mentions: {
            users: {
                has: () => false,
            },
            repliedUser: null,
        },
        ...overrides,
    }) as never;

test('shouldSkipPlanner does not treat plaintext aliases as explicit mentions', async () => {
    const filter = new CatchupFilter();
    const decision = await filter.shouldSkipPlanner(
        createDiscordMessage('footnote can you help with this error?'),
        [],
        'guild-1:channel-1'
    );

    assert.equal(decision.skip, true);
    assert.equal(
        decision.reason,
        'Bot not mentioned or addressed in recent context'
    );
});

test('shouldSkipPlanner preserves explicit mention catchup behavior', async () => {
    const filter = new CatchupFilter();
    const decision = await filter.shouldSkipPlanner(
        createDiscordMessage('<@bot-1> can you help with this error?'),
        [],
        'guild-1:channel-1'
    );

    assert.equal(decision.skip, false);
    assert.equal(decision.reason, 'Content appears relevant for planner');
});

test('shouldSkipPlanner blocks unrelated content without explicit addressing', async () => {
    const filter = new CatchupFilter();
    const decision = await filter.shouldSkipPlanner(
        createDiscordMessage('variable naming question'),
        [],
        'guild-1:channel-1'
    );

    assert.equal(decision.skip, true);
    assert.equal(
        decision.reason,
        'Bot not mentioned or addressed in recent context'
    );
});
