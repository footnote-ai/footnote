/**
 * @description: Matches select-menu identifiers before loading image or incident execution code.
 * @footnote-scope: interface
 * @footnote-module: SelectMenuInteractionHandlers
 * @footnote-risk: medium - A matching select may fail if its feature cannot load, but later actions can retry.
 * @footnote-ethics: medium - Review and image state are only touched after explicit identifier matching.
 */

import type { StringSelectMenuInteraction } from 'discord.js';
import { createLoadOnce } from '../utils/loadOnce.js';

const loadExecution = createLoadOnce(async () =>
    import('./selectMenuExecution.js').then(
        (module) => module.handleStringSelectMenuInteraction
    )
);

const knownPrefixes = [
    'image:variation:quality:',
    'image:variation:aspect:',
    'image:variation:image-model:',
    'image:variation:prompt-adjust:',
    'incident_view_select:',
];

export async function handleStringSelectMenuInteraction(
    interaction: StringSelectMenuInteraction
): Promise<boolean> {
    if (
        !knownPrefixes.some((prefix) => interaction.customId.startsWith(prefix))
    ) {
        return false;
    }
    return (await loadExecution())(interaction);
}
