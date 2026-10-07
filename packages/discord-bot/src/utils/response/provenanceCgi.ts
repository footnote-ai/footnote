/**
 * @description: Builds response-bound provenance controls for Discord follow-up messages.
 * @footnote-scope: interface
 * @footnote-module: ProvenanceCgi
 * @footnote-risk: medium - Broken control IDs or card payload mapping can block provenance actions.
 * @footnote-ethics: high - Provenance controls and scores affect transparency and user trust.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export type ProvenanceAction =
    'details' | 'sources' | 'controls' | 'trace' | 'listen' | 'report_issue';

const PROVENANCE_ACTIONS = new Set<ProvenanceAction>([
    'details',
    'sources',
    'controls',
    'trace',
    'listen',
    'report_issue',
]);
const UNKNOWN_RESPONSE_ID_FALLBACK = 'unknown_response_id';
export const MAX_DISCORD_LISTEN_TEXT_LENGTH = 1600;

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
    responseId: string,
    options: { listen: boolean; listenDisabled?: boolean } = { listen: false }
): ActionRowBuilder<ButtonBuilder> {
    const buttons = [
        new ButtonBuilder()
            .setCustomId(buildProvenanceActionCustomId('details', responseId))
            .setStyle(ButtonStyle.Secondary)
            .setLabel('Inspect'),
    ];
    if (options.listen) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(
                    buildProvenanceActionCustomId('listen', responseId)
                )
                .setStyle(ButtonStyle.Secondary)
                .setLabel('Listen')
                .setDisabled(options.listenDisabled ?? false)
        );
    }
    buttons.push(
        new ButtonBuilder()
            .setCustomId(
                buildProvenanceActionCustomId('report_issue', responseId)
            )
            .setStyle(ButtonStyle.Secondary)
            .setLabel('Report')
    );
    return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}
