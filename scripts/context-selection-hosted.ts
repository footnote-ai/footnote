/**
 * @description: Runs a benchmark-only hosted zero-shot context selector and can reuse the existing chat replay seam.
 * @footnote-scope: test
 * @footnote-module: ContextSelectionHosted
 * @footnote-risk: medium - Hosted calls can spend provider budget and selection errors can distort evaluation results.
 * @footnote-ethics: high - Only the synthetic benchmark corpus may be sent to the provider.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import {
    buildBenchmarkCorpus,
    buildCaseMetric,
    type ContextBenchmarkCase,
    type SelectionResult,
} from './context-selection-benchmark.js';
import {
    replayContextSelection,
    serializeReplayRecords,
    type ContextReplayRecord,
} from './context-selection-chat-replay.js';

const DEFAULT_MODEL = 'openai/gpt-6-luna';
const DEFAULT_BASE_URL = 'https://openrouter.ai';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_BUDGET = 15;
const CONFIDENCE_FLOOR = 0.5;

type HostedLabel = 'necessary' | 'useful' | 'irrelevant';

export type HostedCandidateScore = {
    messageId: string;
    label: HostedLabel;
    confidence: number;
    selected: boolean;
    rank: number | null;
};

export type HostedSelectionRecord = {
    schemaVersion: 1;
    caseId: string;
    category: ContextBenchmarkCase['category'];
    selection: SelectionResult;
    backend: {
        provider: 'openrouter';
        requestedModel: string;
        returnedModel: string | null;
        taskFormulation: 'pairwise_batch_zero_shot';
        scoreKind: 'model_reported_confidence';
        budget: number;
        confidenceFloor: number;
    };
    candidates: HostedCandidateScore[];
    usage: {
        promptTokens: number | null;
        completionTokens: number | null;
        totalTokens: number | null;
    } | null;
    latencyMs: number | null;
    costUsd: number | null;
    responseContent: string | null;
    error: {
        category: 'transport' | 'http' | 'response' | 'parse';
        message: string;
    } | null;
};

export type HostedSelectionOptions = {
    apiKey: string;
    model: string;
    baseUrl?: string;
    budget?: number;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
};

type JsonRecord = Record<string, unknown>;

type HostedFailureCategory = 'transport' | 'http' | 'response' | 'parse';

class HostedError extends Error {
    public readonly category: Exclude<HostedFailureCategory, 'transport'>;

    public constructor(
        category: Exclude<HostedFailureCategory, 'transport'>,
        message: string
    ) {
        super(message);
        this.category = category;
    }
}

const isRecord = (value: unknown): value is JsonRecord =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | null =>
    typeof value === 'string' ? value : null;

const numberValue = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

const responseMessage = (value: unknown): string => {
    if (!isRecord(value)) {
        return 'Hosted selector returned an unknown error.';
    }
    const error = isRecord(value.error) ? value.error : null;
    return (
        stringValue(error?.message) ??
        stringValue(value.message) ??
        'Hosted selector request failed.'
    );
};

const parseResponseContent = (content: string): unknown => {
    const trimmed = content.trim();
    let withoutFence = trimmed;
    if (trimmed.startsWith('```')) {
        const firstLineEnd = trimmed.indexOf('\n');
        withoutFence =
            firstLineEnd < 0 ? '' : trimmed.slice(firstLineEnd + 1).trim();
        if (withoutFence.endsWith('```')) {
            withoutFence = withoutFence.slice(0, -3).trim();
        }
    }
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start < 0 || end <= start) {
        throw new HostedError(
            'parse',
            'Hosted selector response did not contain a JSON object.'
        );
    }
    return JSON.parse(withoutFence.slice(start, end + 1)) as unknown;
};

const emptySelection = (
    entry: ContextBenchmarkCase,
    latencyMs: number | null,
    reason: string
): SelectionResult => ({
    method: 'hosted_zero_shot',
    status: 'unavailable',
    messageIds: [],
    candidateCount: entry.messages.length,
    retrievalDepth: 0,
    branchExpansions: 0,
    latencyMs,
    reason,
});

const buildPrompt = (entry: ContextBenchmarkCase): string =>
    [
        `Benchmark case: ${entry.id}`,
        'Task: classify each prior message independently for answering the trigger.',
        'Use necessary when the answer needs the message, useful when it helps but is not required, and irrelevant otherwise.',
        'Return JSON only: {"candidates":[{"id":"...","label":"necessary|useful|irrelevant","confidence":0.0}]}.',
        'Confidence is your estimate from 0 to 1, not a provider-calibrated probability.',
        `Trigger: ${entry.latestUserInput}`,
        'Prior messages:',
        JSON.stringify(
            entry.messages.map((message) => ({
                id: message.id,
                author: message.authorId,
                text: message.text,
            }))
        ),
    ].join('\n');

const classifyCandidates = (
    entry: ContextBenchmarkCase,
    value: unknown,
    budget: number
): HostedCandidateScore[] => {
    if (!isRecord(value) || !Array.isArray(value.candidates)) {
        throw new HostedError(
            'parse',
            'Hosted selector response is missing candidates.'
        );
    }
    const knownIds = new Set(entry.messages.map((message) => message.id));
    const seenIds = new Set<string>();
    const candidates = value.candidates.map(
        (candidate): HostedCandidateScore => {
            if (!isRecord(candidate)) {
                throw new HostedError(
                    'parse',
                    'Hosted selector returned an invalid candidate.'
                );
            }
            const messageId = stringValue(candidate.id);
            const label = stringValue(candidate.label) as HostedLabel | null;
            const confidence = numberValue(candidate.confidence);
            if (
                messageId === null ||
                !knownIds.has(messageId) ||
                seenIds.has(messageId) ||
                (label !== 'necessary' &&
                    label !== 'useful' &&
                    label !== 'irrelevant') ||
                confidence === null ||
                confidence < 0 ||
                confidence > 1
            ) {
                throw new HostedError(
                    'parse',
                    'Hosted selector returned an invalid or duplicate candidate score.'
                );
            }
            seenIds.add(messageId);
            return {
                messageId,
                label,
                confidence,
                selected: false,
                rank: null,
            };
        }
    );
    if (seenIds.size !== entry.messages.length) {
        throw new HostedError(
            'parse',
            `Hosted selector scored ${seenIds.size} of ${entry.messages.length} candidates.`
        );
    }

    const labelWeight: Record<HostedLabel, number> = {
        necessary: 2,
        useful: 1,
        irrelevant: 0,
    };
    const ranked = [...candidates].sort(
        (left, right) =>
            labelWeight[right.label] - labelWeight[left.label] ||
            right.confidence - left.confidence ||
            entry.messages.findIndex(
                (message) => message.id === left.messageId
            ) -
                entry.messages.findIndex(
                    (message) => message.id === right.messageId
                )
    );
    const selectedIds = new Set(
        ranked
            .filter(
                (candidate) =>
                    candidate.label !== 'irrelevant' &&
                    candidate.confidence >= CONFIDENCE_FLOOR
            )
            .slice(0, budget)
            .map((candidate) => candidate.messageId)
    );
    const rankById = new Map(
        ranked.map((candidate, index) => [candidate.messageId, index + 1])
    );
    return candidates.map((candidate) => ({
        ...candidate,
        selected: selectedIds.has(candidate.messageId),
        rank: rankById.get(candidate.messageId) ?? null,
    }));
};

type HostedRecordInput = {
    entry: ContextBenchmarkCase;
    selection: SelectionResult;
    options: HostedSelectionOptions;
    returnedModel: string | null;
    candidates: HostedCandidateScore[];
    usage: HostedSelectionRecord['usage'];
    costUsd: number | null;
    responseContent: string | null;
    error: HostedSelectionRecord['error'];
};

const makeRecord = ({
    entry,
    selection,
    options,
    returnedModel,
    candidates,
    usage,
    costUsd,
    responseContent,
    error,
}: HostedRecordInput): HostedSelectionRecord => ({
    schemaVersion: 1,
    caseId: entry.id,
    category: entry.category,
    selection,
    backend: {
        provider: 'openrouter',
        requestedModel: options.model,
        returnedModel,
        taskFormulation: 'pairwise_batch_zero_shot',
        scoreKind: 'model_reported_confidence',
        budget: options.budget ?? DEFAULT_BUDGET,
        confidenceFloor: CONFIDENCE_FLOOR,
    },
    candidates,
    usage,
    latencyMs: selection.latencyMs,
    costUsd,
    responseContent,
    error,
});

type HostedResponseData = {
    returnedModel: string | null;
    candidates: HostedCandidateScore[];
    usage: HostedSelectionRecord['usage'];
    costUsd: number | null;
    responseContent: string;
};

const parseHostedResponse = (
    body: unknown,
    entry: ContextBenchmarkCase,
    budget: number
): HostedResponseData => {
    if (!isRecord(body) || !Array.isArray(body.choices)) {
        throw new HostedError(
            'parse',
            'Hosted selector response is missing choices.'
        );
    }
    const choice = isRecord(body.choices[0]) ? body.choices[0] : null;
    const message = choice && isRecord(choice.message) ? choice.message : null;
    const responseContent = stringValue(message?.content);
    if (responseContent === null) {
        throw new HostedError(
            'parse',
            'Hosted selector response is missing message content.'
        );
    }
    const candidates = classifyCandidates(
        entry,
        parseResponseContent(responseContent),
        budget
    );
    const usageValue = isRecord(body.usage) ? body.usage : null;
    return {
        returnedModel: stringValue(body.model),
        candidates,
        usage: usageValue
            ? {
                  promptTokens: numberValue(usageValue.prompt_tokens),
                  completionTokens: numberValue(usageValue.completion_tokens),
                  totalTokens: numberValue(usageValue.total_tokens),
              }
            : null,
        costUsd: numberValue(usageValue?.cost),
        responseContent,
    };
};

/** Runs one synthetic benchmark case through a hosted zero-shot selector. */
export const runOpenRouterSelection = async (
    entry: ContextBenchmarkCase,
    options: HostedSelectionOptions
): Promise<HostedSelectionRecord> => {
    const startedAt = performance.now();
    const budget = options.budget ?? DEFAULT_BUDGET;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    timeoutHandle.unref?.();
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    const url = new URL('/api/v1/chat/completions', baseUrl).toString();
    const fetchImpl = options.fetchImpl ?? fetch;

    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${options.apiKey}`,
                'Content-Type': 'application/json',
                'X-Title': 'Footnote context-selection benchmark',
            },
            body: JSON.stringify({
                model: options.model,
                temperature: 0,
                response_format: { type: 'json_object' },
                messages: [
                    {
                        role: 'system',
                        content:
                            'You are a benchmark-only context selector. Do not answer the trigger.',
                    },
                    { role: 'user', content: buildPrompt(entry) },
                ],
            }),
            signal: controller.signal,
        });
        const rawBody = await response.text();
        const body =
            rawBody.trim().length > 0 ? (JSON.parse(rawBody) as unknown) : null;
        if (!response.ok) {
            const duration = performance.now() - startedAt;
            const message = responseMessage(body);
            return makeRecord({
                entry,
                selection: emptySelection(entry, duration, message),
                options,
                returnedModel: null,
                candidates: [],
                usage: null,
                costUsd: null,
                responseContent: null,
                error: { category: 'http', message },
            });
        }
        const hostedResponse = parseHostedResponse(body, entry, budget);
        const selectedIds = hostedResponse.candidates
            .filter((candidate) => candidate.selected)
            .sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0))
            .map((candidate) => candidate.messageId);
        const duration = performance.now() - startedAt;
        const selection: SelectionResult = {
            method: 'hosted_zero_shot',
            status: 'completed',
            messageIds: selectedIds,
            candidateCount: entry.messages.length,
            retrievalDepth: entry.messages.length,
            branchExpansions: 0,
            latencyMs: duration,
        };
        return makeRecord({
            entry,
            selection,
            options,
            returnedModel: hostedResponse.returnedModel,
            candidates: hostedResponse.candidates,
            usage: hostedResponse.usage,
            costUsd: hostedResponse.costUsd,
            responseContent: hostedResponse.responseContent,
            error: null,
        });
    } catch (error) {
        const duration = performance.now() - startedAt;
        const category: HostedFailureCategory =
            error instanceof SyntaxError
                ? 'response'
                : error instanceof HostedError
                  ? error.category
                  : 'transport';
        const message = error instanceof Error ? error.message : String(error);
        return makeRecord({
            entry,
            selection: emptySelection(entry, duration, message),
            options,
            returnedModel: null,
            candidates: [],
            usage: null,
            costUsd: null,
            responseContent: null,
            error: { category, message },
        });
    } finally {
        clearTimeout(timeoutHandle);
    }
};

type CliArguments = {
    caseId?: string;
    limit: number;
    model: string;
    baseUrl: string;
    budget: number;
    timeoutMs: number;
    outputDirectory: string;
    replay: boolean;
    replayBaseUrl: string;
};

const readArguments = (args: readonly string[]): CliArguments => {
    let caseId: string | undefined;
    let limit = 100;
    let model = process.env.CONTEXT_SELECTION_HOSTED_MODEL ?? DEFAULT_MODEL;
    let baseUrl =
        process.env.CONTEXT_SELECTION_HOSTED_BASE_URL ?? DEFAULT_BASE_URL;
    let budget = DEFAULT_BUDGET;
    let timeoutMs = DEFAULT_TIMEOUT_MS;
    let outputDirectory = path.resolve(
        '.footnote-dev',
        'context-selection-717-replay',
        `hosted-${new Date().toISOString().replace(/[:.]/gu, '-')}`
    );
    let replay = false;
    let replayBaseUrl = process.env.BACKEND_BASE_URL ?? 'http://localhost:3000';

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        const value = args[index + 1];
        if (argument === '--help') {
            throw new Error('HELP_REQUESTED');
        } else if (argument === '--case-id' && value !== undefined) {
            caseId = value;
            index += 1;
        } else if (argument === '--limit' && value !== undefined) {
            limit = Number(value);
            index += 1;
        } else if (argument === '--model' && value !== undefined) {
            model = value;
            index += 1;
        } else if (argument === '--base-url' && value !== undefined) {
            baseUrl = value;
            index += 1;
        } else if (argument === '--budget' && value !== undefined) {
            budget = Number(value);
            index += 1;
        } else if (argument === '--timeout-ms' && value !== undefined) {
            timeoutMs = Number(value);
            index += 1;
        } else if (argument === '--output-dir' && value !== undefined) {
            outputDirectory = path.resolve(value);
            index += 1;
        } else if (argument === '--replay') {
            replay = true;
        } else if (argument === '--replay-base-url' && value !== undefined) {
            replayBaseUrl = value;
            index += 1;
        } else {
            throw new Error(`Unknown or incomplete argument: ${argument}`);
        }
    }
    if (caseId === undefined && (!Number.isInteger(limit) || limit <= 0)) {
        throw new Error('--limit must be a positive integer.');
    }
    if (!Number.isInteger(budget) || budget <= 0) {
        throw new Error('--budget must be a positive integer.');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error('--timeout-ms must be positive.');
    }
    return {
        caseId,
        limit,
        model,
        baseUrl,
        budget,
        timeoutMs,
        outputDirectory,
        replay,
        replayBaseUrl,
    };
};

const writeSummary = (
    outputDirectory: string,
    records: readonly HostedSelectionRecord[],
    replayRecords: readonly ContextReplayRecord[]
): void => {
    const corpus = buildBenchmarkCorpus();
    const metrics = records.map((record) => {
        const entry = corpus.find(
            (candidate) => candidate.id === record.caseId
        );
        return entry === undefined
            ? null
            : buildCaseMetric(entry, record.selection);
    });
    const completedMetrics = metrics.filter(
        (metric): metric is NonNullable<typeof metric> => metric !== null
    );
    const successful = records.filter(
        (record) => record.selection.status === 'completed'
    );
    const totalCost = records.reduce(
        (sum, record) => sum + (record.costUsd ?? 0),
        0
    );
    const backend = records[0]?.backend;
    const categoryRows = [
        ...new Set(completedMetrics.map((metric) => metric.category)),
    ]
        .sort((left, right) => left.localeCompare(right))
        .map((category) => {
            const categoryMetrics = completedMetrics.filter(
                (metric) => metric.category === category
            );
            return `| ${category} | ${average(categoryMetrics.map((metric) => metric.necessaryRecall))} | ${average(categoryMetrics.map((metric) => metric.usefulContextPrecision))} | ${average(categoryMetrics.map((metric) => metric.distractingContextRate))} | ${average(categoryMetrics.map((metric) => metric.finalMessageCount))} |`;
        });
    const lines = [
        '# Hosted context-selection benchmark',
        '',
        'This is a benchmark-only zero-shot classifier through OpenRouter. It uses only the synthetic #717 corpus.',
        '',
        '| Provider | Requested model | Returned model | Formulation | Budget | Confidence floor |',
        '| --- | --- | --- | --- | ---: | ---: |',
        `| OpenRouter | ${backend?.requestedModel ?? 'n/a'} | ${backend?.returnedModel ?? 'varies or unavailable'} | pairwise batch zero-shot | ${backend?.budget ?? 'n/a'} | ${backend?.confidenceFloor ?? 'n/a'} |`,
        '',
        '| Cases | Selector success | Recall | Useful precision | Distracting rate | Avg messages | Avg units | Selector p95 ms | Cost USD | /api/chat replay |',
        '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        `| ${records.length} | ${successful.length}/${records.length} | ${average(completedMetrics.map((metric) => metric.necessaryRecall))} | ${average(completedMetrics.map((metric) => metric.usefulContextPrecision))} | ${average(completedMetrics.map((metric) => metric.distractingContextRate))} | ${average(completedMetrics.map((metric) => metric.finalMessageCount))} | ${average(completedMetrics.map((metric) => metric.estimatedInputTokens))} | ${p95(records.map((record) => record.latencyMs).filter((value): value is number => value !== null))} | ${totalCost.toFixed(6)} | ${replayStatus(replayRecords)} |`,
        '',
        '## Scenario breakdown',
        '',
        '| Category | Recall | Useful precision | Distracting rate | Avg messages |',
        '| --- | ---: | ---: | ---: | ---: |',
        ...categoryRows,
        '',
        'The confidence values are model-reported scores, not calibrated probabilities. The fixed confidence floor is 0.5 and the fixed selection budget is recorded in each JSONL record.',
        'Generation latency, tokens, cost, and answer support are in `replay.jsonl` when `--replay` is used. A selector result does not imply that downstream generation succeeded.',
    ];
    fs.writeFileSync(
        path.join(outputDirectory, 'summary.md'),
        `${lines.join('\n')}\n`,
        'utf8'
    );
};

const replayStatus = (records: readonly ContextReplayRecord[]): string =>
    records.length === 0
        ? 'not run'
        : `${records.filter((record) => record.chat.status === 'completed').length}/${records.length}`;

const average = (values: readonly (number | null)[]): string => {
    const present = values.filter((value): value is number => value !== null);
    return present.length === 0
        ? 'n/a'
        : (
              present.reduce((sum, value) => sum + value, 0) / present.length
          ).toFixed(3);
};

const p95 = (values: readonly number[]): string => {
    if (values.length === 0) return 'n/a';
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[
        Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
    ]!.toFixed(1);
};

const printHelp = (): void => {
    console.log(`Usage:
  pnpm eval:context-selection-hosted -- --limit 100

The command sends only the synthetic #717 corpus to an OpenRouter model.

Options:
  --case-id <id>                 Run one exact case.
  --limit <number>               Run the first cases (default: 100).
  --model <id>                   OpenRouter model (default: ${DEFAULT_MODEL}).
  --base-url <url>               OpenRouter base URL.
  --budget <number>              Maximum selected messages (default: ${DEFAULT_BUDGET}).
  --timeout-ms <number>          Per-case timeout.
  --output-dir <path>            Local artifact directory.
  --replay                       Also use the existing /api/chat replay client.
  --replay-base-url <url>        Footnote backend URL.
`);
};

const runCli = async (): Promise<void> => {
    dotenv.config({ quiet: true });
    const args = readArguments(process.argv.slice(2));
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is required.');
    if (args.replay && !process.env.AGENT_API_TOKEN) {
        throw new Error('AGENT_API_TOKEN is required when --replay is used.');
    }
    const corpus = buildBenchmarkCorpus();
    const cases = args.caseId
        ? corpus.filter((entry) => entry.id === args.caseId)
        : corpus.slice(0, args.limit);
    if (cases.length === 0)
        throw new Error(`Benchmark case not found: ${args.caseId}`);
    fs.mkdirSync(args.outputDirectory, { recursive: true });
    const records: HostedSelectionRecord[] = [];
    const replayRecords: ContextReplayRecord[] = [];
    for (const entry of cases) {
        const record = await runOpenRouterSelection(entry, {
            apiKey,
            model: args.model,
            baseUrl: args.baseUrl,
            budget: args.budget,
            timeoutMs: args.timeoutMs,
        });
        records.push(record);
        if (args.replay) {
            replayRecords.push(
                await replayContextSelection({
                    entry,
                    selection: record.selection,
                    baseUrl: args.replayBaseUrl,
                    agentToken: process.env.AGENT_API_TOKEN!,
                })
            );
        }
        console.log(
            `${entry.id} ${record.selection.status} ${record.selection.messageIds.length} selected ${record.latencyMs?.toFixed(0) ?? 'n/a'}ms`
        );
    }
    fs.writeFileSync(
        path.join(args.outputDirectory, 'hosted-selection.jsonl'),
        `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
        'utf8'
    );
    if (replayRecords.length > 0) {
        fs.writeFileSync(
            path.join(args.outputDirectory, 'replay.jsonl'),
            serializeReplayRecords(replayRecords),
            'utf8'
        );
    }
    writeSummary(args.outputDirectory, records, replayRecords);
    console.log(
        JSON.stringify(
            { outputDirectory: args.outputDirectory, records: records.length },
            null,
            2
        )
    );
};

const currentModulePath = fileURLToPath(import.meta.url);
const invokedModulePath = process.argv[1]
    ? path.resolve(process.argv[1])
    : null;
if (invokedModulePath === currentModulePath) {
    runCli().catch((error: unknown) => {
        if (error instanceof Error && error.message === 'HELP_REQUESTED') {
            printHelp();
            return;
        }
        console.error(
            `[context-selection-hosted] ${error instanceof Error ? error.message : String(error)}`
        );
        process.exitCode = 1;
    });
}
