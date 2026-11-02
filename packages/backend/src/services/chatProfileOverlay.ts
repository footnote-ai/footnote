/**
 * @description: Resolves backend-owned chat persona overlay and display-name settings.
 * @footnote-scope: core
 * @footnote-module: ChatProfileOverlay
 * @footnote-risk: high - Incorrect persona routing can apply the wrong identity instructions across deployments.
 * @footnote-ethics: high - Persona identity selection directly affects user trust and disclosure clarity.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { PostChatRequest } from '@footnote/contracts/web';
import type { BotProfileConfig } from '../config/profile.js';
import {
    parsePersonaExpressionStrength,
    readBotProfileConfig,
} from '../config/profile.js';
import type { InternalVoiceRealtimeClientEvent } from '@footnote/contracts/voice';
import { buildProfileOverlaySystemMessage } from './prompts/profilePromptOverlay.js';
import {
    buildPersonaExpressionGuidance,
    type PersonaExpressionResolution,
} from './prompts/personaExpression.js';
import { runtimeConfig } from '../config.js';

type ChatProfileOverlayLogger = {
    warn: (
        message: string,
        meta?: {
            requestedProfileId?: string;
            runtimeProfileId: string;
            surface: PostChatRequest['surface'];
            requestedPersonaId?: string;
            resolvedPersonaId?: string;
            overlayPath?: string;
        }
    ) => void;
};

export type PersonaCatalogEntry = {
    id: string;
    displayName: string;
    overlayRelativePath: string | null;
    /** Presentation-only guidance for optional presentation flow; not persona authority. */
    presentationGuidance: string;
    defaultExpressionStrength: PersonaExpressionResolution['strength'];
};

const PERSONA_CATALOG: Record<string, PersonaCatalogEntry> = {
    footnote: {
        id: 'footnote',
        displayName: 'Footnote',
        overlayRelativePath: null,
        presentationGuidance:
            'Use clear, neutral, practical prose. Prefer direct sentences and calm, candid phrasing.',
        defaultExpressionStrength: 'balanced',
    },
    myuri: {
        id: 'myuri',
        displayName: 'Myuri',
        overlayRelativePath: 'packages/prompts/src/profile-overlays/myuri.md',
        presentationGuidance:
            'Use warm, lively, perceptive prose with situational wit. Keep the strongest useful point and avoid ceremony.',
        defaultExpressionStrength: 'balanced',
    },
    danny: {
        id: 'danny',
        displayName: 'Danny',
        overlayRelativePath: 'packages/prompts/src/profile-overlays/danny.md',
        presentationGuidance:
            'Use composed, exact, measured language with quiet warmth. Make the point clear without urgency or ceremony.',
        defaultExpressionStrength: 'balanced',
    },
    winter: {
        id: 'winter',
        displayName: 'Winter',
        overlayRelativePath: 'packages/prompts/src/profile-overlays/winter.md',
        presentationGuidance:
            'Use direct, sharp, personable prose with dry wit and minimal ceremony. Avoid unsolicited moral framing, generic reassurance, and performative caution. Let disagreement or constraint show plainly when it is actually relevant.',
        defaultExpressionStrength: 'strong',
    },
};

const DEFAULT_PERSONA_ID = 'footnote';
export const NEUTRAL_PRESENTATION_GUIDANCE =
    'Use concise, neutral, clear prose. Preserve the original organization and avoid added emphasis.';

/** Returns explicit, text-only presentation guidance without scraping persona prompt files. */
export const resolvePersonaPresentationGuidance = (personaId: string): string =>
    PERSONA_CATALOG[personaId.trim().toLowerCase()]?.presentationGuidance ??
    NEUTRAL_PRESENTATION_GUIDANCE;

