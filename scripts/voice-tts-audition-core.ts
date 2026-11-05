/**
 * @description: Fixed, synthetic Standard Voice audition matrix and audio checks.
 * @footnote-scope: utility
 * @footnote-module: VoiceTtsAuditionCore
 * @footnote-risk: medium - Matrix drift or an incorrect PCM wrapper can invalidate listening results.
 * @footnote-ethics: high - Only synthetic fixture text is eligible for provider dispatch.
 */
import { randomInt } from 'node:crypto';
import type { OpenRouterSpeechFormat } from '../packages/backend/src/services/openRouterVoice.js';

export const AUDITION_FIXTURE_IDS = [
    'simple-factual',
    'evidence-limits',
    'rationale-extent',
    'caution-tradeoff',
] as const;

export type PilotPersona = 'footnote' | 'winter';
export type AuditionCase = { id: string; originalAnswer: string };
export type PcmContract = {
    sampleRateHz: number;
    channels: number;
    bitsPerSample: 16;
    encoding: 'signed-integer-little-endian';
};

type AuditionCandidate = {
    model: string;
    voices: Record<PilotPersona, string>;
    responseFormat: OpenRouterSpeechFormat;
    supportsInstructions: boolean;
    instructions?: Record<PilotPersona, string>;
    pcmContract: PcmContract | null;
};

export const AUDITION_CANDIDATES: readonly AuditionCandidate[] = [
    {
        model: 'google/gemini-3.8-flash-lite-tts',
        voices: { footnote: 'Kore', winter: 'Charon' },
        responseFormat: 'pcm',
        supportsInstructions: true,
        instructions: {
            footnote: 'Clear, calm, grounded, conversational.',
            winter: 'Dry, direct, controlled, understated.',
        },
        pcmContract: {
            sampleRateHz: 24_000,
            channels: 1,
            bitsPerSample: 16,
            encoding: 'signed-integer-little-endian',
        },
    },
    {
        model: 'microsoft/mai-voice-2.1-flash',
        voices: {
            footnote: 'en-US-Harper:MAI-Voice-2.1-Flash',
            winter: 'en-US-Grant:MAI-Voice-2.1-Flash',
        },
        responseFormat: 'mp3',
        supportsInstructions: false,
        pcmContract: null,
    },
    {
        model: 'x-ai/grok-voice-tts-1.0',
        voices: { footnote: 'eve', winter: 'rex' },
        responseFormat: 'mp3',
        supportsInstructions: false,
        pcmContract: null,
    },
    {
        model: 'hexgrad/kokoro-82m',
        voices: { footnote: 'af_heart', winter: 'am_onyx' },
        responseFormat: 'mp3',
        supportsInstructions: false,
        pcmContract: null,
    },
];

export type AuditionRequest = {
    model: string;
    persona: PilotPersona;
    voice: string;
    fixtureId: (typeof AUDITION_FIXTURE_IDS)[number];
    sampleKind: 'primary' | 'repeat';
    text: string;
    responseFormat: OpenRouterSpeechFormat;
    instructions?: string;
    pcmContract: PcmContract | null;
};

const personas: readonly PilotPersona[] = ['footnote', 'winter'];
export const MAX_AUDITION_REQUESTS = 40;
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 60_000;
export const SPEND_LIMIT_USD = 1;

export const parseAuditionArguments = (
    args: readonly string[]
): { execute: boolean; confirmSpendLimit: boolean } => {
    const accepted = new Set([
        '--execute',
        '--dry-run',
        `--confirm-openrouter-key-limit-usd=${SPEND_LIMIT_USD}`,
    ]);
    const unknown = args.filter((arg) => !accepted.has(arg));
    if (unknown.length > 0)
        throw new TypeError(`Unsupported audition option: ${unknown[0]}`);
    if (args.includes('--execute') && args.includes('--dry-run'))
        throw new TypeError('Choose either --execute or --dry-run.');
    const confirmSpendLimit = args.includes(
        `--confirm-openrouter-key-limit-usd=${SPEND_LIMIT_USD}`
    );
    if (args.includes('--execute') && !confirmSpendLimit)
        throw new TypeError(
            `Execution requires --confirm-openrouter-key-limit-usd=${SPEND_LIMIT_USD}.`
        );
    if (confirmSpendLimit && !args.includes('--execute'))
        throw new TypeError(
            'The key-limit confirmation is only valid with --execute.'
        );
    return { execute: args.includes('--execute'), confirmSpendLimit };
};

