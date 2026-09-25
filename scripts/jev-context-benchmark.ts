/**
 * @description: Runs a benchmark-only Jev/System One context judgment against the
 * frozen #717 synthetic corpus and one small claim-support workload.
 * @footnote-scope: test
 * @footnote-module: JevContextBenchmark
 * @footnote-risk: medium - External model drift or metric mistakes could mislead an evaluation decision.
 * @footnote-ethics: high - Only committed synthetic fixtures are sent to an external provider.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
    aggregateMetrics,
    buildBenchmarkCorpus,
    buildCaseMetric,
    selectContext,
    selectContextAtBudget,
    type BenchmarkMessage,
    type CaseMetric,
    type ContextBenchmarkCase,
    type SelectionResult,
} from './context-selection-benchmark.js';

type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

type NoulQuestion = {
    type: 'noul';
    instructions: string;
    criteria: { true: string; false: string };
};

type ScoreQuestion = {
    type: 'score';
    instructions: string;
    criteria: [string, string, string];
};

type JevQuestion = NoulQuestion | ScoreQuestion;

type JevNoulAnswer = { type: 'noul'; noul: number };

type JevScoreAnswer = {
    type: 'score';
    score: number;
    confidence: number;
    probabilities: Record<string, number>;
};

type JevAnswer = JevNoulAnswer | JevScoreAnswer;

type JevApiResponse = {
    model: string;
    answers: Record<string, JevAnswer>;
    usage: { input_tokens: number; output_tokens: number; cost?: number };
    id?: string;
    provider?: string;
};

type JevProvider = 'openrouter' | 'typesafe';

export type JevClientOptions = {
    apiKey: string;
    provider: JevProvider;
    model: string;
    timeoutMs: number;
    fetchImplementation?: typeof fetch;
};

type JevCall = {
    response: JevApiResponse;
    latencyMs: number;
};

type JevCaseRecord = {
    caseId: string;
    category: ContextBenchmarkCase['category'];
    status: 'completed' | 'unavailable' | 'error';
    threshold: number;
    selection: SelectionResult;
    metric: CaseMetric;
    candidateProbabilities: Record<string, number>;
    score?: {
        score: number;
        confidence: number;
        probabilities: Record<string, number>;
    };
    model?: string;
    provider?: string;
    usage?: JevApiResponse['usage'];
    latencyMs: number | null;
    error?: string;
};

type ClaimEvidenceFixture = {
    id: string;
    claim: string;
    evidence: BenchmarkMessage[];
    expected: 'supported' | 'contradicted' | 'unknown';
};

type ClaimEvidenceRecord = {
    id: string;
    expected: ClaimEvidenceFixture['expected'];
    status: 'completed' | 'unavailable' | 'error';
    probability: number | null;
    predictedSupported: boolean | null;
    correct: boolean | null;
    model?: string;
    provider?: string;
    usage?: JevApiResponse['usage'];
    latencyMs: number | null;
    error?: string;
};

type ThresholdSummary = {
    threshold: number;
    completedCases: number;
    unavailableCases: number;
    errorCases: number;
    abstainedCases: number;
    necessaryMessageRecall: number | null;
    usefulContextPrecision: number | null;
    distractingContextRate: number | null;
    averageSelectedMessages: number | null;
    averageContextUnits: number | null;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    meanCandidateProbability: number | null;
    candidateProbabilityByCategory: Record<string, number | null>;
};

type UsageSummary = {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    reportedCostUsd: number | null;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
};

type JevBenchmarkReport = {
    benchmark: {
        corpus: 'synthetic_structurally_faithful';
        caseCount: number;
        candidateBudget: number;
        thresholds: number[];
        requestedModel: string | null;
        returnedModels: Record<string, number>;
        provider: JevProvider | null;
        status: 'completed' | 'blocked' | 'partial';
        blockedReason?: string;
        limitations: string[];
    };
    baselines: {
        currentWindow: ReturnType<typeof aggregateMetrics>;
        bm25Graph: ReturnType<typeof aggregateMetrics>;
        frozenGenericHosted: {
            source: string;
            necessaryMessageRecall: number;
            usefulContextPrecision: number;
            averageSelectedMessages: number;
            averageContextUnits: number;
            averageLatencyMs: number;
            reportedCostUsd: number;
            label: 'generic_hosted_selector';
        };
    };
    usage: { context: UsageSummary; claimEvidence: UsageSummary };
    thresholds: ThresholdSummary[];
    contextCases: JevCaseRecord[];
    claimEvidence: {
        fixtureCount: number;
        records: ClaimEvidenceRecord[];
        accuracy: number | null;
        averageProbability: number | null;
    };
};

const CONTEXT_CANDIDATE_BUDGET = 15;
const THRESHOLDS = [0.5, 0.7, 0.8] as const;
const DEFAULT_TIMEOUT_MS = 30_000;
const JEV_CONTEXT_SOURCE =
    'synthetic #717 fixture; IDs and labels stay local to the benchmark';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const readNumber = (value: unknown, name: string): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Invalid Jev response field: ${name}`);
    }
    return value;
};

const parseJevResponse = (value: unknown): JevApiResponse => {
    if (
        !isRecord(value) ||
        typeof value.model !== 'string' ||
        !isRecord(value.answers)
    ) {
        throw new Error('Invalid Jev response envelope.');
    }
    const answers: Record<string, JevAnswer> = {};
    for (const [name, rawAnswer] of Object.entries(value.answers)) {
        if (!isRecord(rawAnswer) || typeof rawAnswer.type !== 'string') {
            throw new Error(`Invalid Jev answer: ${name}`);
        }
        if (rawAnswer.type === 'noul') {
            answers[name] = {
                type: 'noul',
                noul: readNumber(rawAnswer.noul, `${name}.noul`),
            };
            continue;
        }
        if (rawAnswer.type === 'score' && isRecord(rawAnswer.probabilities)) {
            const probabilities = Object.fromEntries(
                Object.entries(rawAnswer.probabilities).map(
                    ([key, probability]) => [
                        key,
                        readNumber(probability, `${name}.probabilities.${key}`),
                    ]
                )
            );
            answers[name] = {
                type: 'score',
                score: readNumber(rawAnswer.score, `${name}.score`),
                confidence: readNumber(
                    rawAnswer.confidence,
                    `${name}.confidence`
                ),
                probabilities,
            };
            continue;
        }
        throw new Error(`Unsupported Jev answer type: ${name}`);
    }
    if (!isRecord(value.usage)) {
        throw new Error('Invalid Jev usage envelope.');
    }
    return {
        model: value.model,
        answers,
        usage: {
            input_tokens: readNumber(
                value.usage.input_tokens,
                'usage.input_tokens'
            ),
            output_tokens: readNumber(
                value.usage.output_tokens,
                'usage.output_tokens'
            ),
            ...(typeof value.usage.cost === 'number'
                ? { cost: value.usage.cost }
                : {}),
        },
        ...(typeof value.id === 'string' ? { id: value.id } : {}),
        ...(typeof value.provider === 'string'
            ? { provider: value.provider }
            : {}),
    };
};

const endpointFor = (provider: JevProvider): string =>
    provider === 'openrouter'
        ? 'https://openrouter.ai/api/alpha/decisions'
        : 'https://api.typesafe.ai/v1/systemone';

const withAbort = async <T>(
    timeoutMs: number,
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>
): Promise<T> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
        return await operation(controller.signal);
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
    }
};

/** Calls the benchmark-only Jev/System One boundary without exposing credentials or response bodies. */
export const callJev = async (
    state: JsonValue,
    questions: Record<string, JevQuestion>,
    options: JevClientOptions,
    signal?: AbortSignal
): Promise<JevCall> => {
    const startedAt = performance.now();
    const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
    const response = await withAbort(
        options.timeoutMs,
        signal,
        (requestSignal) =>
            fetchImplementation(endpointFor(options.provider), {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${options.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: options.model,
                    state,
                    questions,
                }),
                signal: requestSignal,
            })
    );
    if (!response.ok) {
        throw new Error(`Jev request failed with HTTP ${response.status}.`);
    }
    return {
        response: parseJevResponse(await response.json()),
        latencyMs: performance.now() - startedAt,
    };
};

