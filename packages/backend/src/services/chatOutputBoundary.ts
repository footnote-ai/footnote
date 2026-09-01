/**
 * @description: Applies narrow, surface-scoped response formatting protections for configured Discord personas.
 * @footnote-scope: core
 * @footnote-module: ChatOutputBoundary
 * @footnote-risk: medium - Incorrect matching could alter a legitimate response format.
 * @footnote-ethics: medium - Persona identity presentation affects user trust and interpretation.
 */

import type {
    ChatAssistantIdentity,
    ChatConversationMessage,
    PostChatRequest,
} from '@footnote/contracts/web';

export type ChatOutputBoundaryOptions = {
    surface: PostChatRequest['surface'];
    assistantIdentity?: ChatAssistantIdentity;
    preserveLeadingBotLabel: boolean;
};

export type ChatOutputNormalization = {
    content: string;
    changed: boolean;
    removedForm?: 'colon' | 'bracket' | 'mention';
};

type LeadingLabelPattern = {
    form: NonNullable<ChatOutputNormalization['removedForm']>;
    pattern: RegExp;
};

const escapeRegExp = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getIdentityTerms = (
    identity: ChatAssistantIdentity | undefined
): string[] => {
    if (!identity) {
        return [];
    }

    const terms = [identity.displayName, ...identity.mentionAliases]
        .map((term) => term.trim())
        .filter((term) => term.length > 0);
    return terms.filter(
        (term, index) =>
            terms.findIndex(
                (candidate) => candidate.toLowerCase() === term.toLowerCase()
            ) === index
    );
};

/**
 * Returns true only for a bounded, positive request to label the response.
 * Negative instructions win so the response boundary remains conservative.
 */
export const shouldPreserveLeadingBotLabel = (
    input: string,
    identity?: ChatAssistantIdentity
): boolean => {
    const normalized = input.trim();
    if (normalized.length === 0) {
        return false;
    }

    const negativeInstruction =
        /\b(?:do not|don't|never|avoid|without)\b[\s\S]{0,80}\b(?:prefix|label|speaker|name|start|begin|format)\b/iu;
    if (negativeInstruction.test(normalized)) {
        return false;
    }

    const identityTerms = getIdentityTerms(identity);
    const mentionsConfiguredName = identityTerms.some((term) =>
        new RegExp(
            `(?:^|[^\\p{L}\\p{N}_])${escapeRegExp(term)}(?:$|[^\\p{L}\\p{N}_])`,
            'iu'
        ).test(normalized)
    );
    const mentionsLabelVocabulary =
        /\b(?:name|label|speaker|heading|colon|bracket(?:ed)?|mention|tag)\b/iu.test(
            normalized
        );
    if (!mentionsConfiguredName && !mentionsLabelVocabulary) {
        return false;
    }

    const leadingLabelInstruction =
        /\b(?:prefix|label|start|begin|format|use|put|add|open)\b[\s\S]{0,120}\b(?:each|every|answer|reply|response|message|opening|first|name|label|speaker|format|with|as)\b/iu;
    const directAddressInstruction =
        /\baddress\b[\s\S]{0,80}\b(?:answer|reply|response|message|directly|as)\b/iu;

    return (
        leadingLabelInstruction.test(normalized) ||
        directAddressInstruction.test(normalized)
    );
};

/** Resolves one surface-scoped formatting policy from the active identity. */
export const buildChatOutputBoundaryOptions = (
    request: Pick<
        PostChatRequest,
        'surface' | 'latestUserInput' | 'assistantIdentity'
    >,
    fallbackIdentity?: ChatAssistantIdentity
): ChatOutputBoundaryOptions => {
    const assistantIdentity = request.assistantIdentity ?? fallbackIdentity;
    return {
        surface: request.surface,
        ...(assistantIdentity !== undefined && { assistantIdentity }),
        preserveLeadingBotLabel: shouldPreserveLeadingBotLabel(
            request.latestUserInput,
            assistantIdentity
        ),
    };
};

const getLeadingLabelPatterns = (
    identity: ChatAssistantIdentity
): LeadingLabelPattern[] => {
    const terms = [...getIdentityTerms(identity)].sort(
        (left, right) => right.length - left.length
    );
    return terms.flatMap((term) => {
        const escapedName = escapeRegExp(term);
        return [
            {
                form: 'colon' as const,
                pattern: new RegExp(
                    `^[\\t ]*${escapedName}[\\t ]*:[\\t ]*`,
                    'iu'
                ),
            },
            {
                form: 'bracket' as const,
                pattern: new RegExp(
                    `^[\\t ]*\\[${escapedName}\\][\\t ]*`,
                    'iu'
                ),
            },
            {
                form: 'mention' as const,
                pattern: new RegExp(
                    `^[\\t ]*@${escapedName}(?=[\\t ]|$)[\\t ]*`,
                    'iu'
                ),
            },
        ];
    });
};

/**
 * Removes one accidental configured-persona label from a Discord response.
 * The original content is returned whenever the context is ambiguous.
 */
export const normalizeChatOutput = (
    content: string,
    options: ChatOutputBoundaryOptions
): ChatOutputNormalization => {
    if (
        options.surface !== 'discord' ||
        options.preserveLeadingBotLabel ||
        content.length === 0
    ) {
        return { content, changed: false };
    }

    const assistantIdentity = options.assistantIdentity;
    if (
        !assistantIdentity ||
        getIdentityTerms(assistantIdentity).length === 0
    ) {
        return { content, changed: false };
    }

    for (const candidate of getLeadingLabelPatterns(assistantIdentity)) {
        const match = candidate.pattern.exec(content);
        if (!match) {
            continue;
        }

        const normalizedContent = content.slice(match[0].length);
        if (normalizedContent.trim().length === 0) {
            return { content, changed: false };
        }

        return {
            content: normalizedContent,
            changed: true,
            removedForm: candidate.form,
        };
    }

    return { content, changed: false };
};

/**
 * Decontaminates only model-visible assistant history without mutating the
 * original conversation retained by the surface adapter.
 */
export const normalizeAssistantHistory = (
    conversation: readonly ChatConversationMessage[],
    options: ChatOutputBoundaryOptions
): ChatConversationMessage[] =>
    conversation.map((message) => {
        if (message.role !== 'assistant') {
            return { ...message };
        }

        const normalized = normalizeChatOutput(message.content, options);
        return normalized.changed
            ? { ...message, content: normalized.content }
            : { ...message };
    });
