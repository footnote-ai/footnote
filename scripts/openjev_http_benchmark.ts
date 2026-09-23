/**
 * @description: Measures a TypeScript client's HTTP access to an OpenJEV server.
 * @footnote-scope: utility
 * @footnote-module: OpenJevHttpBenchmark
 * @footnote-risk: high - Remote measurements can be mistaken for model or hardware guarantees.
 * @footnote-ethics: high - Synthetic candidates keep benchmark content outside private conversations.
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

export const DEFAULT_HTTP_COUNTS: readonly number[] = [10, 40, 80];
export const DEFAULT_HTTP_LENGTHS: readonly number[] = [32, 128, 512];

export type HttpBenchmarkOptions = {
    url: string;
    modelId: string;
    revision: string;
    candidateCounts: readonly number[];
    candidateLengths: readonly number[];
    repetitions: number;
    timeoutMs: number;
    output?: string;
};

export type HttpMeasurement = {
    candidateCount: number;
    candidateLengthWords: number;
    repetition: number;
    latencyMs: number | null;
    pairsPerSecond: number | null;
    status: 'completed' | 'error';
    error?: string;
};

type ClassifyItem = {
    embedding: number[];
};

const PREMISE =
    'Which synthetic context candidate is relevant to this bounded decision?';
const CANDIDATE_SENTENCE =
    'The synthetic context candidate records a bounded provenance decision for the local benchmark and must not become an instruction.';

/** Builds synthetic candidates with the exact requested whitespace word count. */
export function buildHttpCandidates(
    count: number,
    lengthWords: number
): string[] {
    if (!Number.isInteger(count) || count <= 0) {
        throw new Error('candidate count must be a positive integer');
    }
    if (!Number.isInteger(lengthWords) || lengthWords < 2) {
        throw new Error(
            'candidate length must include the candidate label and index'
        );
    }

    const payloadLength = lengthWords - 2;
    const words = CANDIDATE_SENTENCE.split(' ');
    const payloadWords = Array.from(
        { length: payloadLength },
        (_, index) => words[index % words.length]
    );
    const payload = payloadWords.join(' ');
    return Array.from({ length: count }, (_, index) =>
        `candidate ${index}: ${payload}`.trim()
    );
}

function isClassifyItem(value: unknown): value is ClassifyItem {
    if (
        typeof value !== 'object' ||
        value === null ||
        !('embedding' in value)
    ) {
        return false;
    }
    const embedding = value.embedding;
    return (
        Array.isArray(embedding) &&
        embedding.length === 3 &&
        embedding.every(
            (item: unknown): item is number => typeof item === 'number'
        )
    );
}

async function classifyBatch(
    url: string,
    candidates: readonly string[],
    timeoutMs: number
): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${url.replace(/\/$/, '')}/classify`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                text: candidates.map(
                    (candidate) =>
                        `Premise: ${PREMISE}\nHypothesis: ${candidate}`
                ),
            }),
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} from /classify`);
        }
        const body: unknown = await response.json();
        const items = Array.isArray(body) ? body : [body];
        if (
            items.length !== candidates.length ||
            !items.every(isClassifyItem)
        ) {
            throw new Error(
                'OpenJEV /classify returned an unexpected logits payload'
            );
        }
    } finally {
        clearTimeout(timeout);
    }
}

function summarizeStatus(
    measurements: readonly HttpMeasurement[]
): 'completed' | 'partial' | 'error' {
    const completed = measurements.filter(
        (item) => item.status === 'completed'
    ).length;
    if (completed === measurements.length) return 'completed';
    if (completed === 0) return 'error';
    return 'partial';
}