export const createAuditionMatrix = (
    fixtureCases: readonly AuditionCase[]
): AuditionRequest[] => {
    const byId = new Map(fixtureCases.map((item) => [item.id, item]));
    if (byId.size !== fixtureCases.length)
        throw new TypeError('Audition fixture IDs must be unique.');

    for (const id of AUDITION_FIXTURE_IDS) {
        const item = byId.get(id);
        if (
            !item ||
            !item.originalAnswer ||
            item.originalAnswer.trim() !== item.originalAnswer
        )
            throw new TypeError(
                `Audition fixture ${id} is missing exact source text.`
            );
        if (item.originalAnswer.length > 8_192)
            throw new TypeError(
                `Audition fixture ${id} exceeds the speech input limit.`
            );
    }

    const result: AuditionRequest[] = [];
    for (const candidate of AUDITION_CANDIDATES) {
        for (const persona of personas) {
            for (const fixtureId of AUDITION_FIXTURE_IDS) {
                const request = {
                    model: candidate.model,
                    persona,
                    voice: candidate.voices[persona],
                    fixtureId,
                    sampleKind: 'primary' as const,
                    text: byId.get(fixtureId)!.originalAnswer,
                    responseFormat: candidate.responseFormat,
                    pcmContract: candidate.pcmContract,
                };
                const instructions = candidate.instructions?.[persona];
                result.push({
                    ...request,
                    ...(instructions && { instructions }),
                });
            }
            const repeatFixtureId: AuditionRequest['fixtureId'] =
                'caution-tradeoff';
            const request = {
                model: candidate.model,
                persona,
                voice: candidate.voices[persona],
                fixtureId: repeatFixtureId,
                sampleKind: 'repeat' as const,
                text: byId.get(repeatFixtureId)!.originalAnswer,
                responseFormat: candidate.responseFormat,
                pcmContract: candidate.pcmContract,
            };
            const instructions = candidate.instructions?.[persona];
            result.push({ ...request, ...(instructions && { instructions }) });
        }
    }

    if (result.length !== MAX_AUDITION_REQUESTS)
        throw new TypeError('Audition request count exceeded its fixed limit.');
    return result;
};

export const pcm16MonoToWav = (pcm: Buffer, contract: PcmContract): Buffer => {
    if (
        contract.channels !== 1 ||
        contract.bitsPerSample !== 16 ||
        contract.encoding !== 'signed-integer-little-endian' ||
        !Number.isInteger(contract.sampleRateHz) ||
        contract.sampleRateHz <= 0 ||
        pcm.length < 2 ||
        pcm.length > MAX_RESPONSE_BYTES ||
        pcm.length % 2 !== 0
    ) {
        throw new TypeError('Audio does not match the verified PCM contract.');
    }

    const wav = Buffer.alloc(44 + pcm.length);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + pcm.length, 4);
    wav.write('WAVE', 8);
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(contract.channels, 22);
    wav.writeUInt32LE(contract.sampleRateHz, 24);
    wav.writeUInt32LE(
        contract.sampleRateHz *
            contract.channels *
            (contract.bitsPerSample / 8),
        28
    );
    wav.writeUInt16LE(contract.channels * (contract.bitsPerSample / 8), 32);
    wav.writeUInt16LE(contract.bitsPerSample, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(pcm.length, 40);
    pcm.copy(wav, 44);
    return wav;
};

export const randomizedOrder = <T>(items: readonly T[]): T[] => {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const other = randomInt(index + 1);
        [shuffled[index], shuffled[other]] = [
            shuffled[other]!,
            shuffled[index]!,
        ];
    }
    return shuffled;
};
