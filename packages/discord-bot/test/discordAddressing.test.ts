/**
 * @description: Verifies Discord transport details become stable semantic addressing facts and safe model-facing text.
 * @footnote-scope: test
 * @footnote-module: DiscordAddressingTests
 * @footnote-risk: medium - Missing normalization coverage can reintroduce cross-persona routing errors.
 * @footnote-ethics: high - Addressing normalization controls which assistant identities users are understood to address.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeDiscordAddressing,
    normalizeDiscordMessageContent,
    type DiscordPersonaRosterEntry,
} from '../src/utils/discordAddressing.js';

const roster: DiscordPersonaRosterEntry[] = [
    {
        personaId: 'myuri',
        displayName: 'Myuri',
        discordUserId: '111',
        mentionAliases: ['myuri'],
    },
    {
        personaId: 'winter',
        displayName: 'Winter',
        discordUserId: '222',
        mentionAliases: ['winter'],
    },
];

test('normalizes explicit mentions and plaintext references independently', () => {
    const evidence = normalizeDiscordAddressing({
        currentPersonaId: 'winter',
        currentDiscordUserId: '222',
        mentionedUsers: [{ id: '111', username: 'myuri-bot' }],
        content: '<@111>, what do you think about Winter?',
        isSameChannelReply: false,
        roster,
    });

    assert.deepEqual(evidence.participants, [
        {
            kind: 'persona',
            relation: 'explicit_mention',
            personaId: 'myuri',
            displayName: 'Myuri',
        },
        {
            kind: 'persona',
            relation: 'plaintext_reference',
            personaId: 'winter',
            displayName: 'Winter',
        },
    ]);
    assert.equal(evidence.assistantMentioned, false);
    assert.equal(evidence.otherParticipantMentioned, true);
});

test('normalizes persona and external replies without exposing account IDs', () => {
    const personaReply = normalizeDiscordAddressing({
        currentPersonaId: 'winter',
        currentDiscordUserId: '222',
        mentionedUsers: [],
        repliedUser: { id: '111', username: 'myuri-bot' },
        content: 'Please compare these.',
        isSameChannelReply: true,
        roster,
    });
    const externalReply = normalizeDiscordAddressing({
        currentPersonaId: 'winter',
        currentDiscordUserId: '222',
        mentionedUsers: [],
        repliedUser: {
            id: '333',
            displayName: 'Jordan',
            username: 'jordan',
        },
        content: 'Please compare these.',
        isSameChannelReply: true,
        roster,
    });

    assert.deepEqual(personaReply.participants, [
        {
            kind: 'persona',
            relation: 'reply',
            personaId: 'myuri',
            displayName: 'Myuri',
        },
    ]);
    assert.deepEqual(externalReply.participants, [
        {
            kind: 'external_participant',
            relation: 'reply',
            displayName: 'Jordan',
        },
    ]);
});

test('replaces both Discord mention forms before provider-facing input', () => {
    const normalized = normalizeDiscordMessageContent(
        '<@111> and <@!222> met <@999>.',
        [
            { id: '111', username: 'myuri-bot' },
            { id: '222', username: 'winter-bot' },
        ],
        roster
    );

    assert.equal(normalized, '@Myuri and @Winter met @unresolved participant.');
});
