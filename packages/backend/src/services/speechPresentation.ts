/**
 * @description: Resolves backend-owned speech settings and their precedence for TTS and Realtime.
 * @footnote-scope: core
 * @footnote-module: SpeechPresentation
 * @footnote-risk: high - Incorrect precedence changes both speech paths and effective-provider metadata.
 * @footnote-ethics: high - Persona delivery guidance affects user-facing identity and must not inherit TRACE caution.
 */
import type { BotProfileConfig } from '../config/profile.js';

export type SpeechModality = 'tts' | 'realtime';
export type SpeechSelectionSource =
    | 'request_or_session'
    | 'operator_profile'
    | 'persona_default'
    | 'deployment_fallback';

export type SpeechSelection = {
    profileId: string;
    modality: SpeechModality;
    provider: string;
    model: string;
    voice: string;
    delivery: string | null;
    requestedVoice: string | null;
    selectionSource: {
        model: SpeechSelectionSource;
        voice: SpeechSelectionSource;
        delivery: SpeechSelectionSource;
    };
    fallbackReason: string | null;
};

export class UnsupportedSpeechSelectionError extends Error {
    public readonly code = 'unsupported_speech_selection';

    constructor(modality: SpeechModality) {
        super(
            `Requested ${modality} model or voice is not supported by the configured provider.`
        );
        this.name = 'UnsupportedSpeechSelectionError';
    }
}

type ResolveSpeechSelectionInput = {
    profile: BotProfileConfig;
    provider: string;
    modality: SpeechModality;
    request?: { model?: string; voice?: string; delivery?: string };
    fallback: { model: string; voice: string };
    ignoreOperatorModel?: boolean;
    ignoreOperatorVoice?: boolean;
    fallbackReason?: string | null;
};

const choose = (
    requested: string | undefined,
    operator: string | undefined,
    fallback: string
): { value: string; source: SpeechSelectionSource } => {
    if (requested?.trim()) {
        return { value: requested.trim(), source: 'request_or_session' };
    }
    if (operator?.trim()) {
        return { value: operator.trim(), source: 'operator_profile' };
    }
    return { value: fallback, source: 'deployment_fallback' };
};

/** Resolve explicit settings before profile overrides and deployment fallbacks. */
export const resolveSpeechSelection = ({
    profile,
    provider,
    modality,
    request,
    fallback,
    ignoreOperatorModel = false,
    ignoreOperatorVoice = false,
    fallbackReason = null,
}: ResolveSpeechSelectionInput): SpeechSelection => {
    const operator = profile.speechPresentation ?? {};
    const model = choose(
        request?.model,
        ignoreOperatorModel
            ? undefined
            : modality === 'tts'
              ? operator.ttsModel
              : operator.realtimeModel,
        fallback.model
    );
    const voice = choose(
        request?.voice,
        ignoreOperatorVoice
            ? undefined
            : modality === 'tts'
              ? operator.ttsVoice
              : operator.realtimeVoice,
        fallback.voice
    );
    const delivery = choose(
        request?.delivery,
        modality === 'tts' ? operator.ttsDelivery : operator.realtimeDelivery,
        ''
    );

    return {
        profileId: profile.id,
        modality,
        provider,
        model: model.value,
        voice: voice.value,
        delivery: delivery.value || null,
        requestedVoice: request?.voice?.trim() || null,
        selectionSource: {
            model: model.source,
            voice: voice.source,
            delivery: delivery.source,
        },
        fallbackReason,
    };
};
