/**
 * @description: Verifies Discord response-prefix normalization and historical assistant-context protection.
 * @footnote-scope: test
 * @footnote-module: ChatOutputBoundaryTests
 * @footnote-risk: medium - Incorrect normalization could alter legitimate user-requested formats.
 * @footnote-ethics: medium - Output shaping affects identity presentation and user trust.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type {
    ChatAssistantIdentity,
    PostChatRequest,
} from '@footnote/contracts/web';
import {
    normalizeAssistantHistory,
    normalizeChatOutput,
    shouldPreserveLeadingBotLabel,
} from '../src/services/chatOutputBoundary.js';

const discordOptions = {
    surface: 'discord' as const,
    assistantIdentity: {
        displayName: 'Ari Vendor',
        mentionAliases: ['Ari'],
    } satisfies ChatAssistantIdentity,
    preserveLeadingBotLabel: false,
};

test('normalizes leading display-name and alias prefixes for arbitrary identities', () => {
    const cases = [
        ['Ari Vendor: Answer directly.', 'Answer directly.'],
        ['[Ari Vendor] Answer directly.', 'Answer directly.'],
        ['@Ari Vendor Answer directly.', 'Answer directly.'],
        ['Ari: Answer directly.', 'Answer directly.'],
        ['  ari: Answer directly.', 'Answer directly.'],
    ] as const;

    for (const [content, expected] of cases) {
        assert.equal(
            normalizeChatOutput(content, discordOptions).content,
            expected
        );
    }
});

test('matches the longest configured identity term first', () => {
    const options = {
        ...discordOptions,
        assistantIdentity: {
            displayName: 'Ari',
            mentionAliases: ['Ari Vendor'],
        } satisfies ChatAssistantIdentity,
    };

    assert.equal(
        normalizeChatOutput('@Ari Vendor Answer directly.', options).content,
        'Answer directly.'
    );
});

test('preserves non-leading, nonmatching, quoted, and code-formatted labels', () => {
    const cases = [
        'Taylor: Answer directly.',
        'The answer mentions Ari: later.',
        '> Ari: quoted text.',
        '```text\nAri: code content\n```',
    ] as const;

    for (const content of cases) {
        assert.equal(
            normalizeChatOutput(content, discordOptions).content,
            content
        );
    }
});

test('preserves a label when removing it would produce an empty response', () => {
    const content = 'Ari:';
    assert.equal(normalizeChatOutput(content, discordOptions).content, content);
});

test('preserves leading labels for an explicit user-requested format', () => {
    assert.equal(
        normalizeChatOutput('Ari: Answer directly.', {
            ...discordOptions,
            preserveLeadingBotLabel: true,
        }).content,
        'Ari: Answer directly.'
    );
});

test('recognizes explicit label-format requests without treating ordinary mentions as permission', () => {
    assert.equal(
        shouldPreserveLeadingBotLabel(
            'Prefix each answer with Ari:',
            discordOptions.assistantIdentity
        ),
        true
    );
    assert.equal(
        shouldPreserveLeadingBotLabel(
            'Use the format [Ari] before every reply.',
            discordOptions.assistantIdentity
        ),
        true
    );
    assert.equal(
        shouldPreserveLeadingBotLabel(
            'Do not prefix ordinary replies with Ari.',
            discordOptions.assistantIdentity
        ),
        false
    );
    assert.equal(
        shouldPreserveLeadingBotLabel(
            'Format every answer with bullets.',
            discordOptions.assistantIdentity
        ),
        false
    );
    assert.equal(
        shouldPreserveLeadingBotLabel(
            '@Ari what changed?',
            discordOptions.assistantIdentity
        ),
        false
    );
});

test('removes accidental prefixes from model-visible assistant history only', () => {
    const conversation: PostChatRequest['conversation'] = [
        { role: 'assistant', content: 'Ari: Earlier answer.' },
        { role: 'user', content: 'Continue.' },
    ];

    const normalized = normalizeAssistantHistory(conversation, discordOptions);

    assert.deepEqual(normalized, [
        { role: 'assistant', content: 'Earlier answer.' },
        { role: 'user', content: 'Continue.' },
    ]);
    assert.deepEqual(conversation[0], {
        role: 'assistant',
        content: 'Ari: Earlier answer.',
    });
});