const contextState = (
    entry: ContextBenchmarkCase,
    candidates: BenchmarkMessage[]
): JsonValue => ({
    query: entry.latestUserInput,
    candidates: candidates.map((message) => ({
        id: message.id,
        author: message.authorId,
        text: message.text,
        ...(message.replyToId === undefined
            ? {}
            : { replyTo: message.replyToId }),
    })),
    source: JEV_CONTEXT_SOURCE,
});

const contextQuestions = (
    candidates: BenchmarkMessage[]
): Record<string, JevQuestion> => {
    const questions: Record<string, JevQuestion> = {};
    for (const [index, candidate] of candidates.entries()) {
        questions[`candidate_${index.toString().padStart(2, '0')}`] = {
            type: 'noul',
            instructions:
                `Is candidate ${candidate.id} necessary or directly useful context for answering the query? ` +
                'Judge only the candidate message in the supplied state. Do not infer missing facts.',
            criteria: {
                true: 'The message supplies a fact or relationship needed to answer the query.',
                false: 'The message is unrelated, redundant, stale, or a distractor for this query.',
            },
        };
    }
    questions.context_sufficiency = {
        type: 'score',
        instructions:
            'How sufficient is the supplied candidate set for answering the query without inventing facts?',
        criteria: [
            'Insufficient: important evidence is missing.',
            'Partly sufficient: some evidence is present but a material gap remains.',
            'Sufficient: the candidate set contains the evidence needed for a grounded answer.',
        ],
    };
    return questions;
};

