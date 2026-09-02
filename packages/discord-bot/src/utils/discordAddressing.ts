/**
 * @description: Converts Discord mention and reply transport details into stable semantic participant facts and sanitized text.
 * @footnote-scope: utility
 * @footnote-module: DiscordAddressing
 * @footnote-risk: high - Incorrect normalization can route a message to the wrong persona or expose transport identifiers to a model.
 * @footnote-ethics: high - Addressing determines which assistant is invited to participate in a conversation.
 */

import type {
    ChatAddressingEvidence,
    ChatAddressingParticipant,
} from '@footnote/contracts/web';
import { containsPlaintextBotAlias } from './mentionAliases.js';

export type DiscordPersonaRosterEntry = {
    personaId: string;
    displayName: string;
    discordUserId: string;
    mentionAliases: string[];
};

export type DiscordMentionUser = {
    id: string;
    displayName?: string;
    username?: string;
};

export type NormalizeDiscordAddressingInput = {
    currentPersonaId: string;
    currentDiscordUserId?: string;
    mentionedUsers: readonly DiscordMentionUser[];
    repliedUser?: DiscordMentionUser | null;
    isSameChannelReply: boolean;
    content: string;
    roster: readonly DiscordPersonaRosterEntry[];
    resolution?: 'complete' | 'degraded';
};

const fallbackAliasForPersona = (
    persona: DiscordPersonaRosterEntry
): string[] => {
    const aliases = new Set(persona.mentionAliases);
    aliases.add(persona.displayName);
    if (persona.personaId === 'footnote') {
        aliases.add('footnote');
    }
    return [...aliases];
};

const participantFromUser = (
    user: DiscordMentionUser,
    relation: 'explicit_mention' | 'reply',
    rosterByDiscordUserId: ReadonlyMap<string, DiscordPersonaRosterEntry>
): ChatAddressingParticipant => {
    const persona = rosterByDiscordUserId.get(user.id);
    if (persona) {
        return {
            kind: 'persona',
            relation,
            personaId: persona.personaId,
            displayName: persona.displayName,
        };
    }

    const displayName = (user.displayName ?? user.username)?.trim();
    return displayName
        ? { kind: 'external_participant', relation, displayName }
        : { kind: 'unknown', relation };
};

const participantKey = (participant: ChatAddressingParticipant): string => {
    const identity =
        participant.kind === 'persona'
            ? participant.personaId
            : participant.kind === 'external_participant'
              ? participant.displayName
              : '';
    return [participant.kind, participant.relation, identity].join(':');
};

const addParticipant = (
    participants: ChatAddressingParticipant[],
    participant: ChatAddressingParticipant
): void => {
    if (
        !participants.some(
            (entry) => participantKey(entry) === participantKey(participant)
        )
    ) {
        participants.push(participant);
    }
};

/**
 * Resolves one Discord event into transport-free participant relationships.
 * The returned evidence contains no Discord account IDs or mention markup.
 */
export const normalizeDiscordAddressing = (
    input: NormalizeDiscordAddressingInput
): ChatAddressingEvidence => {
    const rosterByDiscordUserId = new Map(
        input.roster.map((persona) => [persona.discordUserId, persona])
    );
    const currentPersona = input.roster.find(
        (persona) => persona.personaId === input.currentPersonaId
    );
    if (
        input.currentDiscordUserId &&
        currentPersona &&
        !rosterByDiscordUserId.has(input.currentDiscordUserId)
    ) {
        rosterByDiscordUserId.set(input.currentDiscordUserId, currentPersona);
    }
    const participants: ChatAddressingParticipant[] = [];

    for (const user of input.mentionedUsers) {
        addParticipant(
            participants,
            participantFromUser(user, 'explicit_mention', rosterByDiscordUserId)
        );
    }

    if (input.isSameChannelReply && input.repliedUser) {
        addParticipant(
            participants,
            participantFromUser(
                input.repliedUser,
                'reply',
                rosterByDiscordUserId
            )
        );
    }

    for (const persona of input.roster) {
        if (
            containsPlaintextBotAlias(
                input.content,
                fallbackAliasForPersona(persona)
            )
        ) {
            addParticipant(participants, {
                kind: 'persona',
                relation: 'plaintext_reference',
                personaId: persona.personaId,
                displayName: persona.displayName,
            });
        }
    }

    const assistantMentioned = participants.some(
        (participant) =>
            participant.kind === 'persona' &&
            participant.personaId === input.currentPersonaId &&
            participant.relation === 'explicit_mention'
    );
    const replyToAssistant = participants.some(
        (participant) =>
            participant.kind === 'persona' &&
            participant.personaId === input.currentPersonaId &&
            participant.relation === 'reply'
    );
    const otherParticipantMentioned = participants.some(
        (participant) =>
            participant.relation === 'explicit_mention' &&
            (participant.kind !== 'persona' ||
                participant.personaId !== input.currentPersonaId)
    );
    const replyToOtherParticipant = participants.some(
        (participant) =>
            participant.relation === 'reply' &&
            (participant.kind !== 'persona' ||
                participant.personaId !== input.currentPersonaId)
    );

    return {
        participants,
        resolution: input.resolution ?? 'complete',
        assistantMentioned,
        replyToAssistant,
        otherParticipantMentioned,
        replyToOtherParticipant,
    };
};

/**
 * Replaces Discord mention markup with a display name or a neutral unresolved
 * marker so provider-facing text never has to interpret account IDs.
 */
export const normalizeDiscordMessageContent = (
    content: string,
    mentionedUsers: readonly DiscordMentionUser[],
    roster: readonly DiscordPersonaRosterEntry[]
): string => {
    const rosterByDiscordUserId = new Map(
        roster.map((persona) => [persona.discordUserId, persona])
    );
    const usersById = new Map(mentionedUsers.map((user) => [user.id, user]));

    return content.replace(/<@!?([0-9]+)>/g, (_match, userId: string) => {
        const persona = rosterByDiscordUserId.get(userId);
        if (persona) {
            return `@${persona.displayName}`;
        }

        const user = usersById.get(userId);
        const displayName = (user?.displayName ?? user?.username)?.trim();
        return displayName ? `@${displayName}` : '@unresolved participant';
    });
};
