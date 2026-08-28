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
    PresentationGenerationSettings,
    PresentationSettingName,
    PresentationSettingOmissionReasonCode,
    SupportedReasoningEffort,
} from '@footnote/contracts';
import type { GenerationRequest } from '@footnote/agent-runtime';
import type { ChatSurface } from '@footnote/contracts/web';
import { hmacId } from '../utils/pseudonymization.js';

type RuntimeControlLogger = {
    debug: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
};

export type PresentationSettingsResolution = {
    requested: PresentationGenerationSettings;
    forwarded: PresentationGenerationSettings;
    omitted: Array<{
        setting: PresentationSettingName;
        requested: string | number;
        reasonCode: PresentationSettingOmissionReasonCode;
    }>;
};

type PresentationSettingsRequestBase = Pick<
    GenerationRequest,
    'maxOutputTokens' | 'reasoningEffort' | 'verbosity' | 'temperature' | 'topP'
>;

const addPresentationOmission = (
    omitted: PresentationSettingsResolution['omitted'],
    setting: PresentationSettingName,
    requested: string | number,
    reasonCode: PresentationSettingOmissionReasonCode
): void => {
    omitted.push({ setting, requested, reasonCode });
};

/**
 * Resolves presentation settings in backend authority before runtime use.
 * Provider adapters never decide whether a setting is allowed; unsupported
 * settings are omitted here so presentation stays fail-open.
 */
export const resolvePresentationGenerationSettings = (input: {
    profile: ModelProfile;
    request: PresentationSettingsRequestBase;
}): PresentationSettingsResolution => {
    const configured = input.profile.presentationGeneration ?? {};
    const requested: PresentationGenerationSettings = {
        ...(input.request.maxOutputTokens !== undefined && {
            maxOutputTokens: input.request.maxOutputTokens,
        }),
        ...(input.request.reasoningEffort !== undefined && {
            reasoningEffort: input.request.reasoningEffort,
        }),
        ...(input.request.verbosity !== undefined && {
            verbosity: input.request.verbosity,
        }),
        ...(input.request.temperature !== undefined && {
            temperature: input.request.temperature,
        }),
        ...(input.request.topP !== undefined && { topP: input.request.topP }),
        ...configured,
    };
    // A profile control is authoritative for presentation. Do not carry an
    // opposite control from the broader generation request into the candidate.
    if (configured.temperature !== undefined) {
        delete requested.topP;
    }
    if (configured.topP !== undefined) {
        delete requested.temperature;
    }
    const forwarded: PresentationGenerationSettings = {};
    const omitted: PresentationSettingsResolution['omitted'] = [];

    if (requested.promptVariant !== undefined) {
        forwarded.promptVariant = requested.promptVariant;
    }

    if (requested.maxOutputTokens !== undefined) {
        const maximum = input.profile.maxOutputTokens;
        if (maximum !== undefined && requested.maxOutputTokens > maximum) {
            forwarded.maxOutputTokens = maximum;
            addPresentationOmission(
                omitted,
                'maxOutputTokens',
                requested.maxOutputTokens,
                'output_limit_exceeds_profile_maximum'
            );
        } else {
            forwarded.maxOutputTokens = requested.maxOutputTokens;
        }
    }

    if (requested.reasoningEffort !== undefined) {
        if (
            input.profile.capabilities.supportedReasoningEfforts?.includes(
                requested.reasoningEffort
            )
        ) {
            forwarded.reasoningEffort = requested.reasoningEffort;
        } else {
            addPresentationOmission(
                omitted,
                'reasoningEffort',
                requested.reasoningEffort,
                'reasoning_effort_not_supported'
            );
        }
    }

    if (requested.verbosity !== undefined) {
        if (
            input.profile.capabilities.supportedVerbosity?.includes(
                requested.verbosity
            )
        ) {
            forwarded.verbosity = requested.verbosity;
        } else {
            addPresentationOmission(
                omitted,
                'verbosity',
                requested.verbosity,
                'verbosity_not_supported'
            );
        }
    }

    const samplingControls =
        input.profile.capabilities.supportedSamplingControls ?? [];
    const hasTemperature = requested.temperature !== undefined;
    const hasTopP = requested.topP !== undefined;
    if (hasTemperature && hasTopP) {
        addPresentationOmission(
            omitted,
            'temperature',
            requested.temperature as number,
            'sampling_controls_mutually_exclusive'
        );
        addPresentationOmission(
            omitted,
            'topP',
            requested.topP as number,
            'sampling_controls_mutually_exclusive'
        );
    } else if (hasTemperature) {
        if (samplingControls.includes('temperature')) {
            forwarded.temperature = requested.temperature;
        } else {
            addPresentationOmission(
                omitted,
                'temperature',
                requested.temperature as number,
                'sampling_control_not_supported'
            );
        }
    } else if (hasTopP) {
        if (samplingControls.includes('topP')) {
            forwarded.topP = requested.topP;
        } else {
            addPresentationOmission(
                omitted,
                'topP',
                requested.topP as number,
                'sampling_control_not_supported'
            );
        }
    }

    return { requested, forwarded, omitted };
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