const jevSelection = (
    entry: ContextBenchmarkCase,
    candidates: BenchmarkMessage[],
    call: JevCall,
    threshold: number
): {
    selection: SelectionResult;
    probabilities: Record<string, number>;
    score?: JevCaseRecord['score'];
} => {
    const probabilities: Record<string, number> = {};
    const selectedIds: string[] = [];
    for (const [index, candidate] of candidates.entries()) {
        const answer =
            call.response.answers[
                `candidate_${index.toString().padStart(2, '0')}`
            ];
        if (answer?.type !== 'noul') {
            throw new Error(`Missing Jev probability for ${candidate.id}.`);
        }
        probabilities[candidate.id] = answer.noul;
        if (answer.noul >= threshold) {
            selectedIds.push(candidate.id);
        }
    }
    const scoreAnswer = call.response.answers.context_sufficiency;
    return {
        selection: {
            method: 'jev',
            status: 'completed',
            messageIds: candidates
                .filter((candidate) => selectedIds.includes(candidate.id))
                .map((candidate) => candidate.id),
            candidateCount: entry.messages.length,
            retrievalDepth: candidates.length,
            branchExpansions: 0,
            latencyMs: call.latencyMs,
        },
        probabilities,
        ...(scoreAnswer?.type === 'score'
            ? {
                  score: {
                      score: scoreAnswer.score,
                      confidence: scoreAnswer.confidence,
                      probabilities: scoreAnswer.probabilities,
                  },
              }
            : {}),
    };
};

const errorText = (error: unknown): string =>
    error instanceof Error ? error.message : 'Unknown Jev error.';

const unavailableSelection = (
    entry: ContextBenchmarkCase,
    reason: string
): SelectionResult => ({
    method: 'jev',
    status: 'unavailable',
    messageIds: [],
    candidateCount: entry.messages.length,
    retrievalDepth: 0,
    branchExpansions: 0,
    latencyMs: null,
    reason,
});

