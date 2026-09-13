/**
 * @description: Builds backend Ollama connectivity config used by model-profile provider routing.
 * @footnote-scope: utility
 * @footnote-module: BackendOllamaSection
 * @footnote-risk: medium - Wrong base URL or enablement parsing can make Ollama profiles appear healthy when they are not.
 * @footnote-ethics: medium - Provider routing determines where user prompts are processed.
 */

import {
    parseBooleanFlag,
    parseNonNegativeIntEnv,
    parseOptionalTrimmedString,
    parsePositiveIntEnv,
} from '../parsers.js';
import { envDefaultValues } from '@footnote/config-spec';
import type { RuntimeConfig, WarningSink } from '../types.js';

/**
 * Builds the Ollama section from env.
 *
 * This section is intentionally lightweight: provider profile availability
 * checks happen in model profile catalog loading.
 */
export const buildOllamaSection = (
    env: NodeJS.ProcessEnv,
    warn: WarningSink
): RuntimeConfig['ollama'] => ({
    baseUrl: parseOptionalTrimmedString(env.OLLAMA_BASE_URL),
    apiKey: parseOptionalTrimmedString(env.OLLAMA_API_KEY),
    localInferenceEnabled: parseBooleanFlag(env.OLLAMA_LOCAL_INFERENCE_ENABLED),
    maxConcurrentGenerations: parsePositiveIntEnv(
        env.OLLAMA_MAX_CONCURRENT_GENERATIONS,
        envDefaultValues.OLLAMA_MAX_CONCURRENT_GENERATIONS,
        'OLLAMA_MAX_CONCURRENT_GENERATIONS',
        warn
    ),
    maxQueuedGenerations: parseNonNegativeIntEnv(
        env.OLLAMA_MAX_QUEUED_GENERATIONS,
        envDefaultValues.OLLAMA_MAX_QUEUED_GENERATIONS,
        'OLLAMA_MAX_QUEUED_GENERATIONS',
        warn
    ),
});
