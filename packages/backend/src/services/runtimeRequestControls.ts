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
} from '@footnote/contracts';
import type { GenerationRequest } from '@footnote/agent-runtime';
import type { ChatSurface } from '@footnote/contracts/web';
import { hmacId } from '../utils/pseudonymization.js';
import { resolveDefaultGenerationMaxOutputTokens } from './workflowEngine/tokenBudget.js';

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

type ModelRequestSettings = Pick<
    GenerationRequest,
    'maxOutputTokens' | 'reasoningEffort' | 'verbosity' | 'temperature' | 'topP'
>;

export type ModelSettingName = Exclude<
    PresentationSettingName,
    'promptVariant'
>;

export type ModelSettingReasonCode = PresentationSettingOmissionReasonCode;

/**
 * Backend-owned receipt for controls resolved before one model-backed Attempt.
 * It records configuration intent rather than provider-observed values, which
 * remain outside this seam until execution has completed.
 */
export type ModelSettingsResolution = {
    requested: ModelRequestSettings;
    applied: ModelRequestSettings;
    ignored: Array<{
        setting: ModelSettingName;
        requested: string | number;
        reasonCode: ModelSettingReasonCode;
    }>;
    adjusted: Array<{
        setting: 'maxOutputTokens';
        requested: number;
        applied: number;
        reasonCode: 'output_limit_exceeds_profile_maximum';
    }>;
};

const toRequestedSettings = (
    request: ModelRequestSettings
): ModelRequestSettings => ({
    ...(request.maxOutputTokens !== undefined && {
        maxOutputTokens: request.maxOutputTokens,
    }),
    ...(request.reasoningEffort !== undefined && {
        reasoningEffort: request.reasoningEffort,
    }),
    ...(request.verbosity !== undefined && { verbosity: request.verbosity }),
    ...(request.temperature !== undefined && {
        temperature: request.temperature,
    }),
    ...(request.topP !== undefined && { topP: request.topP }),
});

const addIgnoredModelSetting = (
    ignored: ModelSettingsResolution['ignored'],
    setting: ModelSettingName,
    requested: string | number,
    reasonCode: ModelSettingReasonCode
): void => {
    ignored.push({ setting, requested, reasonCode });
};

/**
 * Resolves the provider-neutral generation controls for the actual selected
 * profile of one Attempt. Missing or unsupported controls are omitted rather
 * than sent speculatively so routing remains fail-open.
 */