const buildClaimEvidenceFixtures = (
    corpus: ContextBenchmarkCase[]
): ClaimEvidenceFixture[] => {
    const scattered = corpus.find(
        (entry) => entry.category === 'scattered_context'
    );
    const speaker = corpus.find(
        (entry) => entry.category === 'speaker_sensitive'
    );
    const historical = corpus.find(
        (entry) => entry.category === 'negative_historical_match'
    );
    const overlap = corpus.find(
        (entry) => entry.category === 'misleading_overlap_hard'
    );
    if (!scattered || !speaker || !historical || !overlap) {
        throw new Error(
            'Claim/evidence fixtures require the frozen benchmark categories.'
        );
    }
    const message = (
        entry: ContextBenchmarkCase,
        id: string
    ): BenchmarkMessage => {
        const found = entry.messages.find((candidate) => candidate.id === id);
        if (!found) throw new Error(`Missing fixture message ${id}.`);
        return found;
    };
    return [
        {
            id: 'claim-supported-manifest',
            claim: 'The signed manifest is uploaded only after both checks pass.',
            evidence: [
                message(scattered, scattered.necessaryMessageIds[2] ?? ''),
            ],
            expected: 'supported',
        },
        {
            id: 'claim-supported-speaker',
            claim: 'Alex recommends keeping the audit export for seven days.',
            evidence: [message(speaker, speaker.necessaryMessageIds[0] ?? '')],
            expected: 'supported',
        },
        {
            id: 'claim-contradicted-queue',
            claim: 'The current image worker uses the cedar queue.',
            evidence: [
                message(historical, historical.necessaryMessageIds[0] ?? ''),
            ],
            expected: 'contradicted',
        },
        {
            id: 'claim-contradicted-thumbnail',
            claim: 'The archive image worker is the thumbnail worker.',
            evidence: [
                message(overlap, overlap.distractingMessageIds[1] ?? ''),
            ],
            expected: 'contradicted',
        },
        {
            id: 'claim-unknown-violet-marker',
            claim: 'The release uses rollback marker violet-99.',
            evidence: [
                message(scattered, scattered.necessaryMessageIds[0] ?? ''),
            ],
            expected: 'unknown',
        },
        {
            id: 'claim-unknown-thirty-days',
            claim: 'Alex recommends keeping the audit export for thirty days.',
            evidence: [
                message(speaker, speaker.distractingMessageIds[0] ?? ''),
            ],
            expected: 'unknown',
        },
    ];
};

const claimState = (fixture: ClaimEvidenceFixture): JsonValue => ({
    claim: fixture.claim,
    evidence: fixture.evidence.map((message) => ({
        id: message.id,
        author: message.authorId,
        text: message.text,
    })),
    source: 'synthetic #717 fixture; claim labels stay local to the benchmark',
});

const claimQuestions: Record<string, JevQuestion> = {
    supported: {
        type: 'noul',
        instructions: 'Does the supplied evidence support the claim?',
        criteria: {
            true: 'The evidence entails or directly supports the claim.',
            false: 'The evidence contradicts the claim or is insufficient to support it.',
        },
    },
};

const average = (values: number[]): number | null =>
    values.length === 0
        ? null
        : values.reduce((sum, value) => sum + value, 0) / values.length;

const percentile = (
    values: number[],
    percentileValue: number
): number | null => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    return (
        sorted[
            Math.min(
                sorted.length - 1,
                Math.ceil((percentileValue / 100) * sorted.length) - 1
            )
        ] ?? null
    );
};

const summarizeUsage = (
    records: Array<{
        usage?: JevApiResponse['usage'];
        latencyMs: number | null;
    }>
): UsageSummary => {
    const completed = records.filter((record) => record.usage !== undefined);
    const latencies = records
        .map((record) => record.latencyMs)
        .filter((latency): latency is number => latency !== null);
    const costs = completed
        .map((record) => record.usage?.cost)
        .filter((cost): cost is number => cost !== undefined);
    return {
        calls: completed.length,
        inputTokens: completed.reduce(
            (sum, record) => sum + (record.usage?.input_tokens ?? 0),
            0
        ),
        outputTokens: completed.reduce(
            (sum, record) => sum + (record.usage?.output_tokens ?? 0),
            0
        ),
        reportedCostUsd:
            costs.length === 0
                ? null
                : costs.reduce((sum, cost) => sum + cost, 0),
        p50LatencyMs: percentile(latencies, 50),
        p95LatencyMs: percentile(latencies, 95),
    };
};

const resolveClientOptions = (): JevClientOptions | null => {
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const typeSafeKey = process.env.TYPESAFE_API_KEY;
    if (openRouterKey) {
        return {
            apiKey: openRouterKey,
            provider: 'openrouter',
            model: process.env.JEV_MODEL ?? 'typesafe/jev-1.13',
            timeoutMs: Number(process.env.JEV_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
        };
    }
    if (typeSafeKey) {
        return {
            apiKey: typeSafeKey,
            provider: 'typesafe',
            model: process.env.JEV_MODEL ?? 'jev-latest',
            timeoutMs: Number(process.env.JEV_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
        };
    }
    return null;
};

const runConcurrent = async <T>(
    items: readonly T[],
    concurrency: number,
    run: (item: T) => Promise<void>
): Promise<void> => {
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            const item = items[index];
            if (item !== undefined) await run(item);
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, worker)
    );
};

