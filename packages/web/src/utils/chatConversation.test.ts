/**
 * @description: Verifies public chat request messages stay ordered and within the shared transport contract.
 * @footnote-scope: test
 * @footnote-module: ChatConversationTests
 * @footnote-risk: low - Tests cover browser request assembly only.
 * @footnote-ethics: low - Tests prevent accidental loss or duplication of user turns.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatConversationMessage } from '@footnote/contracts/web';
import { buildChatConversation } from './chatConversation.js';

const user = (content: string): ChatConversationMessage => ({
    role: 'user',
    content,
});
const assistant = (content: string): ChatConversationMessage => ({
    role: 'assistant',
    content,
});

test('first turn sends only the current user message', () => {
    assert.deepEqual(buildChatConversation([], 'hello'), [user('hello')]);
});

test('repeated short messages remain distinct turns', () => {
    assert.deepEqual(
        buildChatConversation([user('yes'), assistant('I hear you.')], 'yes'),
        [user('yes'), assistant('I hear you.'), user('yes')]
    );
});

test('several turns are sent in chronological order with the current turn last', () => {
    const history = [
        user('What is a trace?'),
        assistant('A record of how a response was made.'),
        user('Why is it useful?'),
        assistant('It helps inspect the supporting work.'),
    ];

    assert.deepEqual(buildChatConversation(history, 'Can I inspect one?'), [
        ...history,
        user('Can I inspect one?'),
    ]);
});

test('request assembly stays within the 64-message shared contract', () => {
    const history: ChatConversationMessage[] = Array.from(
        { length: 80 },
        (_, index) =>
            index % 2 === 0
                ? user(`question ${index / 2}`)
                : assistant(`answer ${(index - 1) / 2}`)
    );

    const conversation = buildChatConversation(history, 'latest question');

    assert.equal(conversation.length, 63);
    assert.deepEqual(conversation.slice(-3), [
        user('question 39'),
        assistant('answer 39'),
        user('latest question'),
    ]);
});