export const resolveModelSettings = (input: {
    profile: ModelProfile;
    request: ModelRequestSettings;
    /** Presentation preserves its historical opt-in-only default behavior. */
    applyProfileDefaults?: boolean;
    /** Missing capability metadata remains fail-open outside presentation. */
    applyUnknownControls?: boolean;
}): ModelSettingsResolution => {
    const requested = toRequestedSettings(input.request);
    const applied: ModelRequestSettings = {};
    const ignored: ModelSettingsResolution['ignored'] = [];
    const adjusted: ModelSettingsResolution['adjusted'] = [];
    const effectiveReasoningEffort =
        requested.reasoningEffort ??
        (input.applyProfileDefaults === false
            ? undefined
            : input.profile.defaultReasoningEffort);

    const requestedOutputTokens =
        requested.maxOutputTokens ??
        (input.applyProfileDefaults === false
            ? undefined
            : resolveDefaultGenerationMaxOutputTokens({
                  reasoningEffort: effectiveReasoningEffort,
                  capabilities: input.profile.capabilities,
              }));
    const profileMaximum = input.profile.maxOutputTokens;
    const appliedOutputTokens =
        requestedOutputTokens === undefined
            ? undefined
            : profileMaximum === undefined
              ? requestedOutputTokens
              : Math.min(requestedOutputTokens, profileMaximum);
    if (appliedOutputTokens !== undefined) {
        applied.maxOutputTokens = appliedOutputTokens;
    }
    if (
        requested.maxOutputTokens !== undefined &&
        appliedOutputTokens !== undefined &&
        requested.maxOutputTokens !== appliedOutputTokens
    ) {
        adjusted.push({
            setting: 'maxOutputTokens',
            requested: requested.maxOutputTokens,
            applied: appliedOutputTokens,
            reasonCode: 'output_limit_exceeds_profile_maximum',
        });
    }

    if (effectiveReasoningEffort !== undefined) {
        if (
            input.profile.capabilities.supportedReasoningEfforts === undefined
                ? input.applyUnknownControls !== false
                : input.profile.capabilities.supportedReasoningEfforts.includes(
                      effectiveReasoningEffort
                  )
        ) {
            applied.reasoningEffort = effectiveReasoningEffort;
        } else {
            addIgnoredModelSetting(
                ignored,
                'reasoningEffort',
                effectiveReasoningEffort,
                'reasoning_effort_not_supported'
            );
        }
    }

    if (requested.verbosity !== undefined) {
        if (
            input.profile.capabilities.supportedVerbosity === undefined
                ? input.applyUnknownControls !== false
                : input.profile.capabilities.supportedVerbosity.includes(
                      requested.verbosity
                  )
        ) {
            applied.verbosity = requested.verbosity;
        } else {
            addIgnoredModelSetting(
                ignored,
                'verbosity',
                requested.verbosity,
                'verbosity_not_supported'
            );
        }
    }

    const samplingControls =
        input.profile.capabilities.supportedSamplingControls;
    if (requested.temperature !== undefined && requested.topP !== undefined) {
        addIgnoredModelSetting(
            ignored,
            'temperature',
            requested.temperature,
            'sampling_controls_mutually_exclusive'
        );
        addIgnoredModelSetting(
            ignored,
            'topP',
            requested.topP,
            'sampling_controls_mutually_exclusive'
        );
    } else if (requested.temperature !== undefined) {
        if (
            samplingControls === undefined
                ? input.applyUnknownControls !== false
                : samplingControls.includes('temperature')
        ) {
            applied.temperature = requested.temperature;
        } else {
            addIgnoredModelSetting(
                ignored,
                'temperature',
                requested.temperature,
                'sampling_control_not_supported'
            );
        }
    } else if (requested.topP !== undefined) {
        if (
            samplingControls === undefined
                ? input.applyUnknownControls !== false
                : samplingControls.includes('topP')
        ) {
            applied.topP = requested.topP;
        } else {
            addIgnoredModelSetting(
                ignored,
                'topP',
                requested.topP,
                'sampling_control_not_supported'
            );
        }
    }

    return { requested, applied, ignored, adjusted };
};

/** Replaces only model controls while retaining the rest of a request intact. */
export const applyModelSettings = (
    request: GenerationRequest,
    settings: ModelSettingsResolution['applied']
): GenerationRequest => {
    const resolvedRequest: GenerationRequest = { ...request };
    delete resolvedRequest.maxOutputTokens;
    delete resolvedRequest.reasoningEffort;
    delete resolvedRequest.verbosity;
    delete resolvedRequest.temperature;
    delete resolvedRequest.topP;
    return { ...resolvedRequest, ...settings };
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
    const requestedControls: ModelRequestSettings = {
        maxOutputTokens:
            configured.maxOutputTokens ?? input.request.maxOutputTokens,
        reasoningEffort:
            configured.reasoningEffort ?? input.request.reasoningEffort,
        verbosity: configured.verbosity ?? input.request.verbosity,
        temperature: configured.temperature ?? input.request.temperature,
        topP: configured.topP ?? input.request.topP,
    };
    // A profile control is authoritative for presentation. Do not carry an
    // opposite control from the broader generation request into the candidate.
    if (configured.temperature !== undefined) {
        delete requestedControls.topP;
    }
    if (configured.topP !== undefined) {
        delete requestedControls.temperature;
    }
    const resolution = resolveModelSettings({
        profile: input.profile,
        request: requestedControls,
        applyProfileDefaults: false,
        applyUnknownControls: false,
    });
    const requested: PresentationGenerationSettings = {
        ...resolution.requested,
        ...(configured.promptVariant !== undefined && {
            promptVariant: configured.promptVariant,
        }),
    };
    const forwarded: PresentationGenerationSettings = {
        ...resolution.applied,
        ...(configured.promptVariant !== undefined && {
            promptVariant: configured.promptVariant,
        }),
    };
    const omitted: PresentationSettingsResolution['omitted'] = [
        ...resolution.ignored,
        ...resolution.adjusted.map(
            ({ setting, requested: value, reasonCode }) => ({
                setting,
                requested: value,
                reasonCode,
            })
        ),
    ];

    return { requested, forwarded, omitted };
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
