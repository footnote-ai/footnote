/**
 * @description: Replays existing context-selection results through the real
 * /api/chat boundary and writes local comparison records.
 * @footnote-scope: test
 * @footnote-module: ContextSelectionChatReplay
 * @footnote-risk: medium - Live replay can spend provider budget and produce misleading comparisons if request and selector records diverge.
 * @footnote-ethics: high - Replay uses synthetic fixtures by default and keeps generated content in local artifacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import {
    PostChatResponseSchema,
    type ChatConversationMessage,
    type ChatSurface,
    type ChatTriggerKind,
    type PostChatRequest,
    type PostChatResponse,
} from '@footnote/contracts/web';
import type {
    GenerationExecutionEvent,
    ResponseMetadata,
} from '@footnote/contracts/policy';
import {
    sendAgentChatRequest,
    type AgentChatRequestOptions,
    type AgentChatResult,
} from './agent-chat.js';
import {
    buildBenchmarkCorpus,
    buildCaseMetric,
    selectContext,
    type ContextBenchmarkCase,
    type ContextSelectionMethod,
    type SelectionResult,
} from './context-selection-benchmark.js';
import {
    evaluateGeneratedAnswer,
    type GeneratedAnswerSupport,
} from './context-selection-answer-quality.js';

export const REPLAYABLE_CONTEXT_SELECTION_METHODS: readonly ContextSelectionMethod[] =
    [
        'current_window',
        'recency_reply_expansion',
        'recency_author_continuation',
        'bm25',
        'bm25_reply_expansion',
        'bm25_graph_expansion',
        'hash_embedding_proxy',
    ];

export type ContextReplayRequestOptions = {
    surface?: ChatSurface;
    modeId?: PostChatRequest['modeId'];
    triggerKind?: ChatTriggerKind;
    triggerMessageId?: string;
    plannerProfileId?: string;
    generateProfileId?: string;
    assessProfileId?: string;
};

export type ContextReplayFailureCategory =
    'request' | 'transport' | 'http' | 'response_schema' | null;

export type ContextReplayRecord = {
    schemaVersion: 1;
    caseId: string;
    category: ContextBenchmarkCase['category'];
    selector: {
        method: ContextSelectionMethod;
        status: SelectionResult['status'];
        selectedMessageIds: string[];
        selectedCount: number;
        candidateCount: number;
        retrievalDepth: number;
        branchExpansionCount: number;
        expansionDepth: number | null;
        latencyMs: number | null;
        reason: string | null;
        necessaryRecall: number | null;
        usefulContextPrecision: number | null;
        distractingContextRate: number | null;
        historicalDistanceRecovery: number | null;
    };
    request: {
        surface: ChatSurface;
        triggerKind: ChatTriggerKind;
        triggerMessageId: string | null;
        selectedMessageIds: string[];
        selectedMessageCount: number;
        estimatedContextUnits: number;
    };
    chat: {
        status: 'not_run' | 'completed' | 'failed';
        httpStatus: number | null;
        httpOk: boolean | null;
        durationMs: number | null;
        responseId: string | null;
        responseSchemaValid: boolean | null;
        action: PostChatResponse['action'] | null;
        responseText: string | null;
        provider: string | null;
        model: string | null;
        profileId: string | null;
        promptTokens: number | null;
        completionTokens: number | null;
        totalTokens: number | null;
        costUsd: number | null;
        execution: ResponseMetadata['execution'] | null;
        workflow: ResponseMetadata['workflow'] | null;
        responseBody: unknown;
        failureCategory: ContextReplayFailureCategory;
        error: string | null;
    };
    downstream: GeneratedAnswerSupport | null;
};

export type ContextReplaySender = (
    options: AgentChatRequestOptions
) => Promise<AgentChatResult>;

export const serializeReplayRecords = (
    records: readonly ContextReplayRecord[]
): string =>
    records.length === 0
        ? ''
        : `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;

const selectedMessageSet = (selection: SelectionResult): Set<string> =>
    new Set(selection.messageIds);

/**
 * Projects a selector result back into chronological conversation order while
 * retaining the public chat message metadata needed by the backend.
 */