const buildThresholdSummary = (
    threshold: number,
    cases: JevCaseRecord[]
): ThresholdSummary => {
    const completed = cases.filter((record) => record.status === 'completed');
    const metrics = completed.map((record) => record.metric);
    const aggregate = aggregateMetrics(
        'jev',
        metrics.length > 0
            ? metrics
            : [
                  buildCaseMetric(
                      buildBenchmarkCorpus()[0]!,
                      unavailableSelection(
                          buildBenchmarkCorpus()[0]!,
                          'no completed cases'
                      )
                  ),
              ]
    );
    const probabilities = completed.flatMap((record) =>
        Object.values(record.candidateProbabilities)
    );
    const byCategory = Object.fromEntries(
        [...new Set(cases.map((record) => record.category))].map((category) => [
            category,
            average(
                completed
                    .filter((record) => record.category === category)
                    .flatMap((record) =>
                        Object.values(record.candidateProbabilities)
                    )
            ),
        ])
    );
    return {
        threshold,
        completedCases: completed.length,
        unavailableCases: cases.filter(
            (record) => record.status === 'unavailable'
        ).length,
        errorCases: cases.filter((record) => record.status === 'error').length,
        abstainedCases: completed.filter(
            (record) => record.selection.messageIds.length === 0
        ).length,
        necessaryMessageRecall: aggregate.necessaryMessageRecall,
        usefulContextPrecision: aggregate.usefulContextPrecision,
        distractingContextRate: aggregate.distractingContextRate,
        averageSelectedMessages: aggregate.averageFinalMessageCount,
        averageContextUnits: aggregate.averageEstimatedInputTokens,
        p50LatencyMs: aggregate.p50LatencyMs,
        p95LatencyMs: aggregate.p95LatencyMs,
        meanCandidateProbability: average(probabilities),
        candidateProbabilityByCategory: byCategory,
    };
};