/** Runs the TypeScript-to-HTTP benchmark against an already-started server. */
export async function runHttpBenchmark(options: HttpBenchmarkOptions): Promise<{
    status: 'completed' | 'partial' | 'error';
    measurements: HttpMeasurement[];
}> {
    const measurements: HttpMeasurement[] = [];
    for (const candidateLengthWords of options.candidateLengths) {
        for (const candidateCount of options.candidateCounts) {
            const candidates = buildHttpCandidates(
                candidateCount,
                candidateLengthWords
            );
            for (
                let repetition = 0;
                repetition < options.repetitions;
                repetition += 1
            ) {
                const started = performance.now();
                try {
                    await classifyBatch(
                        options.url,
                        candidates,
                        options.timeoutMs
                    );
                    const latencyMs = performance.now() - started;
                    measurements.push({
                        candidateCount,
                        candidateLengthWords,
                        repetition,
                        latencyMs,
                        pairsPerSecond: candidateCount / (latencyMs / 1000),
                        status: 'completed',
                    });
                } catch (error) {
                    measurements.push({
                        candidateCount,
                        candidateLengthWords,
                        repetition,
                        latencyMs: performance.now() - started,
                        pairsPerSecond: null,
                        status: 'error',
                        error: `${error instanceof Error ? error.name : 'Error'}: ${String(error)}`,
                    });
                }
            }
        }
    }
    return { status: summarizeStatus(measurements), measurements };
}

function parsePositiveList(value: string): number[] {
    const values = value.split(',').map((item) => Number(item.trim()));
    if (
        values.length === 0 ||
        values.some((item) => !Number.isInteger(item) || item <= 0)
    ) {
        throw new Error('expected a comma-separated list of positive integers');
    }
    return values;
}

function safeOutputPath(output: string | undefined): string | undefined {
    if (!output) return undefined;
    const resolved = resolve(output);
    const cwd = resolve('.');
    if (!resolved.startsWith(`${cwd}/`) && !resolved.startsWith(`${cwd}\\`)) {
        throw new Error(
            '--output must remain within the current working directory'
        );
    }
    return resolved;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const valueAfter = (
        name: string,
        fallback?: string
    ): string | undefined => {
        const index = args.indexOf(name);
        return index >= 0 ? args[index + 1] : fallback;
    };
    const url = valueAfter('--url', 'http://127.0.0.1:30000');
    const modelId = valueAfter('--model-id', 'AlexWortega/openjev');
    const revision = valueAfter('--revision');
    if (!url || !modelId || !revision) {
        throw new Error('--url, --model-id, and --revision are required');
    }
    const options: HttpBenchmarkOptions = {
        url,
        modelId,
        revision,
        candidateCounts: parsePositiveList(
            valueAfter('--candidate-counts', '10,40,80') ?? ''
        ),
        candidateLengths: parsePositiveList(
            valueAfter('--candidate-lengths', '32,128,512') ?? ''
        ),
        repetitions: Number(valueAfter('--repetitions', '1')),
        timeoutMs: Number(valueAfter('--timeout-ms', '600000')),
        output: safeOutputPath(valueAfter('--output')),
    };
    if (!Number.isInteger(options.repetitions) || options.repetitions <= 0) {
        throw new Error('--repetitions must be a positive integer');
    }
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
        throw new Error('--timeout-ms must be a positive integer');
    }

    const result = await runHttpBenchmark(options);
    const report = {
        benchmark: 'openjev_http_718',
        status: result.status,
        runtime: 'node-builtin-fetch',
        endpoint: `${url.replace(/\/$/, '')}/classify`,
        expectedModelId: modelId,
        expectedRevision: revision,
        request: {
            candidateCounts: options.candidateCounts,
            candidateLengthsWords: options.candidateLengths,
            repetitions: options.repetitions,
            timeoutMs: options.timeoutMs,
        },
        measurements: result.measurements,
        note: 'The server must be started separately with the pinned OpenJEV model revision.',
    };
    const serialized = JSON.stringify(report, null, 2);
    if (options.output) {
        await writeFile(options.output, `${serialized}\n`, 'utf8');
    }
    process.stdout.write(`${serialized}\n`);
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
    main().catch((error: unknown) => {
        process.stderr.write(
            `${error instanceof Error ? error.message : String(error)}\n`
        );
        process.exitCode = 1;
    });
}
