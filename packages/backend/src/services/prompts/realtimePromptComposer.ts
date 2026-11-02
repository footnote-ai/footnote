/**
 * @description: Builds backend-owned realtime voice instructions from shared prompts and voice session context.
 * @footnote-scope: core
 * @footnote-module: RealtimePromptComposer
 * @footnote-risk: high - Incorrect prompt composition can degrade realtime responses or misapply profile overlays.
 * @footnote-ethics: high - Realtime prompt text shapes live voice behavior and user expectations.
 */
import { renderConversationPromptLayers } from './conversationPromptLayers.js';
import { buildProfileOverlaySystemMessage } from './profilePromptOverlay.js';
import type { ResolvedVoicePersona } from '../chatProfileOverlay.js';

const buildRealtimePersonaLayer = (persona: ResolvedVoicePersona): string => {
    const overlayMessage = buildProfileOverlaySystemMessage(
        persona.profile,
        'realtime'
    );

    if (overlayMessage) {
        return overlayMessage;
    }

    return renderConversationPromptLayers('discord-realtime', {
        botProfileDisplayName: persona.profile.displayName,
    }).personaPrompt;
};

/**
 * Builds the full instructions string that the realtime runtime passes to the
 * provider session. Discord participant data and transcript content stay in
 * session context and are not promoted into startup instructions.
 */
export const buildRealtimeInstructions = (
    persona: ResolvedVoicePersona
): string => {
    const promptLayers = renderConversationPromptLayers('discord-realtime', {
        botProfileDisplayName: persona.profile.displayName,
    });
    const personaLayer = buildRealtimePersonaLayer(persona);

    return `${promptLayers.systemPrompt.trimEnd()}\n\n${personaLayer}\n\n${persona.expression.guidance}`.trim();
};