const resolvePersonaEntry = (
    request: Pick<PostChatRequest, 'surface' | 'botPersonaId'>,
    logger: ChatProfileOverlayLogger
): PersonaCatalogEntry => {
    if (request.surface !== 'discord') {
        return PERSONA_CATALOG[DEFAULT_PERSONA_ID];
    }

    const requestedPersonaId = request.botPersonaId?.trim().toLowerCase();
    if (!requestedPersonaId) {
        logger.warn('chat request missing botPersonaId; using fallback', {
            runtimeProfileId: runtimeConfig.profile.id,
            surface: request.surface,
            resolvedPersonaId: DEFAULT_PERSONA_ID,
        });
        return PERSONA_CATALOG[DEFAULT_PERSONA_ID];
    }

    const matchedPersona = PERSONA_CATALOG[requestedPersonaId];
    if (matchedPersona) {
        return matchedPersona;
    }

    logger.warn('chat request selected unknown botPersonaId; using fallback', {
        runtimeProfileId: runtimeConfig.profile.id,
        surface: request.surface,
        requestedPersonaId,
        resolvedPersonaId: DEFAULT_PERSONA_ID,
    });
    return PERSONA_CATALOG[DEFAULT_PERSONA_ID];
};

const readPersonaOverlayText = (
    persona: PersonaCatalogEntry,
    request: Pick<PostChatRequest, 'surface' | 'botPersonaId'>,
    logger: ChatProfileOverlayLogger
): { text: string | null; absolutePath: string | null } => {
    if (!persona.overlayRelativePath) {
        return { text: null, absolutePath: null };
    }

    const absolutePath = path.resolve(
        runtimeConfig.runtime.projectRoot,
        persona.overlayRelativePath
    );
    try {
        const overlayText = fs.readFileSync(absolutePath, 'utf-8').trim();
        if (overlayText.length === 0) {
            logger.warn(
                'persona overlay file was empty; using fallback without overlay',
                {
                    runtimeProfileId: runtimeConfig.profile.id,
                    surface: request.surface,
                    requestedPersonaId: request.botPersonaId,
                    resolvedPersonaId: persona.id,
                    overlayPath: absolutePath,
                }
            );
            return { text: null, absolutePath };
        }

        return { text: overlayText, absolutePath };
    } catch {
        logger.warn(
            'persona overlay file could not be read; using fallback without overlay',
            {
                runtimeProfileId: runtimeConfig.profile.id,
                surface: request.surface,
                requestedPersonaId: request.botPersonaId,
                resolvedPersonaId: persona.id,
                overlayPath: absolutePath,
            }
        );
        return { text: null, absolutePath };
    }
};

const buildPersonaProfileConfig = (
    persona: PersonaCatalogEntry,
    request: Pick<PostChatRequest, 'surface' | 'botPersonaId'>,
    logger: ChatProfileOverlayLogger
): BotProfileConfig => {
    const overlay = readPersonaOverlayText(persona, request, logger);
    return {
        id: persona.id,
        displayName: persona.displayName,
        mentionAliases: [],
        promptOverlay: {
            source: overlay.text ? 'file' : 'none',
            text: overlay.text,
            path: overlay.absolutePath,
            length: overlay.text?.length ?? 0,
        },
    };
};

/** Resolves expression strength at the backend boundary with fail-open fallback. */
export const resolvePersonaExpression = (
    request: Pick<
        PostChatRequest,
        'personaExpressionProfileStrength' | 'personaExpressionStrength'
    >,
    persona: Pick<BotProfileConfig, 'id' | 'personaExpressionStrength'>,
    configuredProfileStrength:
        string | undefined = persona.personaExpressionStrength ??
        runtimeConfig.profile.personaExpressionStrength
): PersonaExpressionResolution => {
    const requestStrength = parsePersonaExpressionStrength(
        request.personaExpressionStrength
    );
    const profilePreference =
        request.personaExpressionProfileStrength ?? configuredProfileStrength;
    const profileStrength = parsePersonaExpressionStrength(profilePreference);
    const strength =
        requestStrength ??
        profileStrength ??
        PERSONA_CATALOG[persona.id]?.defaultExpressionStrength ??
        'balanced';
    const source = requestStrength
        ? 'request'
        : profileStrength
          ? 'profile'
          : 'persona_default';
    return {
        strength,
        source,
        guidance: buildPersonaExpressionGuidance(strength),
    };
};

