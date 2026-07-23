/**
 * @description: Resolves backend-owned model request controls before provider execution.
 * It capability-gates reasoning and derives privacy-preserving OpenAI safety identifiers.
 * @footnote-scope: core
 * @footnote-module: RuntimeRequestControls
 * @footnote-risk: high - Incorrect control resolution can silently change model behavior across routed calls.
 * @footnote-ethics: high - Safety identifier derivation and logging directly affect user privacy.
 */
import type {
    ModelProfile,
    SupportedReasoningEffort,
} from '@footnote/contracts';
import type { ChatSurface } from '@footnote/contracts/web';
import { hmacId } from '../utils/pseudonymization.js';

type RuntimeControlLogger = {
    debug: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
};

/**
 * Preserves an explicit caller request and falls back to the profile default
 * only when no effort was requested. The selected profile must advertise the
 * effective effort; unsupported controls are omitted so execution stays
 * fail-open instead of sending an invalid provider value.
 */
export const resolveProfileReasoningEffort = (
    profile: ModelProfile,
    requestedEffort: SupportedReasoningEffort | undefined,
    logger: RuntimeControlLogger
): SupportedReasoningEffort | undefined => {
    const supportedEfforts = profile.capabilities.supportedReasoningEfforts;
    const profileDefault = profile.defaultReasoningEffort;
    const candidate = requestedEffort ?? profileDefault;

    if (candidate === undefined) {
        return undefined;
    }

    if (!supportedEfforts?.includes(candidate)) {
        logger.warn('Reasoning effort omitted for selected model profile.', {
            reasonCode: 'reasoning_effort_not_supported',
            profileId: profile.id,
            provider: profile.provider,
            model: profile.providerModel,
            requestedEffort,
            profileDefault,
        });
        return undefined;
    }

    if (requestedEffort === undefined && profileDefault !== undefined) {
        logger.debug('Model profile default reasoning effort applied.', {
            reasonCode: 'reasoning_effort_profile_default_applied',
            profileId: profile.id,
            provider: profile.provider,
            model: profile.providerModel,
            requestedEffort,
            effectiveEffort: profileDefault,
        });
    }

    return candidate;
};

/**
 * Derives the provider-facing identifier inside backend authority. The raw
 * surface user id is never returned, stored, or included in diagnostics.
 */
export const deriveOpenAiSafetyIdentifier = (
    input: {
        secret: string | null | undefined;
        surface: ChatSurface;
        userId: string | null | undefined;
    },
    logger: RuntimeControlLogger
): string | undefined => {
    const secret = input.secret?.trim();
    if (!secret) {
        logger.debug('OpenAI safety identifier omitted.', {
            reasonCode: 'safety_identifier_secret_missing',
            surface: input.surface,
        });
        return undefined;
    }

    const userId = input.userId?.trim();
    if (!userId) {
        logger.debug('OpenAI safety identifier omitted.', {
            reasonCode: 'safety_identifier_user_missing',
            surface: input.surface,
        });
        return undefined;
    }

    return hmacId(secret, userId, `openai-safety:v1:${input.surface}`);
};
