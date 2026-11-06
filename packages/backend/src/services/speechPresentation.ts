/**
 * @description: Resolves backend-owned speech settings and their precedence for TTS and Realtime.
 * @footnote-scope: core
 * @footnote-module: SpeechPresentation
 * @footnote-risk: high - Incorrect precedence changes both speech paths and effective-provider metadata.
 * @footnote-ethics: high - Persona delivery guidance affects user-facing identity and must not inherit TRACE caution.
 */
import { randomInt as cryptoRandomInt } from 'node:crypto';
import type { PersonaExpressionStrength } from '@footnote/contracts/policy';
import type { BotProfileConfig } from '../config/profile.js';

export type SpeechModality = 'tts' | 'realtime';
export type SpeechSelectionSource =
    | 'request_or_session'
    | 'operator_profile'
    | 'bundled_persona_default'
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
    fallback: {
        model: string;
        voice: string;
        modelSource?: SpeechSelectionSource;
        voiceSource?: SpeechSelectionSource;
    };
    ignoreOperatorModel?: boolean;
    ignoreOperatorVoice?: boolean;
    fallbackReason?: string | null;
};

type VoiceProgressPhrasePools = Record<
    PersonaExpressionStrength,
    readonly string[]
>;

const DEFAULT_VOICE_PROGRESS_PHRASES: Record<string, VoiceProgressPhrasePools> =
    {
        footnote: {
            subtle: [
                'I’ll take a moment with that.',
                'Let me work through that.',
            ],
            balanced: [
                'I’ll think that through for a moment.',
                'I’m working through it now.',
                'One moment while I sort this out.',
            ],
            strong: [
                'Let me untangle the pieces for a moment.',
                'I’ll work through that carefully.',
            ],
        },
        danny: {
            subtle: [
                'I’ll take a moment to consider that.',
                'Let me work through it carefully.',
            ],
            balanced: [
                'I’ll take a moment and work through this.',
                'Let me consider that carefully.',
                'I’m working through that step by step.',
            ],
            strong: [
                'I’ll take a moment and think through the question carefully.',
                'Let me consider that from a couple of angles.',
            ],
        },
        myuri: {
            subtle: [
                'Let me untangle that for a moment.',
                'I’ll sort through that thought.',
            ],
            balanced: [
                'Hmm, give me a moment to connect the pieces.',
                'Let me untangle that little knot.',
                'I’ll follow that thread for a moment.',
            ],
            strong: [
                'A few threads to sort out—give me a moment.',
                'Let me untangle this one for a moment.',
            ],
        },
        winter: {
            subtle: ['One moment.', 'I’ll take a moment with that.'],
            balanced: [
                'One moment while I think it through.',
                'I’m working through that now.',
                'Let me give that a moment.',
            ],
            strong: [
                'I’ll think that through carefully.',
                'One moment while I work through the details.',
            ],
        },
    };

const DEFAULT_CUSTOM_VOICE_PROGRESS_PHRASES: VoiceProgressPhrasePools = {
    subtle: ['One moment.', 'I’ll take a moment with that.'],
    balanced: [
        'One moment while I work through that.',
        'I’ll take a moment to think this through.',
    ],
    strong: [
        'Let me work through that carefully.',
        'I’ll take a moment to sort that out.',
    ],
};

/** Selects a short cue locally; injected indexes keep phrase choice reproducible in tests. */
export const selectVoiceProgressPhrase = ({
    profileId,
    expressionStrength,
    operatorPhrases,
    randomInt = cryptoRandomInt,
}: {
    profileId: string;
    expressionStrength: PersonaExpressionStrength;
    operatorPhrases?: readonly string[];
    randomInt?: (max: number) => number;
}): string => {
    const configured = operatorPhrases?.filter((phrase) => phrase.trim());
    const normalizedId = profileId.trim().toLowerCase();
    const defaults = Object.hasOwn(DEFAULT_VOICE_PROGRESS_PHRASES, normalizedId)
        ? DEFAULT_VOICE_PROGRESS_PHRASES[normalizedId]!
        : DEFAULT_CUSTOM_VOICE_PROGRESS_PHRASES;
    const pool = configured?.length ? configured : defaults[expressionStrength];
    return pool[randomInt(pool.length)]!;
};

const choose = (
    requested: string | undefined,
    operator: string | undefined,
    fallback: string,
    fallbackSource: SpeechSelectionSource = 'deployment_fallback'
): { value: string; source: SpeechSelectionSource } => {
    if (requested?.trim()) {
        return { value: requested.trim(), source: 'request_or_session' };
    }
    if (operator?.trim()) {
        return { value: operator.trim(), source: 'operator_profile' };
    }
    return { value: fallback, source: fallbackSource };
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
        fallback.model,
        fallback.modelSource
    );
    const voice = choose(
        request?.voice,
        ignoreOperatorVoice
            ? undefined
            : modality === 'tts'
              ? operator.ttsVoice
              : operator.realtimeVoice,
        fallback.voice,
        fallback.voiceSource
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