export const resolveChatPersonaProfile = (
    request: Pick<PostChatRequest, 'surface' | 'botPersonaId'>,
    logger: ChatProfileOverlayLogger
): BotProfileConfig => {
    if (request.surface === 'discord') {
        const requestedPersonaId = request.botPersonaId?.trim().toLowerCase();
        const matches =
            runtimeConfig.settings.discordBots?.filter(
                (bot) =>
                    bot.enabled !== false &&
                    bot.profile?.id !== undefined &&
                    bot.profile.id === requestedPersonaId
            ) ?? [];
        // Ordinary chat has no node identity; ambiguous configurations retain catalog routing.
        const configured =
            matches.length === 1
                ? resolveInvokingBotProfile(runtimeConfig.profile, {
                      botPersonaId: requestedPersonaId,
                  })
                : requestedPersonaId === runtimeConfig.profile.id
                  ? runtimeConfig.profile
                  : null;
        if (matches.length > 1)
            logger.warn(
                'chat persona configuration is ambiguous; retaining fallback routing',
                {
                    runtimeProfileId: runtimeConfig.profile.id,
                    surface: request.surface,
                    requestedPersonaId,
                }
            );
        if (configured)
            return resolveConfiguredPersonaProfile(configured, logger);
    }
    return buildPersonaProfileConfig(
        resolvePersonaEntry(request, logger),
        request,
        logger
    );
};

/** Operator identity and overlay take precedence over the bundled catalog. */
const resolveConfiguredPersonaProfile = (
    profile: BotProfileConfig,
    logger: ChatProfileOverlayLogger
): BotProfileConfig => {
    if (
        profile.promptOverlay.text?.trim() ||
        profile.promptOverlay.path ||
        profile.promptOverlay.unavailable
    )
        return profile;
    const persona = PERSONA_CATALOG[profile.id];
    if (!persona) return profile;
    const bundled = buildPersonaProfileConfig(
        persona,
        { surface: 'discord', botPersonaId: profile.id },
        logger
    );
    return { ...profile, promptOverlay: bundled.promptOverlay };
};

export type ResolvedVoicePersona = Readonly<{
    profile: BotProfileConfig;
    expression: PersonaExpressionResolution;
    overlaySelection: 'configured' | 'catalog' | 'default';
}>;

type VoicePersonaIdentity = Pick<
    Extract<InternalVoiceRealtimeClientEvent, { type: 'session.start' }>,
    'botPersonaId' | 'discordNodeId' | 'personaExpressionProfileStrength'
>;

