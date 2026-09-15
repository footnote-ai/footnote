/**
 * @description: Builds response-bound provenance controls for Discord follow-up messages.
 * @footnote-scope: interface
 * @footnote-module: ProvenanceCgi
 * @footnote-risk: medium - Broken control IDs or card payload mapping can block provenance actions.
 * @footnote-ethics: high - Provenance controls and scores affect transparency and user trust.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export type ProvenanceAction = 'details' | 'report_issue';

const PROVENANCE_ACTIONS = new Set<ProvenanceAction>([
    'details',
    'report_issue',
]);
const UNKNOWN_RESPONSE_ID_FALLBACK = 'unknown_response_id';

/**
 * Normalize a response identifier by trimming surrounding whitespace and substituting a fallback when empty.
 *
 * @param responseId - The response identifier to normalize
 * @returns The trimmed `responseId`, or `unknown_response_id` when the trimmed value is empty
 */
function normalizeResponseId(responseId: string): string {
    const trimmed = responseId.trim();
    return trimmed.length > 0 ? trimmed : UNKNOWN_RESPONSE_ID_FALLBACK;
}

/**
 * Encodes a provenance action and responseId into one Discord customId.
 */
export function buildProvenanceActionCustomId(
    action: ProvenanceAction,
    responseId: string
): string {
    return `${action}:${normalizeResponseId(responseId)}`;
}

/**
 * Parses a response-bound provenance action customId.
 */
export function parseProvenanceActionCustomId(
    customId: string
): { action: ProvenanceAction; responseId: string } | null {
    const separatorIndex = customId.indexOf(':');
    if (separatorIndex <= 0) {
        return null;
    }

    const action = customId.slice(0, separatorIndex) as ProvenanceAction;
    const responseId = customId.slice(separatorIndex + 1).trim();
    if (!PROVENANCE_ACTIONS.has(action) || responseId.length === 0) {
        return null;
    }

    return { action, responseId };
}

/**
 * Builds the compact provenance control row used under the trace card.
 */
export function buildProvenanceActionRow(
    responseId: string
): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(buildProvenanceActionCustomId('details', responseId))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('\u{1F50D}'),
        new ButtonBuilder()
            .setCustomId(
                buildProvenanceActionCustomId('report_issue', responseId)
            )
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('\u{1F6A9}')
    );
}
