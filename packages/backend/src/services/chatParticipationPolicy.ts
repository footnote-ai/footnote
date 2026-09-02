/**
 * @description: Chooses which persona identities may continue from shared semantic addressing facts.
 * @footnote-scope: core
 * @footnote-module: ChatParticipationPolicy
 * @footnote-risk: high - An incorrect decision can silence the intended persona or invite unrelated personas to generate.
 * @footnote-ethics: high - Participation arbitration controls which persona is allowed to speak to a user.
 */
import type {
    ChatAddressingEvidence,
    ChatAddressingParticipant,
} from '@footnote/contracts/web';

export type ChatParticipationReasonCode =
    | 'other_participant_addressed'
    | 'degraded_explicit_only'
    | 'policy_excluded';

export type ChatParticipationExclusion = {
    personaId: string;
    reasonCode: ChatParticipationReasonCode;
};

export type ChatParticipationDecision = {
    selectedPersonaIds: string[];
    excluded: ChatParticipationExclusion[];
};

const normalizePersonaId = (personaId: string): string =>
    personaId.trim().toLowerCase();

const isExplicitAddressing = (
    participant: ChatAddressingParticipant
): boolean => participant.relation !== 'plaintext_reference';

const isPersona = (
    participant: ChatAddressingParticipant
): participant is Extract<ChatAddressingParticipant, { kind: 'persona' }> =>
    participant.kind === 'persona';

const addUnique = (values: string[], value: string): void => {
    if (!values.includes(value)) {
        values.push(value);
    }
};

/**
 * Resolves one deterministic persona selection from adapter-owned facts.
 * Compatibility booleans are intentionally ignored because they are relative
 * to the process handling the request, not shared event facts.
 */
export const resolveChatParticipation = (
    addressing: ChatAddressingEvidence
): ChatParticipationDecision => {
    const personaParticipants = addressing.participants.filter(isPersona);
    const hasExplicitAddressing =
        addressing.participants.some(isExplicitAddressing);
    const selectedPersonaIds: string[] = [];
    const excluded: ChatParticipationExclusion[] = [];

    for (const participant of personaParticipants) {
        const personaId = normalizePersonaId(participant.personaId);
        if (personaId.length === 0) {
            continue;
        }

        if (isExplicitAddressing(participant)) {
            addUnique(selectedPersonaIds, personaId);
        }
    }

    for (const participant of personaParticipants) {
        const personaId = normalizePersonaId(participant.personaId);
        if (personaId.length === 0 || selectedPersonaIds.includes(personaId)) {
            continue;
        }

        if (!hasExplicitAddressing && addressing.resolution === 'complete') {
            addUnique(selectedPersonaIds, personaId);
            continue;
        }

        excluded.push({
            personaId,
            reasonCode:
                addressing.resolution === 'degraded'
                    ? 'degraded_explicit_only'
                    : 'other_participant_addressed',
        });
    }

    return {
        selectedPersonaIds,
        excluded,
    };
};

/** Returns the local process decision without changing the shared selection. */
export const resolveLocalChatParticipation = (input: {
    decision: ChatParticipationDecision;
    personaId: string;
}): {
    selected: boolean;
    reasonCode: ChatParticipationReasonCode | undefined;
} => {
    const personaId = normalizePersonaId(input.personaId);
    if (input.decision.selectedPersonaIds.includes(personaId)) {
        return {
            selected: true,
            reasonCode: undefined,
        };
    }

    return {
        selected: false,
        reasonCode:
            input.decision.excluded.find(
                (entry) => entry.personaId === personaId
            )?.reasonCode ?? 'policy_excluded',
    };
};
