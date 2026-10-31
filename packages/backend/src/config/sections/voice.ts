/**
 * @description: Builds the shared Discord voice mode default and developer identity.
 * @footnote-scope: utility
 * @footnote-module: BackendVoiceSection
 * @footnote-risk: high - Incorrect caller identity or mode defaults can bypass voice limits.
 * @footnote-ethics: high - This configuration controls who can request extended voice processing.
 */
import { envDefaultValues, envSpecByKey } from '@footnote/config-spec';
import { parseOptionalTrimmedString, parseStringUnionEnv } from '../parsers.js';
import type { RuntimeConfig, WarningSink } from '../types.js';

const VOICE_MODES = new Set<'standard' | 'live'>(
    (envSpecByKey.VOICE_DEFAULT_MODE.allowedValues ?? []) as readonly (
        'standard' | 'live'
    )[]
);

export const buildVoiceSection = (
    env: NodeJS.ProcessEnv,
    warn: WarningSink
): RuntimeConfig['voice'] => ({
    defaultMode: parseStringUnionEnv(
        env.VOICE_DEFAULT_MODE,
        envDefaultValues.VOICE_DEFAULT_MODE,
        'VOICE_DEFAULT_MODE',
        VOICE_MODES,
        warn
    ),
    developerUserId: parseOptionalTrimmedString(env.DISCORD_USER_ID),
});