/** Runs the observe-only Jev benchmark with explicit fail-open handling for unavailable hosted access. */
export const runJevBenchmark = async (
    options: {
        corpus?: ContextBenchmarkCase[];
        client?: JevClientOptions | null;
        caseLimit?: number;
        concurrency?: number;
    } = {}
): Promise<JevBenchmarkReport> => {
    const corpus = (options.corpus ?? buildBenchmarkCorpus()).slice(
        0,
        options.caseLimit ?? 100
    );
    const client =
        options.client === undefined ? resolveClientOptions() : options.client;
    const baseline = corpus.map((entry) => ({
        current: buildCaseMetric(entry, selectContext('current_window', entry)),
        bm25Graph: buildCaseMetric(
            entry,
            selectContextAtBudget(
                'bm25_graph_expansion',
                entry,
                CONTEXT_CANDIDATE_BUDGET
            )
        ),
    }));
    const currentMetrics = baseline.map((record) => record.current);
    const bm25GraphMetrics = baseline.map((record) => record.bm25Graph);
    const records = new Map<string, JevCaseRecord>();
    const thresholds = [...THRESHOLDS];

    if (client) {
        await runConcurrent(corpus, options.concurrency ?? 4, async (entry) => {
            const candidateIds = new Set(
                selectContextAtBudget(
                    'bm25_graph_expansion',
                    entry,
                    CONTEXT_CANDIDATE_BUDGET
                ).messageIds
            );
            const candidates = entry.messages.filter((message) =>
                candidateIds.has(message.id)
            );
            try {
                const call = await callJev(
                    contextState(entry, candidates),
                    contextQuestions(candidates),
                    client
                );
                for (const threshold of thresholds) {
                    const judged = jevSelection(
                        entry,
                        candidates,
                        call,
                        threshold
                    );
                    const metric = buildCaseMetric(entry, judged.selection);
                    records.set(`${entry.id}:${threshold}`, {
                        caseId: entry.id,
                        category: entry.category,
                        status: 'completed',
                        threshold,
                        selection: judged.selection,
                        metric,
                        candidateProbabilities: judged.probabilities,
                        ...(judged.score === undefined
                            ? {}
                            : { score: judged.score }),
                        model: call.response.model,
                        ...(call.response.provider === undefined
                            ? {}
                            : { provider: call.response.provider }),
                        usage: call.response.usage,
                        latencyMs: call.latencyMs,
                    });
                }
            } catch (error) {
                for (const threshold of thresholds) {
                    const selection = unavailableSelection(
                        entry,
                        errorText(error)
                    );
                    records.set(`${entry.id}:${threshold}`, {
                        caseId: entry.id,
                        category: entry.category,
                        status: errorText(error).includes('HTTP 401')
                            ? 'unavailable'
                            : 'error',
                        threshold,
                        selection,
                        metric: buildCaseMetric(entry, selection),
                        candidateProbabilities: {},
                        latencyMs: null,
                        error: errorText(error),
                    });
                }
            }
        });
    }

    const claimRecords: ClaimEvidenceRecord[] = [];
    const fixtures = buildClaimEvidenceFixtures(
        corpus.length === 100 ? corpus : buildBenchmarkCorpus()
    );
    if (client) {
        await runConcurrent(
            fixtures,
            options.concurrency ?? 4,
            async (fixture) => {
                try {
                    const call = await callJev(
                        claimState(fixture),
                        claimQuestions,
                        client
                    );
                    const answer = call.response.answers.supported;
                    if (answer?.type !== 'noul')
                        throw new Error('Missing claim support probability.');
                    const predictedSupported = answer.noul >= 0.5;
                    claimRecords.push({
                        id: fixture.id,
                        expected: fixture.expected,
                        status: 'completed',
                        probability: answer.noul,
                        predictedSupported,
                        correct:
                            predictedSupported ===
                            (fixture.expected === 'supported'),
                        model: call.response.model,
                        ...(call.response.provider === undefined
                            ? {}
                            : { provider: call.response.provider }),
                        usage: call.response.usage,
                        latencyMs: call.latencyMs,
                    });
                } catch (error) {
                    claimRecords.push({
                        id: fixture.id,
                        expected: fixture.expected,
                        status: 'error',
                        probability: null,
                        predictedSupported: null,
                        correct: null,
                        latencyMs: null,
                        error: errorText(error),
                    });
                }
            }
        );
    }

    const orderedCases = thresholds.flatMap((threshold) =>
        corpus
            .map((entry) => records.get(`${entry.id}:${threshold}`))
            .filter((record): record is JevCaseRecord => record !== undefined)
    );
    const returnedModels = Object.fromEntries(
        [
            ...new Set(
                orderedCases
                    .map((record) => record.model)
                    .filter((model): model is string => model !== undefined)
            ),
        ].map((model) => [
            model,
            orderedCases.filter((record) => record.model === model).length /
                thresholds.length,
        ])
    );
    const completedClaimRecords = claimRecords.filter(
        (record) => record.status === 'completed'
    );
    const primaryContextRecords = corpus
        .map((entry) => records.get(`${entry.id}:0.5`))
        .filter((record): record is JevCaseRecord => record !== undefined);
    return {
        benchmark: {
            corpus: 'synthetic_structurally_faithful',
            caseCount: corpus.length,
            candidateBudget: CONTEXT_CANDIDATE_BUDGET,
            thresholds,
            requestedModel: client?.model ?? null,
            returnedModels,
            provider: client?.provider ?? null,
            status:
                client === null
                    ? 'blocked'
                    : orderedCases.some(
                            (record) => record.status === 'completed'
                        )
                      ? 'completed'
                      : 'partial',
            ...(client === null
                ? {
                      blockedReason:
                          'No TYPESAFE_API_KEY or OPENROUTER_API_KEY was available.',
                  }
                : {}),
            limitations: [
                'All fixtures are synthetic and labels never enter the Jev state.',
                'The candidate set is BM25 plus bounded deterministic graph expansion; Jev is measured as a pruning judgment, not a standalone selector.',
                'Thresholds 0.5, 0.7, and 0.8 are predeclared exploratory replay points, not tuned operating points.',
                'Noul returns a probability and has no separate confidence field; score confidence is reported only for the shared sufficiency question.',
                'No local Jev weights or compatible derivative were used.',
                'Results are advisory and fail open; this script does not change routing, policy, context defaults, TRACE, provenance, or workflow behavior.',
            ],
        },
        baselines: {
            currentWindow: aggregateMetrics('current_window', currentMetrics),
            bm25Graph: aggregateMetrics(
                'bm25_graph_expansion',
                bm25GraphMetrics
            ),
            frozenGenericHosted: {
                source: 'Frozen #722/#739 generic hosted semantic-selector run on the same synthetic corpus.',
                necessaryMessageRecall: 0.991,
                usefulContextPrecision: 0.886,
                averageSelectedMessages: 1.75,
                averageContextUnits: 30.4,
                averageLatencyMs: 7070,
                reportedCostUsd: 0.062784,
                label: 'generic_hosted_selector',
            },
        },
        usage: {
            context: summarizeUsage(primaryContextRecords),
            claimEvidence: summarizeUsage(claimRecords),
        },
        thresholds: thresholds.map((threshold) =>
            buildThresholdSummary(
                threshold,
                corpus
                    .map((entry) => records.get(`${entry.id}:${threshold}`))
                    .filter(
                        (record): record is JevCaseRecord =>
                            record !== undefined
                    )
            )
        ),
        contextCases: orderedCases,
        claimEvidence: {
            fixtureCount: fixtures.length,
            records: claimRecords,
            accuracy: average(
                completedClaimRecords.map((record) => (record.correct ? 1 : 0))
            ),
            averageProbability: average(
                completedClaimRecords.map((record) => record.probability ?? 0)
            ),
        },
    };
};

