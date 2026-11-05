/**
 * @description: Runs the fixed synthetic Standard Voice audition only after an explicit spend gate.
 * @footnote-scope: utility
 * @footnote-module: VoiceTtsAudition
 * @footnote-risk: high - Provider requests spend money and return audio that must retain its verified format.
 * @footnote-ethics: high - The script permits only approved synthetic fixture text and applies ZDR routing.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenRouterVoiceService } from '../packages/backend/src/services/openRouterVoice.js';
import {
    AUDITION_CANDIDATES,
    createAuditionMatrix,
    MAX_AUDITION_REQUESTS,
    parseAuditionArguments,
    pcm16MonoToWav,
    randomizedOrder,
    REQUEST_TIMEOUT_MS,
    SPEND_LIMIT_USD,
    type AuditionCase,
    type AuditionRequest,
} from './voice-tts-audition-core.js';

type FixtureFile = { cases: AuditionCase[] };
type CapturedResponse = {
    status?: number;
    headers: Record<string, string>;
};
type SampleRecord = {
    sampleId: string;
    fixtureId: AuditionRequest['fixtureId'];
    sampleKind: AuditionRequest['sampleKind'];
    persona: AuditionRequest['persona'];
    model: string;
    voice: string;
    provider: 'openrouter';
    upstreamProvider: string | null;
    responseFormat: AuditionRequest['responseFormat'];
    formatStatus: 'verified' | 'unresolved';
    requestDurationMs: number;
    status: 'completed' | 'failed' | 'cancelled' | 'timeout';
    audioFile?: string;
    generationId?: string;
    responseHeaders: Record<string, string>;
    billingMetadata: Record<string, string>;
    error?: string;
};

const fixtureUrl = new URL(
    '../packages/backend/test/fixtures/voiceCondensationEvaluation.json',
    import.meta.url
);
const ratingColumns = [
    'naturalness_1_to_5',
    'intelligibility_1_to_5',
    'persona_delivery_1_to_5',
    'spoken_content_fidelity_1_to_5',
    'pronunciation_1_to_5',
    'expressiveness_1_to_5',
    'repeat_consistency_1_to_5',
    'notes',
];

const readFixtureCases = async (): Promise<AuditionCase[]> => {
    const fixture = JSON.parse(
        await readFile(fixtureUrl, 'utf8')
    ) as FixtureFile;
    return fixture.cases;
};

const csvCell = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const buildRatingSheet = (
    samples: readonly SampleRecord[],
    matrix: readonly AuditionRequest[]
): string => {
    const textByFixture = new Map(
        matrix.map((request) => [request.fixtureId, request.text])
    );
    const rows = [
        [
            'order',
            'sample_id',
            'persona',
            'fixture_id',
            'audio_file',
            'reference_text',
            ...ratingColumns,
        ].join(','),
        ...randomizedOrder(samples).map((sample, index) =>
            [
                String(index + 1),
                sample.sampleId,
                sample.persona,
                sample.fixtureId,
                sample.audioFile ?? '',
                textByFixture.get(sample.fixtureId) ?? '',
                ...ratingColumns.map(() => ''),
            ]
                .map(csvCell)
                .join(',')
        ),
    ];
    return `${rows.join('\n')}\n`;
};

const extractBillingMetadata = (
    headers: Record<string, string>
): Record<string, string> =>
    Object.fromEntries(
        Object.entries(headers).filter(([name]) =>
            /cost|billing|usage|token|price/i.test(name)
        )
    );

const readResponseHeaders = (response: Response): Record<string, string> => {
    const entries = [...response.headers.entries()].filter(
        ([name]) => name !== 'set-cookie'
    );
    if (
        entries.length > 64 ||
        entries.some(([, value]) => value.length > 1_024)
    )
        throw new TypeError(
            'OpenRouter response headers exceeded the audit limit.'
        );
    const headers = Object.fromEntries(entries);
    if (JSON.stringify(headers).length > 8_192)
        throw new TypeError(
            'OpenRouter response headers exceeded the audit limit.'
        );
    return headers;
};

const getUpstreamProvider = (headers: Record<string, string>): string | null =>
    headers['x-provider'] ?? headers['x-openrouter-provider'] ?? null;

const printPlan = (matrix: readonly AuditionRequest[]): void => {
    console.log(
        JSON.stringify(
            {
                paidRequestsMade: 0,
                requestCountMaximum: matrix.length,
                requestsPerModel: Object.fromEntries(
                    AUDITION_CANDIDATES.map((candidate) => [
                        candidate.model,
                        10,
                    ])
                ),
                serial: true,
                automaticRetries: false,
                timeoutMsPerRequest: REQUEST_TIMEOUT_MS,
                maxResponseBytes: 10 * 1024 * 1024,
                spendLimitUsd: SPEND_LIMIT_USD,
                candidates: AUDITION_CANDIDATES.map((candidate) => ({
                    model: candidate.model,
                    voices: candidate.voices,
                    responseFormat: candidate.responseFormat,
                    deliveryInstructions: candidate.supportsInstructions,
                })),
                executionCommand:
                    'pnpm voice:audition -- --execute --confirm-openrouter-key-limit-usd=1',
            },
            null,
            2
        )
    );
};

const runAudition = async (
    matrix: readonly AuditionRequest[]
): Promise<void> => {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey)
        throw new TypeError(
            'Set OPENROUTER_API_KEY to the dedicated capped key.'
        );

    const baseUrl = 'https://openrouter.ai/api/v1';
    const outputDirectory = await mkdtemp(
        join(tmpdir(), 'footnote-tts-audition-')
    );
    let captured: CapturedResponse | null = null;
    let activeController: AbortController | null = null;
    let interrupted = false;
    const onInterrupt = (): void => {
        interrupted = true;
        activeController?.abort(new Error('Audition cancelled by operator.'));
    };
    process.on('SIGINT', onInterrupt);

    const service = createOpenRouterVoiceService({
        apiKey,
        baseUrl,
        fetchFn: async (input, init) => {
            const response = await fetch(input, init);
            if (captured) {
                captured.status = response.status;
                try {
                    captured.headers = readResponseHeaders(response);
                } catch (error) {
                    await response.body?.cancel();
                    throw error;
                }
            }
            return response;
        },
    });

    const records: SampleRecord[] = [];
    let stopped = false;
    try {
        for (const request of matrix) {
            if (interrupted) break;

            const sampleId = randomUUID().replaceAll('-', '').slice(0, 10);
            const response: CapturedResponse = { headers: {} };
            captured = response;
            const controller = new AbortController();
            activeController = controller;
            let timedOut = false;
            const timeout = setTimeout(() => {
                timedOut = true;
                controller.abort(new Error('Audition request timed out.'));
            }, REQUEST_TIMEOUT_MS);
            const startedAt = performance.now();
            let generationId: string | undefined;
            let record: SampleRecord;

            try {
                const result = await service.synthesize(
                    request.text,
                    {
                        model: request.model,
                        voice: request.voice,
                        responseFormat: request.responseFormat,
                        zdr: true,
                        ...(request.instructions && {
                            instructions: request.instructions,
                        }),
                    },
                    controller.signal
                );
                generationId = result.generationId;
                const requestDurationMs = Math.round(
                    performance.now() - startedAt
                );
                const extension =
                    request.responseFormat === 'mp3' ? 'mp3' : 'wav';
                const audio =
                    request.responseFormat === 'pcm'
                        ? pcm16MonoToWav(
                              result.audio,
                              request.pcmContract ?? {
                                  sampleRateHz: 0,
                                  channels: 0,
                                  bitsPerSample: 16,
                                  encoding: 'signed-integer-little-endian',
                              }
                          )
                        : result.audio;
                const audioFile = `sample-${sampleId}.${extension}`;
                await writeFile(join(outputDirectory, audioFile), audio, {
                    flag: 'wx',
                });
                record = {
                    sampleId,
                    fixtureId: request.fixtureId,
                    sampleKind: request.sampleKind,
                    persona: request.persona,
                    model: request.model,
                    voice: request.voice,
                    provider: 'openrouter',
                    upstreamProvider: getUpstreamProvider(response.headers),
                    responseFormat: request.responseFormat,
                    formatStatus: 'verified',
                    requestDurationMs,
                    status: 'completed',
                    audioFile,
                    ...(result.generationId && {
                        generationId: result.generationId,
                    }),
                    responseHeaders: response.headers,
                    billingMetadata: extractBillingMetadata(response.headers),
                };
            } catch (error) {
                record = {
                    sampleId,
                    fixtureId: request.fixtureId,
                    sampleKind: request.sampleKind,
                    persona: request.persona,
                    model: request.model,
                    voice: request.voice,
                    provider: 'openrouter',
                    upstreamProvider: getUpstreamProvider(response.headers),
                    responseFormat: request.responseFormat,
                    formatStatus: 'unresolved',
                    requestDurationMs: Math.round(
                        performance.now() - startedAt
                    ),
                    status: interrupted
                        ? 'cancelled'
                        : timedOut
                          ? 'timeout'
                          : 'failed',
                    responseHeaders: response.headers,
                    billingMetadata: extractBillingMetadata(response.headers),
                    ...(generationId && { generationId }),
                    error:
                        error instanceof Error
                            ? error.message.slice(0, 160)
                            : 'Synthesis failed.',
                };
                stopped = true;
            } finally {
                clearTimeout(timeout);
                activeController = null;
                captured = null;
            }

            records.push(record);
            if (record.status !== 'completed' || interrupted || stopped) break;
        }
    } finally {
        process.off('SIGINT', onInterrupt);
        activeController?.abort();
    }

    const successful = records.filter(
        (record) => record.status === 'completed'
    );
    const status = interrupted
        ? 'interrupted'
        : stopped
          ? 'partial'
          : successful.length === MAX_AUDITION_REQUESTS
            ? 'completed'
            : 'incomplete';
    const manifest = {
        status,
        createdAt: new Date().toISOString(),
        spendLimitUsd: SPEND_LIMIT_USD,
        requestCountMaximum: MAX_AUDITION_REQUESTS,
        requestCountAttempted: records.length,
        totalSynthesisDurationMs: records.reduce(
            (total, sample) => total + sample.requestDurationMs,
            0
        ),
        candidates: AUDITION_CANDIDATES.map((candidate) => {
            const candidateSamples = records.filter(
                (sample) => sample.model === candidate.model
            );
            const offlineFormatVerified =
                candidateSamples.length === 10 &&
                candidateSamples.every(
                    (sample) => sample.formatStatus === 'verified'
                );
            return {
                model: candidate.model,
                status:
                    offlineFormatVerified &&
                    candidateSamples.every(
                        (sample) => sample.status === 'completed'
                    )
                        ? 'ready-for-listening'
                        : 'unresolved',
                offlineAudioFormatStatus: offlineFormatVerified
                    ? 'verified'
                    : 'unresolved',
                discordPcmContractStatus: candidate.pcmContract
                    ? 'documented; playback still untested'
                    : 'unresolved',
                samplesCompleted: candidateSamples.filter(
                    (sample) => sample.status === 'completed'
                ).length,
            };
        }),
        serial: true,
        automaticRetries: false,
        zdrRequested: true,
        samples: records,
    };
    await writeFile(
        join(outputDirectory, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { flag: 'wx' }
    );
    await writeFile(
        join(outputDirectory, 'rating-sheet.csv'),
        buildRatingSheet(successful, matrix),
        { flag: 'wx' }
    );
    console.log(`Audition directory: ${outputDirectory}`);
    console.log(
        `Status: ${status}; requests attempted: ${records.length}/${MAX_AUDITION_REQUESTS}`
    );
    console.log(
        'Use rating-sheet.csv for blind listening scores; manifest.json maps samples after listening.'
    );
    if (status !== 'completed') process.exitCode = 1;
};

const main = async (args: readonly string[]): Promise<void> => {
    const fixtureCases = await readFixtureCases();
    const matrix = createAuditionMatrix(fixtureCases);
    const options = parseAuditionArguments(args);
    if (!options.execute) {
        printPlan(matrix);
        return;
    }
    if (!options.confirmSpendLimit)
        throw new TypeError(
            'Execution requires --confirm-openrouter-key-limit-usd=1 after the provider-side key cap is active.'
        );
    await runAudition(matrix);
};

void main(process.argv.slice(2)).catch((error: unknown) => {
    const message =
        error instanceof Error ? error.message : 'Audition setup failed.';
    console.error(message);
    process.exitCode = 1;
});