/** Looks up existing operator-owned bot configuration; adapter data never supplies overlay text or a path. */
const resolveInvokingBotProfile = (
    fallback: BotProfileConfig,
    identity: VoicePersonaIdentity
): BotProfileConfig => {
    if (!identity.botPersonaId && !identity.discordNodeId) return fallback;
    const bots = runtimeConfig.settings.discordBots ?? [];
    const matches = bots.filter(
        (bot) =>
            bot.enabled !== false &&
            (identity.discordNodeId
                ? bot.id === identity.discordNodeId
                : bot.profile?.id === identity.botPersonaId)
    );
    if (matches.length > 1 || (identity.discordNodeId && matches.length !== 1))
        throw new Error('Configured Voice persona identity is unavailable.');
    const selected = matches[0]?.profile;
    if (selected) {
        if (
            !selected.id ||
            !selected.displayName ||
            (identity.botPersonaId && selected.id !== identity.botPersonaId)
        )
            throw new Error(
                'Configured Voice persona identity is unavailable.'
            );
        const profile = readBotProfileConfig({
            env: {
                BOT_PROFILE_ID: selected.id,
                BOT_PROFILE_DISPLAY_NAME: selected.displayName,
                BOT_PROFILE_MENTION_ALIASES: selected.mentionAliases?.join(','),
                BOT_PROFILE_PROMPT_OVERLAY:
                    fallback.promptOverlay.source === 'inline'
                        ? (fallback.promptOverlay.text ?? undefined)
                        : undefined,
                BOT_PROFILE_PROMPT_OVERLAY_PATH: selected.overlayPath,
                BOT_PROFILE_PERSONA_EXPRESSION_STRENGTH:
                    selected.personaExpressionStrength,
            },
            projectRoot: runtimeConfig.runtime.projectRoot,
            warn: () => undefined,
        });
        // A rejected inherited inline overlay still outranks a node's file overlay.
        if (fallback.promptOverlay.unavailable)
            profile.promptOverlay = { ...fallback.promptOverlay };
        return profile;
    }
    if (identity.discordNodeId)
        throw new Error('Configured Voice persona identity is unavailable.');
    if (identity.botPersonaId === fallback.id) return fallback;
    const persona = PERSONA_CATALOG[identity.botPersonaId ?? ''];
    if (!persona)
        throw new Error('Configured Voice persona identity is unavailable.');
    return {
        id: persona.id,
        displayName: persona.displayName,
        mentionAliases: [],
        promptOverlay: { source: 'none', text: null, path: null, length: 0 },
    };
};

/** Pins backend-owned persona data once per call, separately from speech selection. */
export const resolveVoicePersona = (
    configuredProfile: BotProfileConfig,
    logger: ChatProfileOverlayLogger,
    identity: VoicePersonaIdentity = {}
): ResolvedVoicePersona => {
    configuredProfile = resolveInvokingBotProfile(configuredProfile, identity);
    const effective = resolveConfiguredPersonaProfile(
        configuredProfile,
        logger
    );
    if (
        effective.promptOverlay.unavailable ||
        (!effective.promptOverlay.text?.trim() &&
            (effective.id !== DEFAULT_PERSONA_ID ||
                effective.promptOverlay.path !== null ||
                effective.promptOverlay.source !== 'none'))
    )
        throw new Error('Configured Voice persona overlay is unavailable.');
    const profile: BotProfileConfig = {
        id: effective.id,
        displayName: effective.displayName,
        mentionAliases: [...effective.mentionAliases],
        promptOverlay: { ...effective.promptOverlay },
        personaExpressionStrength: effective.personaExpressionStrength,
    };
    const expression = resolvePersonaExpression(
        {
            personaExpressionProfileStrength:
                identity.personaExpressionProfileStrength,
        },
        profile,
        profile.personaExpressionStrength ??
            runtimeConfig.profile.personaExpressionStrength ??
            ''
    );
    Object.freeze(profile.mentionAliases);
    Object.freeze(profile.promptOverlay);
    Object.freeze(profile);
    Object.freeze(expression);
    return Object.freeze({
        profile,
        expression,
        overlaySelection: configuredProfile.promptOverlay.text?.trim()
            ? 'configured'
            : profile.promptOverlay.text
              ? 'catalog'
              : 'default',
    });
};

/**
 * Uses the shared profile display-name env so non-overlay persona templates
 * resolve to the same name operators configured for the deployment.
 */
export const resolveBotProfileDisplayName = (
    request: Pick<PostChatRequest, 'surface' | 'botPersonaId'>,
    logger: ChatProfileOverlayLogger
): string => resolveChatPersonaProfile(request, logger).displayName;

/**
 * Persona overlay selection is backend-owned and tied to runtime bot profile.
 * Request profile selection is handled separately by chat orchestrator routing.
 */
export const resolveActiveProfileOverlayPrompt = (
    request: Pick<PostChatRequest, 'surface' | 'botPersonaId'>,
    logger: ChatProfileOverlayLogger
): string | null => {
    return buildProfileOverlaySystemMessage(
        resolveChatPersonaProfile(request, logger),
        'chat'
    );
};