const format = (value: number | null): string =>
    value === null ? 'n/a' : value.toFixed(3);

const writeReport = (report: JevBenchmarkReport): void => {
    const directory = path.resolve('artifacts/jev-context-benchmark-717');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
        path.join(directory, 'results.json'),
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8'
    );
    const lines = [
        '# Jev/System One context benchmark',
        '',
        `Status: ${report.benchmark.status}`,
        `Corpus: ${report.benchmark.caseCount} synthetic cases from #717; candidate budget ${report.benchmark.candidateBudget}`,
        `Provider: ${report.benchmark.provider ?? 'unavailable'}`,
        `Requested model: ${report.benchmark.requestedModel ?? 'unavailable'}`,
        `Returned models: ${Object.keys(report.benchmark.returnedModels).join(', ') || 'unavailable'}`,
        `Context calls: ${report.usage.context.calls}; input tokens ${report.usage.context.inputTokens}; output tokens ${report.usage.context.outputTokens}; reported cost ${report.usage.context.reportedCostUsd === null ? 'n/a' : `$${report.usage.context.reportedCostUsd.toFixed(6)}`}`,
        `Claim/evidence calls: ${report.usage.claimEvidence.calls}; input tokens ${report.usage.claimEvidence.inputTokens}; output tokens ${report.usage.claimEvidence.outputTokens}; reported cost ${report.usage.claimEvidence.reportedCostUsd === null ? 'n/a' : `$${report.usage.claimEvidence.reportedCostUsd.toFixed(6)}`}`,
        '',
        '| Method | Required recall | Useful precision | Distracting rate | Avg messages | Avg context units | p50 ms | p95 ms |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        `| current window | ${format(report.baselines.currentWindow.necessaryMessageRecall)} | ${format(report.baselines.currentWindow.usefulContextPrecision)} | ${format(report.baselines.currentWindow.distractingContextRate)} | ${format(report.baselines.currentWindow.averageFinalMessageCount)} | ${format(report.baselines.currentWindow.averageEstimatedInputTokens)} | ${format(report.baselines.currentWindow.p50LatencyMs)} | ${format(report.baselines.currentWindow.p95LatencyMs)} |`,
        `| BM25 + bounded graph | ${format(report.baselines.bm25Graph.necessaryMessageRecall)} | ${format(report.baselines.bm25Graph.usefulContextPrecision)} | ${format(report.baselines.bm25Graph.distractingContextRate)} | ${format(report.baselines.bm25Graph.averageFinalMessageCount)} | ${format(report.baselines.bm25Graph.averageEstimatedInputTokens)} | ${format(report.baselines.bm25Graph.p50LatencyMs)} | ${format(report.baselines.bm25Graph.p95LatencyMs)} |`,
        `| frozen generic hosted selector | ${report.baselines.frozenGenericHosted.necessaryMessageRecall.toFixed(3)} | ${report.baselines.frozenGenericHosted.usefulContextPrecision.toFixed(3)} | n/a | ${report.baselines.frozenGenericHosted.averageSelectedMessages.toFixed(2)} | ${report.baselines.frozenGenericHosted.averageContextUnits.toFixed(1)} | n/a | ${report.baselines.frozenGenericHosted.averageLatencyMs.toFixed(0)} |`,
        ...report.thresholds.map(
            (summary) =>
                `| Jev at ${summary.threshold.toFixed(1)} | ${format(summary.necessaryMessageRecall)} | ${format(summary.usefulContextPrecision)} | ${format(summary.distractingContextRate)} | ${format(summary.averageSelectedMessages)} | ${format(summary.averageContextUnits)} | ${format(summary.p50LatencyMs)} | ${format(summary.p95LatencyMs)} |`
        ),
        '',
        '## Claim/evidence workload',
        '',
        `Fixtures: ${report.claimEvidence.fixtureCount}; completed accuracy: ${format(report.claimEvidence.accuracy)}; average support probability: ${format(report.claimEvidence.averageProbability)}.`,
        '',
        '## Interpretation',
        '',
        '- This benchmark tests direct Jev/System One typed judgments. It does not call OpenJEV. The earlier generic hosted semantic selector is not Jev and appears only as a frozen comparison row.',
        '- The primary Jev formulation asks one Noul relevance question per candidate plus one shared Score sufficiency question in a single request.',
        '- The strongest cheap baseline remains BM25 plus bounded deterministic graph expansion. A permanent judgment seam is justified only if the recorded Jev run shows a repeatable advantage on weak lexical references, distractor pruning, downstream answer quality, or cost-normalized latency.',
        '- Any hosted execution missing from this report is an external access failure, not a zero score.',
        '',
        '## Current API facts',
        '',
        '- The official TypeScript SDK is [`@typesafe-ai/sdk`](https://github.com/typesafe-ai/typesafe-sdk-js); it supports typed `choice`, `score`, and `noul` questions, per-call timeout, retry, and `AbortSignal` cancellation.',
        '- The direct API is `POST https://api.typesafe.ai/v1/systemone`; OpenRouter exposes Jev through `POST https://openrouter.ai/api/alpha/decisions` with model `typesafe/jev-1.13`.',
        '- The official API returns the requested or served model and input/output usage. Choice and Score include probabilities and confidence; Noul returns only a yes probability.',
        '- The pinned OpenRouter price used for the comparison is $0.042 per million input tokens with free output. Recheck provider pricing before any future run.',
        '',
        '## Reproduction',
        '',
        '```text',
        'pnpm eval:jev-context',
        'pnpm eval:jev-context -- --limit 20',
        '```',
        '',
        'The command reads `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY` without printing it. Without either key it writes a blocked report and does not make a network request.',
    ];
    fs.writeFileSync(
        path.join(directory, 'summary.md'),
        `${lines.join('\n')}\n`,
        'utf8'
    );
};

const parseLimit = (): number => {
    const argumentIndex = process.argv.indexOf('--limit');
    if (argumentIndex < 0) return 100;
    const value = Number(process.argv[argumentIndex + 1]);
    if (!Number.isInteger(value) || value <= 0)
        throw new Error('--limit must be a positive integer.');
    return value;
};

if (
    process.env.NODE_TEST_CONTEXT === undefined &&
    process.argv[1]?.endsWith('jev-context-benchmark.ts')
) {
    runJevBenchmark({ caseLimit: parseLimit() })
        .then((report) => {
            writeReport(report);
            console.log(
                JSON.stringify(
                    {
                        status: report.benchmark.status,
                        provider: report.benchmark.provider,
                        model: report.benchmark.requestedModel,
                        cases: report.benchmark.caseCount,
                        thresholds: report.thresholds,
                        claimEvidence: report.claimEvidence,
                    },
                    null,
                    2
                )
            );
        })
        .catch((error: unknown) => {
            console.error(errorText(error));
            process.exitCode = 1;
        });
}