export const projectSelectedMessages = (
    entry: ContextBenchmarkCase,
    selection: SelectionResult
): ChatConversationMessage[] => {
    if (
        selection.status === 'unavailable' ||
        selection.messageIds.length === 0
    ) {
        return [];
    }

    const selectedIds = selectedMessageSet(selection);
    const knownIds = new Set(entry.messages.map((message) => message.id));
    const unknownIds = selection.messageIds.filter(
        (messageId) => !knownIds.has(messageId)
    );
    if (unknownIds.length > 0) {
        throw new Error(
            `Selector ${selection.method} returned unknown message IDs: ${unknownIds.join(', ')}`
        );
    }

    return entry.messages
        .filter((message) => selectedIds.has(message.id))
        .map((message) => ({
            role: message.role ?? 'user',
            content: message.text,
            authorId: message.authorId,
            authorName: message.authorName ?? message.authorId,
            messageId: message.id,
            ...(message.createdAt === undefined
                ? {}
                : { createdAt: message.createdAt }),
        }));
};

/** Builds a valid PostChatRequest without adding benchmark labels to it. */
export const buildContextReplayRequest = (
    entry: ContextBenchmarkCase,
    selection: SelectionResult,
    options: ContextReplayRequestOptions = {}
): PostChatRequest => {
    const conversation = projectSelectedMessages(entry, selection);
    if (conversation.length === 0) {
        throw new Error(
            `Cannot replay ${selection.method} for ${entry.id}: no context messages were selected.`
        );
    }

    const triggerKind = options.triggerKind ?? entry.triggerKind ?? 'direct';
    const triggerMessageId = options.triggerMessageId ?? entry.triggerMessageId;

    return {
        surface: options.surface ?? 'discord',
        ...(options.modeId === undefined ? {} : { modeId: options.modeId }),
        ...(options.plannerProfileId === undefined
            ? {}
            : { plannerProfileId: options.plannerProfileId }),
        ...(options.generateProfileId === undefined
            ? {}
            : { generateProfileId: options.generateProfileId }),
        ...(options.assessProfileId === undefined
            ? {}
            : { assessProfileId: options.assessProfileId }),
        trigger: {
            kind: triggerKind,
            ...(triggerMessageId === undefined
                ? {}
                : { messageId: triggerMessageId }),
        },
        latestUserInput: entry.latestUserInput,
        conversation,
        capabilities: {
            canReact: false,
            canGenerateImages: false,
            canUseTts: false,
        },
    };
};

const latestGeneration = (
    metadata: ResponseMetadata
): GenerationExecutionEvent | null => {
    const execution = metadata.execution ?? [];
    for (const event of [...execution].reverse()) {
        if (event.kind === 'generation') {
            return event;
        }
    }
    return null;
};

const emptyChatResult = (
    status: ContextReplayRecord['chat']['status'],
    error: string | null,
    failureCategory: ContextReplayFailureCategory = null
): ContextReplayRecord['chat'] => ({
    status,
    httpStatus: null,
    httpOk: null,
    durationMs: null,
    responseId: null,
    responseSchemaValid: null,
    action: null,
    responseText: null,
    provider: null,
    model: null,
    profileId: null,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    costUsd: null,
    execution: null,
    workflow: null,
    responseBody: null,
    failureCategory,
    error,
});

const parseChatResult = (
    result: AgentChatResult
): ContextReplayRecord['chat'] => {
    const parsed = PostChatResponseSchema.safeParse(result.body);
    if (!parsed.success) {
        return {
            ...emptyChatResult(
                'failed',
                parsed.error.message,
                result.ok ? 'response_schema' : 'http'
            ),
            httpStatus: result.status,
            httpOk: result.ok,
            durationMs: result.durationMs,
            responseSchemaValid: false,
            responseBody: result.body,
        };
    }

    const response = parsed.data;
    const metadata = response.metadata;
    const generation = metadata === null ? null : latestGeneration(metadata);
    const usage = generation?.usage;

    return {
        status: result.ok ? 'completed' : 'failed',
        httpStatus: result.status,
        httpOk: result.ok,
        durationMs: result.durationMs,
        responseId: metadata?.responseId ?? null,
        responseSchemaValid: true,
        action: response.action,
        responseText: response.action === 'message' ? response.message : null,
        provider: generation?.provider ?? null,
        model: generation?.model ?? null,
        profileId:
            generation?.effectiveProfileId ?? generation?.profileId ?? null,
        promptTokens: usage?.promptTokens ?? null,
        completionTokens: usage?.completionTokens ?? null,
        totalTokens: usage?.totalTokens ?? null,
        costUsd:
            generation?.upstreamAttribution?.upstreamReportedCostUsd ?? null,
        execution: metadata?.execution ?? null,
        workflow: metadata?.workflow ?? null,
        responseBody: result.body,
        failureCategory: result.ok ? null : 'http',
        error: result.ok
            ? null
            : `Chat endpoint returned HTTP ${result.status}.`,
    };
};

