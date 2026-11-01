/**
 * @description: Sends transient call audio and approved speech text to OpenRouter.
 * @footnote-scope: core
 * @footnote-module: OpenRouterVoiceService
 * @footnote-risk: high - Incorrect audio boundaries can send private or malformed content to a provider.
 * @footnote-ethics: high - Voice audio and transcripts stay transient and are never logged here.
 */
export type OpenRouterAudioUsage = {
    seconds?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costUsd?: number;
};

export type OpenRouterVoiceService = {
    transcribe(
        pcm24KhzMono: Buffer,
        signal?: AbortSignal
    ): Promise<{ text: string; usage?: OpenRouterAudioUsage }>;
    synthesize(
        text: string,
        options: { model: string; voice: string; instructions?: string | null },
        signal?: AbortSignal
    ): Promise<{ audio: Buffer; generationId?: string }>;
};

const MAX_UTTERANCE_BYTES = 2_880_000;
const MAX_TRANSCRIPT_LENGTH = 8_192;
const MAX_SYNTHESIS_BYTES = 10 * 1024 * 1024;

const pcmToWav = (pcm: Buffer): Buffer => {
    if (
        pcm.length < 2 ||
        pcm.length > MAX_UTTERANCE_BYTES ||
        pcm.length % 2 !== 0
    ) {
        throw new TypeError('Voice utterance audio is empty or out of bounds.');
    }
    const wav = Buffer.alloc(44 + pcm.length);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + pcm.length, 4);
    wav.write('WAVE', 8);
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24_000, 24);
    wav.writeUInt32LE(48_000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(pcm.length, 40);
    pcm.copy(wav, 44);
    return wav;
};

const numberField = (
    source: Record<string, unknown>,
    key: string
): number | undefined => {
    const value = source[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? value
        : undefined;
};

const parseUsage = (value: unknown): OpenRouterAudioUsage | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const usage = value as Record<string, unknown>;
    const result = {
        ...(numberField(usage, 'seconds') !== undefined && {
            seconds: numberField(usage, 'seconds'),
        }),
        ...(numberField(usage, 'input_tokens') !== undefined && {
            inputTokens: numberField(usage, 'input_tokens'),
        }),
        ...(numberField(usage, 'output_tokens') !== undefined && {
            outputTokens: numberField(usage, 'output_tokens'),
        }),
        ...(numberField(usage, 'total_tokens') !== undefined && {
            totalTokens: numberField(usage, 'total_tokens'),
        }),
        ...(numberField(usage, 'cost') !== undefined && {
            costUsd: numberField(usage, 'cost'),
        }),
    };
    return Object.keys(result).length === 0 ? undefined : result;
};

export const createOpenRouterVoiceService = ({
    apiKey,
    baseUrl,
    fetchFn = fetch,
}: {
    apiKey: string;
    baseUrl: string;
    fetchFn?: typeof fetch;
}): OpenRouterVoiceService => {
    const trimmedBaseUrl = baseUrl.trim();
    let endpointLength = trimmedBaseUrl.length;
    while (endpointLength > 0 && trimmedBaseUrl[endpointLength - 1] === '/') {
        endpointLength -= 1;
    }
    const endpoint = trimmedBaseUrl.slice(0, endpointLength);
    if (!apiKey.trim() || !endpoint)
        throw new TypeError(
            'OpenRouter voice requires an API key and base URL.'
        );

    const transcribe: OpenRouterVoiceService['transcribe'] = async (
        pcm24KhzMono,
        signal
    ) => {
        const response = await fetchFn(`${endpoint}/audio/transcriptions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'openai/whisper-1',
                input_audio: {
                    data: pcmToWav(pcm24KhzMono).toString('base64'),
                    format: 'wav',
                },
            }),
            signal,
        });
        if (!response.ok)
            throw new Error(
                `OpenRouter transcription failed (HTTP ${response.status}).`
            );

        let body: unknown;
        try {
            body = await response.json();
        } catch {
            throw new Error(
                'OpenRouter returned an invalid transcription response.'
            );
        }
        if (!body || typeof body !== 'object' || Array.isArray(body))
            throw new Error(
                'OpenRouter returned an invalid transcription response.'
            );
        const data = body as Record<string, unknown>;
        if (
            typeof data.text !== 'string' ||
            data.text.trim().length === 0 ||
            data.text.trim().length > MAX_TRANSCRIPT_LENGTH
        ) {
            throw new Error(
                'OpenRouter returned an empty or oversized transcript.'
            );
        }
        return { text: data.text.trim(), usage: parseUsage(data.usage) };
    };

    const synthesize: OpenRouterVoiceService['synthesize'] = async (
        text,
        options,
        signal
    ) => {
        const input = text.trim();
        if (!input || input.length > MAX_TRANSCRIPT_LENGTH)
            throw new TypeError(
                'Approved speech text is empty or out of bounds.'
            );
        const response = await fetchFn(`${endpoint}/audio/speech`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: options.model,
                input,
                voice: options.voice,
                response_format: 'pcm',
                ...(options.instructions && {
                    instructions: options.instructions,
                }),
            }),
            signal,
        });
        if (!response.ok)
            throw new Error(
                `OpenRouter speech synthesis failed (HTTP ${response.status}).`
            );
        if (
            response.headers.get('content-type')?.split(';', 1)[0].trim() !==
            'audio/pcm'
        ) {
            await response.body?.cancel();
            throw new Error('OpenRouter speech response was not audio/pcm.');
        }
        const body = response.body;
        if (!body)
            throw new Error(
                'OpenRouter speech response is empty or out of bounds.'
            );

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        for await (const value of body) {
            totalBytes += value.byteLength;
            if (totalBytes > MAX_SYNTHESIS_BYTES) {
                throw new Error(
                    'OpenRouter speech response is empty or out of bounds.'
                );
            }
            chunks.push(Buffer.from(value));
        }

        if (totalBytes === 0) {
            throw new Error(
                'OpenRouter speech response is empty or out of bounds.'
            );
        }
        const audio = Buffer.concat(chunks, totalBytes);
        const generationId = response.headers.get('x-generation-id')?.trim();
        return {
            audio,
            ...(generationId && generationId.length <= 128
                ? { generationId }
                : {}),
        };
    };

    return { transcribe, synthesize };
};
