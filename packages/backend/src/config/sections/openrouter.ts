/**
 * @description: Builds explicit OpenRouter connectivity settings for backend model profiles.
 * @footnote-scope: utility
 * @footnote-module: BackendOpenRouterSection
 * @footnote-risk: medium - A malformed endpoint can make configured OpenRouter profiles unavailable.
 * @footnote-ethics: high - This configuration controls a third-party route for user prompts.
 */

import { envDefaultValues } from '@footnote/config-spec';
import { parseOptionalTrimmedString } from '../parsers.js';
import type { RuntimeConfig } from '../types.js';

/** Builds the named OpenRouter section without reusing OpenAI credentials. */
export const buildOpenRouterSection = (
    env: NodeJS.ProcessEnv
): RuntimeConfig['openrouter'] => ({
    apiKey: parseOptionalTrimmedString(env.OPENROUTER_API_KEY),
    baseUrl:
        parseOptionalTrimmedString(env.OPENROUTER_BASE_URL) ??
        envDefaultValues.OPENROUTER_BASE_URL,
});