const selectorRecord = (
    selection: SelectionResult,
    metric: ReturnType<typeof buildCaseMetric>
): ContextReplayRecord['selector'] => ({
    method: selection.method,
    status: selection.status,
    selectedMessageIds: [...selection.messageIds],
    selectedCount: new Set(selection.messageIds).size,
    candidateCount: selection.candidateCount,
    retrievalDepth: selection.retrievalDepth,
    branchExpansionCount: selection.branchExpansions,
    expansionDepth: selection.expansionDepth ?? null,
    latencyMs: selection.latencyMs,
    reason: selection.reason ?? null,
    necessaryRecall: metric.necessaryRecall,
    usefulContextPrecision: metric.usefulContextPrecision,
    distractingContextRate: metric.distractingContextRate,
    historicalDistanceRecovery: metric.historicalDistanceRecovery,
});

const buildRecord = (
    entry: ContextBenchmarkCase,
    selection: SelectionResult,
    requestOptions: ContextReplayRequestOptions,
    chat: ContextReplayRecord['chat'],
    requestMessageIds: string[] = []
): ContextReplayRecord => {
    const metric = buildCaseMetric(entry, selection);
    return {
        schemaVersion: 1,
        caseId: entry.id,
        category: entry.category,
        selector: selectorRecord(selection, metric),
        request: {
            surface: requestOptions.surface ?? 'discord',
            triggerKind:
                requestOptions.triggerKind ?? entry.triggerKind ?? 'direct',
            triggerMessageId:
                requestOptions.triggerMessageId ??
                entry.triggerMessageId ??
                null,
            selectedMessageIds: requestMessageIds,
            selectedMessageCount: requestMessageIds.length,
            estimatedContextUnits: metric.estimatedInputTokens,
        },
        chat,
        downstream:
            chat.responseText === null
                ? null
                : evaluateGeneratedAnswer(entry, chat.responseText),
    };
};

/** Runs one already-selected context pack through the canonical chat client. */
export const replayContextSelection = async (input: {
    entry: ContextBenchmarkCase;
    selection: SelectionResult;
    baseUrl: string;
    agentToken: string;
    timeoutMs?: number;
    requestOptions?: ContextReplayRequestOptions;
    sendRequest?: ContextReplaySender;
}): Promise<ContextReplayRecord> => {
    const requestOptions = input.requestOptions ?? {};
    if (input.selection.status === 'unavailable') {
        return buildRecord(
            input.entry,
            input.selection,
            requestOptions,
            emptyChatResult(
                'not_run',
                input.selection.reason ?? 'Selector was unavailable.'
            )
        );
    }

    let request: PostChatRequest;
    let requestMessageIds: string[];
    try {
        request = buildContextReplayRequest(
            input.entry,
            input.selection,
            requestOptions
        );
        requestMessageIds = request.conversation
            .map((message) => message.messageId)
            .filter(
                (messageId): messageId is string => messageId !== undefined
            );
    } catch (error) {
        return buildRecord(
            input.entry,
            input.selection,
            requestOptions,
            emptyChatResult(
                'not_run',
                error instanceof Error ? error.message : String(error),
                'request'
            )
        );
    }

    try {
        const sendRequest = input.sendRequest ?? sendAgentChatRequest;
        const result = await sendRequest({
            baseUrl: input.baseUrl,
            agentToken: input.agentToken,
            request,
            timeoutMs: input.timeoutMs,
        });
        return buildRecord(
            input.entry,
            input.selection,
            requestOptions,
            parseChatResult(result),
            requestMessageIds
        );
    } catch (error) {
        return buildRecord(
            input.entry,
            input.selection,
            requestOptions,
            emptyChatResult(
                'failed',
                error instanceof Error ? error.message : String(error),
                'transport'
            ),
            requestMessageIds
        );
    }
};

type ReplayArguments = {
    caseId?: string;
    limit: number;
    methods: ContextSelectionMethod[];
    baseUrl: string;
    timeoutMs: number;
    outputDirectory: string;
    requestOptions: ContextReplayRequestOptions;
};

const DEFAULT_TIMEOUT_MS = 180_000;

const parseMethods = (value: string): ContextSelectionMethod[] => {
    const methods = value.split(',').map((method) => method.trim());
    const invalid = methods.filter(
        (method): method is string =>
            !REPLAYABLE_CONTEXT_SELECTION_METHODS.includes(
                method as ContextSelectionMethod
            )
    );
    if (invalid.length > 0) {
        throw new Error(
            `Unsupported replay selector(s): ${invalid.join(', ')}`
        );
    }
    return methods as ContextSelectionMethod[];
};

