/**
 * @description: Routes known button identifiers before importing their executable handlers.
 * @footnote-scope: interface
 * @footnote-module: ButtonInteractionHandlers
 * @footnote-risk: high - Incorrect routing can make a user action unavailable, but unknown controls remain ignored.
 * @footnote-ethics: high - Provenance and incident actions remain explicitly matched before loading sensitive flows.
 */

import type { ButtonInteraction } from 'discord.js';
import { createLoadOnce } from '../utils/loadOnce.js';

type ButtonHandler = (interaction: ButtonInteraction) => Promise<boolean>;

const loadProvenance = createLoadOnce(async () =>
    import('./button/provenanceButtons.js').then(
        (module) => module.handleProvenanceButtonInteraction
    )
);
const loadIncident = createLoadOnce(async () =>
    import('./button/incidentButtons.js').then(
        (module) => module.handleIncidentButtonInteraction
    )
);
const loadVariation = createLoadOnce(async () =>
    import('./button/variationButtons.js').then(
        (module) => module.handleVariationButtonInteraction
    )
);
const loadRetry = createLoadOnce(async () =>
    import('./button/retryButtons.js').then(
        (module) => module.handleImageRetryButtonInteraction
    )
);

const provenancePrefixes = ['details:', 'report_issue:'] as const;
const variationPrefix = 'image:variation:';
const retryPrefix = 'image:retry:';
const incidentPrefixes = [
    'incident_report_cancel:',
    'incident_report_consent:',
] as const;

const execute = async (
    loader: () => Promise<ButtonHandler>,
    interaction: ButtonInteraction
): Promise<boolean> => (await loader())(interaction);

/** Returns false without loading any feature code for unknown button IDs. */
export async function handleButtonInteraction(
    interaction: ButtonInteraction
): Promise<boolean> {
    const { customId } = interaction;
    if (provenancePrefixes.some((prefix) => customId.startsWith(prefix))) {
        return execute(loadProvenance, interaction);
    }
    if (incidentPrefixes.some((prefix) => customId.startsWith(prefix))) {
        return execute(loadIncident, interaction);
    }
    if (customId.startsWith(variationPrefix)) {
        return execute(loadVariation, interaction);
    }
    if (customId.startsWith(retryPrefix)) {
        return execute(loadRetry, interaction);
    }
    return false;
}
