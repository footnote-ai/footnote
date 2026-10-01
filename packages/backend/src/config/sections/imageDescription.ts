/**
 * @description: Builds provider settings for backend-owned image-description tasks.
 * @footnote-scope: utility
 * @footnote-module: BackendImageDescriptionSection
 * @footnote-risk: medium - Incorrect provider settings can disable attachment grounding or route images unexpectedly.
 * @footnote-ethics: high - This setting determines which provider receives user images.
 */
import { envDefaultValues, envSpecByKey } from '@footnote/config-spec';
import {
    parseOptionalTrimmedString,
    parsePositiveIntEnv,
    parseStringUnionEnv,
} from '../parsers.js';
import type { RuntimeConfig, WarningSink } from '../types.js';

const providers = new Set<'openai' | 'ollama' | 'openrouter'>(
    envSpecByKey.IMAGE_DESCRIPTION_PROVIDER.allowedValues as readonly (
        'openai' | 'ollama' | 'openrouter'
    )[]
);

export const buildImageDescriptionSection = (
    env: NodeJS.ProcessEnv,
    warn: WarningSink
): RuntimeConfig['imageDescription'] => ({
    provider: parseStringUnionEnv(
        env.IMAGE_DESCRIPTION_PROVIDER,
        envDefaultValues.IMAGE_DESCRIPTION_PROVIDER,
        'IMAGE_DESCRIPTION_PROVIDER',
        providers,
        warn
    ),
    baseUrl: parseOptionalTrimmedString(env.IMAGE_DESCRIPTION_BASE_URL),
    model: parseOptionalTrimmedString(env.IMAGE_DESCRIPTION_MODEL),
    requestTimeoutMs: parsePositiveIntEnv(
        env.IMAGE_DESCRIPTION_TIMEOUT_MS,
        envDefaultValues.IMAGE_DESCRIPTION_TIMEOUT_MS,
        'IMAGE_DESCRIPTION_TIMEOUT_MS',
        warn
    ),
});