const readArguments = (args: readonly string[]): ReplayArguments => {
    let caseId: string | undefined;
    let limit = 1;
    let methods = [...REPLAYABLE_CONTEXT_SELECTION_METHODS];
    let baseUrl = process.env.BACKEND_BASE_URL ?? 'http://localhost:3000';
    let timeoutMs = DEFAULT_TIMEOUT_MS;
    let outputDirectory = path.resolve(
        '.footnote-dev',
        'context-selection-717-replay',
        new Date().toISOString().replace(/[:.]/gu, '-')
    );
    const requestOptions: ContextReplayRequestOptions = {};

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        const value = args[index + 1];
        if (argument === '--help') {
            throw new Error('HELP_REQUESTED');
        }
        if (argument === '--case-id' && value !== undefined) {
            caseId = value;
            index += 1;
        } else if (argument === '--limit' && value !== undefined) {
            limit = Number(value);
            index += 1;
        } else if (argument === '--methods' && value !== undefined) {
            methods = parseMethods(value);
            index += 1;
        } else if (argument === '--base-url' && value !== undefined) {
            baseUrl = value;
            index += 1;
        } else if (argument === '--timeout-ms' && value !== undefined) {
            timeoutMs = Number(value);
            index += 1;
        } else if (argument === '--output-dir' && value !== undefined) {
            outputDirectory = path.resolve(value);
            index += 1;
        } else if (argument === '--surface' && value !== undefined) {
            requestOptions.surface = value as ChatSurface;
            index += 1;
        } else if (argument === '--mode-id' && value !== undefined) {
            requestOptions.modeId = value as PostChatRequest['modeId'];
            index += 1;
        } else if (
            argument === '--generate-profile-id' &&
            value !== undefined
        ) {
            requestOptions.generateProfileId = value;
            index += 1;
        } else if (argument === '--planner-profile-id' && value !== undefined) {
            requestOptions.plannerProfileId = value;
            index += 1;
        } else if (argument === '--assess-profile-id' && value !== undefined) {
            requestOptions.assessProfileId = value;
            index += 1;
        } else {
            throw new Error(`Unknown or incomplete argument: ${argument}`);
        }
    }

    if (caseId === undefined && (!Number.isInteger(limit) || limit <= 0)) {
        throw new Error('--limit must be a positive integer.');
    }
    if (timeoutMs <= 0 || !Number.isFinite(timeoutMs)) {
        throw new Error('--timeout-ms must be positive.');
    }
    if (methods.length === 0) {
        throw new Error('--methods must include at least one selector.');
    }
    return {
        caseId,
        limit,
        methods,
        baseUrl,
        timeoutMs,
        outputDirectory,
        requestOptions,
    };
};

const printHelp = (): void => {
    console.log(`Usage:
  pnpm eval:context-selection-replay -- --case-id context-selection-001

The command loads BACKEND_BASE_URL and AGENT_API_TOKEN from .env.
It replays one case by default and writes local JSONL and Markdown artifacts.

Options:
  --case-id <id>                 Replay one exact benchmark case.
  --limit <number>               Replay the first cases when --case-id is absent (default: 1).
  --methods <a,b,c>              Select replayable methods (default: all deterministic methods).
  --base-url <url>               Backend URL (default: BACKEND_BASE_URL or localhost).
  --timeout-ms <number>          Per-request timeout (default: ${DEFAULT_TIMEOUT_MS}).
  --output-dir <path>            Local artifact directory.
  --surface <web|discord>        Chat surface (default: discord).
  --mode-id <id>                 Optional workflow mode.
  --generate-profile-id <id>     Optional generation profile.
  --planner-profile-id <id>      Optional planner profile.
  --assess-profile-id <id>       Optional assessor profile.
`);
};

const average = (values: number[]): number | null =>
    values.length === 0
        ? null
        : values.reduce((total, value) => total + value, 0) / values.length;

