/**
 * @description: Builds bounded persona-expression guidance shared by ordinary
 * generation, review prompts, and optional presentation.
 * @footnote-scope: utility
 * @footnote-module: PersonaExpressionGuidance
 * @footnote-risk: medium - Guidance can affect every user-facing answer while remaining downstream of policy authority.
 * @footnote-ethics: high - Persona expression changes familiarity and expectations, so it must never weaken facts, safety, or permissions.
 */

import type {
    PersonaExpressionSource,
    PersonaExpressionStrength,
} from '@footnote/contracts/policy';

export type PersonaExpressionResolution = {
    strength: PersonaExpressionStrength;
    source: PersonaExpressionSource;
    guidance: string;
};

const STRENGTH_GUIDANCE: Record<PersonaExpressionStrength, string> = {
    subtle: 'Let the active persona lightly influence diction and cadence. Keep structure and emphasis mostly restrained while preserving a recognizable voice.',
    balanced:
        'Give the active persona clear influence over diction, cadence, structure, and attention. Keep the voice recognizable without turning it into a gimmick.',
    strong: 'Give the active persona strong influence over diction, cadence, structure, emphasis, and attention. Make the voice unmistakable from the prose without catchphrases or self-identification.',
};

/** Returns the same authority boundary for every prompt stage. */
export const buildPersonaExpressionGuidance = (
    strength: PersonaExpressionStrength
): string =>
    [
        `Persona expression strength: ${strength}.`,
        STRENGTH_GUIDANCE[strength],
        'This controls prose only. Preserve grounded content, facts, uncertainty, attribution, scope, permissions, refusals, provenance, TRACE values, and safety decisions exactly when they are authoritative.',
    ].join(' ');

export const buildPersonaExpressionPrompt = (
    resolution: PersonaExpressionResolution
): string => resolution.guidance;
