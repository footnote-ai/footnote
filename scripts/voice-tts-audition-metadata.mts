/**
 * @description: Fetches bounded OpenRouter generation metadata for a completed audition without synthesizing audio.
 * @footnote-scope: utility
 * @footnote-module: VoiceTtsAuditionMetadata
 * @footnote-risk: medium - Metadata lookups must not persist prompt or response content.
 * @footnote-ethics: high - This tool reads only generation IDs from an existing synthetic audition manifest.
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
    GENERATION_METADATA_TIMEOUT_MS,
    generationLookupTargets,
    generationMetadataFromResponse,
    MAX_GENERATION_METADATA_BYTES,
    MAX_GENERATION_METADATA_LOOKUPS,
    readBoundedJsonResponse,
    stripScriptArgumentSeparator,
    type GenerationLookupTarget,
} from './voice-tts-audition-core.js';

type MetadataRecord = {
    sampleId: string;
    generationId: string | null;
    status: 'available' | 'unavailable' | 'not-attempted';
    reason?: string;
    model: string | null;
    providerName: string | null;
    totalCostUsd: number | null;
    upstreamInferenceCostUsd: number | null;
    generationTime: number | null;
    latency: number | null;
};
type LookupResult = { record: MetadataRecord; stop: boolean };

const MAX_MANIFEST_BYTES = 1024 * 1024;
const OPENROUTER_GENERATION_URL = 'https://openrouter.ai/api/v1/generation';

const unavailableRecord = (
    target: GenerationLookupTarget,
    reason: string,
    status: MetadataRecord['status'] = 'unavailable'
): MetadataRecord => ({
    sampleId: target.sampleId,
    generationId: target.generationId,
    status,
    reason,
    model: null,
    providerName: null,
    totalCostUsd: null,
    upstreamInferenceCostUsd: null,
    generationTime: null,
    latency: null,
});

const lookupOne = async (
    target: GenerationLookupTarget,
    apiKey: string,
    controller: AbortController
): Promise<LookupResult> => {
    if (!target.generationId)
        return {
            record: unavailableRecord(target, 'generation-id-missing'),
            stop: false,
        };

    const timeout = setTimeout(
        () => controller.abort(new Error('Metadata lookup timed out.')),
        GENERATION_METADATA_TIMEOUT_MS
    );
    try {
        const url = new URL(OPENROUTER_GENERATION_URL);
        url.searchParams.set('id', target.generationId);
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json',
            },
            signal: controller.signal,
        });
        if (response.status === 404) {
            await response.body?.cancel();
            return {
                record: unavailableRecord(
                    target,
                    'generation-metadata-not-found'
                ),
                stop: false,
            };
        }
        if (!response.ok) {
            await response.body?.cancel();
            let reason: string;
            if (response.status === 401 || response.status === 403)
                reason = 'authorization-failed';
            else if (response.status === 402)
                reason = 'account-limit-or-balance';
            else reason = `http-${response.status}`;
            return {
                record: unavailableRecord(target, reason),
                stop: true,
            };
        }

        const metadata = generationMetadataFromResponse(
            await readBoundedJsonResponse(
                response,
                MAX_GENERATION_METADATA_BYTES
            ),
            target.generationId
        );
        return {
            record: {
                sampleId: target.sampleId,
                generationId: target.generationId,
                status: 'available',
                ...metadata,
            },
            stop: false,
        };
    } catch {
        return {
            record: unavailableRecord(target, 'metadata-lookup-failed'),
            stop: true,
        };
    } finally {
        clearTimeout(timeout);
    }
};

const readTargets = async (
    directory: string
): Promise<GenerationLookupTarget[]> => {
    const manifestPath = join(directory, 'manifest.json');
    const details = await stat(manifestPath);
    if (details.size > MAX_MANIFEST_BYTES)
        throw new TypeError('Audition manifest exceeds the input limit.');
    const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    return generationLookupTargets(manifest);
};

const run = async (args: readonly string[]): Promise<void> => {
    const scriptArgs = stripScriptArgumentSeparator(args);
    if (scriptArgs.length !== 1)
        throw new TypeError(
            'Pass exactly one existing audition directory containing manifest.json.'
        );
    const directory = resolve(scriptArgs[0]!);
    const targets = await readTargets(directory);
    if (targets.length > MAX_GENERATION_METADATA_LOOKUPS)
        throw new TypeError(
            'Audition manifest exceeds the metadata lookup limit.'
        );
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey)
        throw new TypeError('Set OPENROUTER_API_KEY for the metadata lookup.');

    const records: MetadataRecord[] = [];
    let controller: AbortController | null = null;
    let interrupted = false;
    const onInterrupt = (): void => {
        interrupted = true;
        controller?.abort(new Error('Metadata lookup cancelled by operator.'));
    };
    process.on('SIGINT', onInterrupt);
    try {
        for (const target of targets) {
            if (interrupted) break;
            controller = new AbortController();
            const result = await lookupOne(target, apiKey, controller);
            controller = null;
            records.push(result.record);
            if (result.stop) break;
        }
    } finally {
        process.off('SIGINT', onInterrupt);
        controller?.abort();
    }

    while (records.length < targets.length) {
        const target = targets[records.length]!;
        records.push(
            unavailableRecord(
                target,
                interrupted ? 'cancelled-before-lookup' : 'not-attempted',
                'not-attempted'
            )
        );
    }
    const output = {
        createdAt: new Date().toISOString(),
        lookupCountMaximum: MAX_GENERATION_METADATA_LOOKUPS,
        lookupCountAttempted: records.filter(
            (record) =>
                record.status !== 'not-attempted' &&
                record.reason !== 'generation-id-missing'
        ).length,
        serial: true,
        automaticRetries: false,
        source: 'OpenRouter GET /api/v1/generation by generation ID',
        records,
    };
    await writeFile(
        join(directory, 'generation-metadata.json'),
        `${JSON.stringify(output, null, 2)}\n`,
        { flag: 'wx' }
    );
    console.log(
        `Generation metadata written beside manifest.json: ${output.lookupCountAttempted} lookups attempted.`
    );
    if (interrupted) process.exitCode = 1;
};

try {
    await run(process.argv.slice(2));
} catch (error) {
    console.error(
        error instanceof Error ? error.message : 'Metadata lookup failed.'
    );
    process.exitCode = 1;
}