const writeSummary = (
    outputDirectory: string,
    corpus: readonly ContextBenchmarkCase[],
    records: readonly ContextReplayRecord[]
): void => {
    const methods = [
        ...new Set(records.map((record) => record.selector.method)),
    ];
    const lines = [
        '# Context-selection /api/chat replay',
        '',
        'This report compares selector outputs through the real chat endpoint. It is not a single quality score.',
        '',
        '| Method | Cases | Chat success | Offline recall | Offline useful precision | Avg messages | Avg context units | Avg generation ms | Avg cost USD | Answer fact support |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...methods.map((method) => {
            const methodRecords = records.filter(
                (record) => record.selector.method === method
            );
            const successful = methodRecords.filter(
                (record) => record.chat.status === 'completed'
            ).length;
            const metrics = methodRecords.flatMap((record) => {
                const entry = corpus.find(
                    (candidate) => candidate.id === record.caseId
                );
                if (entry === undefined) {
                    return [];
                }
                return [
                    buildCaseMetric(entry, {
                        method: record.selector.method,
                        status: record.selector.status,
                        messageIds: record.selector.selectedMessageIds,
                        candidateCount: record.selector.candidateCount,
                        retrievalDepth: record.selector.retrievalDepth,
                        branchExpansions: record.selector.branchExpansionCount,
                        expansionDepth:
                            record.selector.expansionDepth ?? undefined,
                        latencyMs: record.selector.latencyMs,
                        reason: record.selector.reason ?? undefined,
                    }),
                ];
            });
            const facts = methodRecords.filter(
                (record) => record.downstream?.answerCorrect === true
            );
            const costs = methodRecords
                .map((record) => record.chat.costUsd)
                .filter((value): value is number => value !== null);
            const durations = methodRecords
                .map((record) => record.chat.durationMs)
                .filter((value): value is number => value !== null);
            const recalls = metrics
                .map((metric) => metric.necessaryRecall)
                .filter((value): value is number => value !== null);
            const precisions = metrics
                .map((metric) => metric.usefulContextPrecision)
                .filter((value): value is number => value !== null);
            return `| ${method} | ${methodRecords.length} | ${successful}/${methodRecords.length} | ${average(recalls)?.toFixed(3) ?? 'n/a'} | ${average(precisions)?.toFixed(3) ?? 'n/a'} | ${average(metrics.map((metric) => metric.finalMessageCount))?.toFixed(1) ?? 'n/a'} | ${average(metrics.map((metric) => metric.estimatedInputTokens))?.toFixed(1) ?? 'n/a'} | ${average(durations)?.toFixed(0) ?? 'n/a'} | ${average(costs)?.toFixed(6) ?? 'n/a'} | ${facts.length}/${methodRecords.length} |`;
        }),
        '',
        'The response body and execution metadata remain in `replay.jsonl` for case-level review.',
        'Answer fact support uses the synthetic token proxy and is not a general model judge. Distractor overlap is only a possible lexical match.',
    ];
    fs.writeFileSync(
        path.join(outputDirectory, 'summary.md'),
        `${lines.join('\n')}\n`,
        'utf8'
    );
};

const runCli = async (): Promise<void> => {
    dotenv.config();
    const argumentsValue = readArguments(process.argv.slice(2));
    const agentToken = process.env.AGENT_API_TOKEN;
    if (agentToken === undefined || agentToken.length === 0) {
        throw new Error('AGENT_API_TOKEN is required for live replay.');
    }

    const corpus = buildBenchmarkCorpus();
    const selectedCases = argumentsValue.caseId
        ? corpus.filter((entry) => entry.id === argumentsValue.caseId)
        : corpus.slice(0, argumentsValue.limit);
    if (selectedCases.length === 0) {
        throw new Error(`Benchmark case not found: ${argumentsValue.caseId}`);
    }

    fs.mkdirSync(argumentsValue.outputDirectory, { recursive: true });
    const records: ContextReplayRecord[] = [];
    for (const entry of selectedCases) {
        for (const method of argumentsValue.methods) {
            const selection = selectContext(method, entry);
            const record = await replayContextSelection({
                entry,
                selection,
                baseUrl: argumentsValue.baseUrl,
                agentToken,
                timeoutMs: argumentsValue.timeoutMs,
                requestOptions: argumentsValue.requestOptions,
            });
            records.push(record);
            console.log(
                `${entry.id} ${method} ${record.chat.status} ${record.chat.durationMs ?? 'n/a'}ms`
            );
        }
    }

    fs.writeFileSync(
        path.join(argumentsValue.outputDirectory, 'replay.jsonl'),
        serializeReplayRecords(records),
        'utf8'
    );
    writeSummary(argumentsValue.outputDirectory, corpus, records);
    console.log(
        JSON.stringify(
            {
                outputDirectory: argumentsValue.outputDirectory,
                records: records.length,
            },
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
            `[context-selection-replay] ${error instanceof Error ? error.message : String(error)}`
        );
        process.exitCode = 1;
    });
}
