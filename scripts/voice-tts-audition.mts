/**
 * @description: Runs the fixed synthetic Standard Voice audition only after explicit spend and data-policy gates.
 * @footnote-scope: utility
 * @footnote-module: VoiceTtsAudition
 * @footnote-risk: high - Provider requests spend money and return audio that must retain its verified format.
 * @footnote-ethics: high - The script permits only approved synthetic fixture text and requests ZDR routing.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenRouterVoiceService } from '../packages/backend/src/services/openRouterVoice.js';
import {
    AUDITION_CANDIDATES,
    createAuditionMatrix,
    isModelAvailabilityFailure,
    MAX_AUDITION_REQUESTS,
    MAX_RESPONSE_BYTES,
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
    contentType?: string;
    generationId?: string;
    modelUnavailable: boolean;
};
type SampleRecord = {
    sampleId: string;
    fixtureId: AuditionRequest['fixtureId'];
    sampleKind: AuditionRequest['sampleKind'];
    persona: AuditionRequest['persona'];
    model: string;
    voice: string;
    provider: 'openrouter';
    responseFormat: AuditionRequest['responseFormat'];
    formatStatus: 'verified' | 'unresolved';
    requestDurationMs: number;
    status: 'completed' | 'unavailable' | 'failed' | 'cancelled' | 'timeout';
    responseStatus?: number;
    responseHeaders: Record<string, string>;
    audioFile?: string;
    generationId?: string;
    failureKind?:
        | 'model-unavailable'
        | 'authorization'
        | 'spend-limit'
        | 'http-failure'
        | 'local-or-synthesis-failure'
        | 'cancelled'
        | 'timeout';
};
type SynthesisResult = {
    record: SampleRecord;
    skipModel: boolean;
    stop: boolean;
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
const MAX_ERROR_BODY_BYTES = 4 * 1024;
const isGenerationId = (value: string | undefined): value is string =>
    value !== undefined &&
    value.length <= 128 &&
    /^gen-[0-9A-Za-z-]+$/.test(value);

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

const readModelErrorMessage = async (
    response: Response
): Promise<string | null> => {
    if (!response.headers.get('content-type')?.includes('json')) return null;
    const reader = response.body?.getReader();
    if (!reader) return null;

    const chunks: Buffer[] = [];
    let bytesRead = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytesRead += value.byteLength;
            if (bytesRead > MAX_ERROR_BODY_BYTES) {
                await reader.cancel();
                return null;
            }
            chunks.push(Buffer.from(value));
        }
        const payload: unknown = JSON.parse(
            Buffer.concat(chunks).toString('utf8')
        );
        if (
            typeof payload === 'object' &&
            payload !== null &&
            'error' in payload &&
            typeof payload.error === 'object' &&
            payload.error !== null &&
            'message' in payload.error &&
            typeof payload.error.message === 'string'
        )
            return payload.error.message.slice(0, 512);
    } catch {
        await reader.cancel().catch(() => undefined);
    }
    return null;
};

const captureResponse = async (
    response: Response,
    captured: CapturedResponse
): Promise<void> => {
    captured.status = response.status;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.length <= 128)
        captured.contentType = contentType;
    const generationId = response.headers.get('x-generation-id');
    if (generationId && isGenerationId(generationId))
        captured.generationId = generationId;
    if (response.status === 404)
        captured.modelUnavailable = isModelAvailabilityFailure(
            response.status,
            await readModelErrorMessage(response.clone())
        );
};

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
                maxResponseBytes: MAX_RESPONSE_BYTES,
                spendLimitUsd: SPEND_LIMIT_USD,
                zdrRequested: true,
                requiresOperatorZdrOnlyConfiguration: true,
                candidates: AUDITION_CANDIDATES.map((candidate) => ({
                    model: candidate.model,
                    voices: candidate.voices,
                    responseFormat: candidate.responseFormat,
                    deliveryInstructions: candidate.supportsInstructions,
                })),
                executionCommand:
                    'pnpm voice:audition -- --execute --confirm-openrouter-key-limit-usd=1 --confirm-openrouter-zdr-only',
                metadataCommand:
                    'pnpm voice:audition:metadata -- "<audition-directory>"',
            },
            null,
            2
        )
    );
};

const failureDetails = (
    response: CapturedResponse,
    interrupted: boolean,
    timedOut: boolean
): Pick<SampleRecord, 'status' | 'failureKind'> => {
    if (response.modelUnavailable)
        return { status: 'unavailable', failureKind: 'model-unavailable' };
    if (interrupted) return { status: 'cancelled', failureKind: 'cancelled' };
    if (timedOut) return { status: 'timeout', failureKind: 'timeout' };
    if (response.status === 401 || response.status === 403)
        return { status: 'failed', failureKind: 'authorization' };
    if (response.status === 402)
        return { status: 'failed', failureKind: 'spend-limit' };
    if (response.status !== undefined && response.status >= 400)
        return { status: 'failed', failureKind: 'http-failure' };
    return { status: 'failed', failureKind: 'local-or-synthesis-failure' };
};

const synthesizeSample = async (
    request: AuditionRequest,
    response: CapturedResponse,
    service: ReturnType<typeof createOpenRouterVoiceService>,
    outputDirectory: string,
    controller: AbortController,
    interrupted: () => boolean
): Promise<SynthesisResult> => {
    const sampleId = randomUUID().replaceAll('-', '').slice(0, 10);
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error('Audition request timed out.'));
    }, REQUEST_TIMEOUT_MS);
    const startedAt = performance.now();
    let requestDurationMs = 0;
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
        requestDurationMs = Math.round(performance.now() - startedAt);
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
        const extension = request.responseFormat === 'mp3' ? 'mp3' : 'wav';
        const audioFile = `sample-${sampleId}.${extension}`;
        await writeFile(join(outputDirectory, audioFile), audio, {
            flag: 'wx',
        });
        const generationId = isGenerationId(result.generationId)
            ? result.generationId
            : response.generationId;
        return {
            record: {
                sampleId,
                fixtureId: request.fixtureId,
                sampleKind: request.sampleKind,
                persona: request.persona,
                model: request.model,
                voice: request.voice,
                provider: 'openrouter',
                responseFormat: request.responseFormat,
                formatStatus: 'verified',
                requestDurationMs,
                status: 'completed',
                ...(response.status !== undefined && {
                    responseStatus: response.status,
                }),
                responseHeaders: response.contentType
                    ? { 'content-type': response.contentType }
                    : {},
                audioFile,
                ...(generationId && { generationId }),
            },
            skipModel: false,
            stop: false,
        };
    } catch {
        const details = failureDetails(response, interrupted(), timedOut);
        const generationId = response.generationId;
        return {
            record: {
                sampleId,
                fixtureId: request.fixtureId,
                sampleKind: request.sampleKind,
                persona: request.persona,
                model: request.model,
                voice: request.voice,
                provider: 'openrouter',
                responseFormat: request.responseFormat,
                formatStatus: 'unresolved',
                requestDurationMs: Math.round(performance.now() - startedAt),
                ...details,
                ...(response.status !== undefined && {
                    responseStatus: response.status,
                }),
                responseHeaders: response.contentType
                    ? { 'content-type': response.contentType }
                    : {},
                ...(generationId && { generationId }),
            },
            skipModel: response.modelUnavailable,
            stop: !response.modelUnavailable,
        };
    } finally {
        clearTimeout(timeout);
    }
};

const writeAuditionFiles = async (
    outputDirectory: string,
    matrix: readonly AuditionRequest[],
    records: readonly SampleRecord[],
    skippedModels: ReadonlySet<string>,
    overallStatus: string
): Promise<void> => {
    const successful = records.filter(
        (record) => record.status === 'completed'
    );
    const manifest = {
        status: overallStatus,
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
            const unavailable = skippedModels.has(candidate.model);
            let candidateStatus: string;
            if (unavailable) candidateStatus = 'unavailable';
            else if (
                candidateSamples.length === 10 &&
                candidateSamples.every(
                    (sample) => sample.status === 'completed'
                )
            )
                candidateStatus = 'ready-for-listening';
            else if (candidateSamples.length > 0) candidateStatus = 'partial';
            else candidateStatus = 'not-run';
            return {
                model: candidate.model,
                status: candidateStatus,
                offlineAudioFormatStatus:
                    candidateSamples.length === 10 &&
                    candidateSamples.every(
                        (sample) => sample.formatStatus === 'verified'
                    )
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
        zdrOnlyConfigurationAttested: true,
        generationMetadata: 'not collected; use the separate metadata command',
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
};

const runAudition = async (
    matrix: readonly AuditionRequest[]
): Promise<void> => {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey)
        throw new TypeError(
            'Set OPENROUTER_API_KEY to the dedicated capped key.'
        );

    const outputDirectory = await mkdtemp(
        join(tmpdir(), 'footnote-tts-audition-')
    );
    let activeResponse: CapturedResponse | null = null;
    let activeController: AbortController | null = null;
    let interrupted = false;
    const onInterrupt = (): void => {
        interrupted = true;
        activeController?.abort(new Error('Audition cancelled by operator.'));
    };
    const service = createOpenRouterVoiceService({
        apiKey,
        baseUrl: 'https://openrouter.ai/api/v1',
        fetchFn: async (input, init) => {
            const response = await fetch(input, init);
            if (activeResponse) await captureResponse(response, activeResponse);
            return response;
        },
    });

    const records: SampleRecord[] = [];
    const skippedModels = new Set<string>();
    let stop = false;
    process.on('SIGINT', onInterrupt);
    try {
        for (const request of matrix) {
            if (interrupted || stop) break;
            if (skippedModels.has(request.model)) continue;

            const response: CapturedResponse = { modelUnavailable: false };
            activeResponse = response;
            const controller = new AbortController();
            activeController = controller;
            const result =
                await /* NOSONAR - Keep provider requests serial to enforce the one-in-flight and spend limits. */ synthesizeSample(
                    request,
                    response,
                    service,
                    outputDirectory,
                    controller,
                    () => interrupted
                );
            activeController = null;
            activeResponse = null;
            records.push(result.record);
            if (result.skipModel) skippedModels.add(request.model);
            if (result.stop) stop = true;
        }
    } finally {
        process.off('SIGINT', onInterrupt);
        activeController?.abort();
    }

    let overallStatus = 'completed';
    if (interrupted) overallStatus = 'interrupted';
    else if (stop) overallStatus = 'partial';
    else if (skippedModels.size > 0)
        overallStatus = 'completed-with-unavailable-candidates';
    await writeAuditionFiles(
        outputDirectory,
        matrix,
        records,
        skippedModels,
        overallStatus
    );
    console.log(`Audition directory: ${outputDirectory}`);
    console.log(
        `Status: ${overallStatus}; synthesis requests attempted: ${records.length}/${MAX_AUDITION_REQUESTS}`
    );
    console.log(
        'Listening is partially blinded: the WAV extension identifies Gemini; the other candidates use MP3.'
    );
    console.log(
        'Use rating-sheet.csv for randomized scoring, then run the separate generation-metadata command before revealing sample mappings.'
    );
    if (stop || interrupted) process.exitCode = 1;
};

const main = async (args: readonly string[]): Promise<void> => {
    const matrix = createAuditionMatrix(await readFixtureCases());
    const options = parseAuditionArguments(args);
    if (!options.execute) {
        printPlan(matrix);
        return;
    }
    if (!options.confirmSpendLimit || !options.confirmZdrOnly)
        throw new TypeError(
            'Execution requires an active $1 key cap and ZDR-only provider settings for all audition model groups.'
        );
    await runAudition(matrix);
};

try {
    await main(process.argv.slice(2));
} catch (error) {
    const message =
        error instanceof Error ? error.message : 'Audition setup failed.';
    console.error(message);
    process.exitCode = 1;
}
