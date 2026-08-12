/**
 * @description: Matches modal identifiers before loading image or incident execution code.
 * @footnote-scope: interface
 * @footnote-module: ModalSubmitInteractionHandlers
 * @footnote-risk: medium - A matching modal may fail if its feature cannot load, but later actions can retry.
 * @footnote-ethics: medium - Incident report content is only handled after its explicit identifier matches.
 */

import type { ModalSubmitInteraction } from 'discord.js';
import { createLoadOnce } from '../utils/loadOnce.js';

const loadExecution = createLoadOnce(async () =>
    import('./modalSubmitExecution.js').then(
        (module) => module.handleModalSubmitInteraction
    )
);

const knownPrefixes = ['incident_report_modal:', 'image:variation:prompt:'];

export async function handleModalSubmitInteraction(
    interaction: ModalSubmitInteraction
): Promise<boolean> {
    if (
        !knownPrefixes.some((prefix) => interaction.customId.startsWith(prefix))
    ) {
        return false;
    }
    return (await loadExecution())(interaction);
}
