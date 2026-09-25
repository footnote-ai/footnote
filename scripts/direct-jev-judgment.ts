/**
 * @description: Runs an observe-only Jev/System-One judgment benchmark against
 * the frozen context corpus and one bounded claim-support workload.
 * @footnote-scope: test
 * @footnote-module: DirectJevJudgmentBenchmark
 * @footnote-risk: medium - Provider or metric drift could misstate evaluation evidence.
 * @footnote-ethics: high - Synthetic fixtures keep private conversation and source content out of the run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
    buildBenchmarkCorpus,
    type ContextBenchmarkCase,
} from './context-selection-benchmark.js';

type JsonObject = Record<string, unknown>;

type JevQuestion = {
    type: 'noul';
    instructions: string;
};

type JevRequest = {
    model: string;
    state: unknown;
    questions: Record<string, JevQuestion>;
};

type JevAnswer = {
    noul?: number;
};

type JevResponse = {
    model?: string;
    provider?: string;
    answers?: Record<string, JevAnswer>;
    usage?: JsonObject;
};

type ClaimSupportCase = {
    id: string;
    claim: string;
    evidence: string;
    supported: boolean;
};

export type JudgmentMetric = {
    caseId: string;
    score: number | null;
    predicted: boolean | null;
    expected: boolean;
    latencyMs: number | null;
    error?: string;
};

export type JudgmentSummary = {
    completedCases: number;
    failedCases: number;
    accuracy: number | null;
    averageScore: number | null;
    abstainRateAtHalf: number | null;
    averageLatencyMs: number | null;
};

type BenchmarkRun = {
    name: string;
    summary: JudgmentSummary;
    metrics: JudgmentMetric[];
};

export type ContextMetric = {
    caseId: string;
    category: ContextBenchmarkCase['category'];
    necessaryRecoveredCount: number;
    necessaryCount: number;
    usefulSelectedCount: number;
    distractingSelectedCount: number;
    necessaryRecall: number | null;
    usefulPrecision: number | null;
    distractingRate: number | null;
    selectedCount: number;
    averageScore: number | null;
    nearThresholdRate: number | null;
    latencyMs: number | null;
    error?: string;
};

type ContextSummary = {
    completedCases: number;
    failedCases: number;
    necessaryRecall: number | null;
    usefulPrecision: number | null;
    distractingRate: number | null;
    averageSelectedCount: number | null;
    averageScore: number | null;
    nearThresholdRate: number | null;
    averageLatencyMs: number | null;
};

type ContextRun = {
    name: string;
    summary: ContextSummary;
    metrics: ContextMetric[];
};

type FrozenMethod = {
    method: string;
    necessaryMessageRecall: number | null;
    usefulContextPrecision: number | null;
    distractingContextRate: number | null;
    averageFinalMessageCount: number | null;
    averageEstimatedInputTokens: number | null;
    p95LatencyMs: number | null;
};

type FrozenResults = {
    methods: FrozenMethod[];
};

type RunMetadata = {
    endpoint: string | null;
    model: string | null;
    resolvedModel: string | null;
    provider: string | null;
    usage: JsonObject[];
    blockedReason?: string;
};

const outputDirectory = path.resolve('artifacts/direct-jev-judgment-741');
const threshold = 0.5;

const isObject = (value: unknown): value is JsonObject =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const asNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

const parseResponse = (value: unknown): JevResponse => {
    if (!isObject(value)) {
        throw new Error('Jev response was not an object');
    }
    const answersValue = value.answers;
    const answers: Record<string, JevAnswer> = {};
    if (isObject(answersValue)) {
        for (const [key, answer] of Object.entries(answersValue)) {
            if (isObject(answer)) {
                answers[key] = { noul: asNumber(answer.noul) ?? undefined };
            }
        }
    }
    return {
        model: typeof value.model === 'string' ? value.model : undefined,
        provider:
            typeof value.provider === 'string' ? value.provider : undefined,
        answers,
        usage: isObject(value.usage) ? value.usage : undefined,
    };
};

const summarizeMetrics = (metrics: JudgmentMetric[]): JudgmentSummary => {
    const scores = metrics.flatMap((metric) =>
        metric.score === null ? [] : [metric.score]
    );
    const classified = metrics.filter(
        (metric) => metric.score !== null && metric.predicted !== null
    );
    const latency = metrics
        .map((metric) => metric.latencyMs)
        .filter((value): value is number => value !== null);
    return {
        completedCases: scores.length,
        failedCases: metrics.length - scores.length,
        accuracy:
            classified.length === 0
                ? null
                : classified.filter(
                      (metric) => metric.predicted === metric.expected
                  ).length / classified.length,
        averageScore:
            scores.length === 0
                ? null
                : scores.reduce((sum, score) => sum + score, 0) / scores.length,
        abstainRateAtHalf:
            metrics.length === 0
                ? null
                : metrics.filter(
                      (metric) =>
                          metric.score !== null &&
                          Math.abs(metric.score - threshold) < 0.1
                  ).length / metrics.length,
        averageLatencyMs:
            latency.length === 0
                ? null
                : latency.reduce((sum, value) => sum + value, 0) /
                  latency.length,
    };
};

const summarizeContextMetrics = (metrics: ContextMetric[]): ContextSummary => {
    const completed = metrics.filter((metric) => metric.error === undefined);
    const availableNecessary = completed.filter(
        (metric) => metric.necessaryRecall !== null
    );
    const availablePrecision = completed.filter(
        (metric) => metric.usefulPrecision !== null
    );
    const average = (values: number[]): number | null =>
        values.length === 0
            ? null
            : values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
        completedCases: completed.length,
        failedCases: metrics.length - completed.length,
        necessaryRecall:
            availableNecessary.length === 0
                ? null
                : availableNecessary.reduce(
                      (sum, metric) => sum + metric.necessaryRecoveredCount,
                      0
                  ) /
                  availableNecessary.reduce(
                      (sum, metric) => sum + metric.necessaryCount,
                      0
                  ),
        usefulPrecision:
            availablePrecision.length === 0
                ? null
                : availablePrecision.reduce(
                      (sum, metric) => sum + metric.usefulSelectedCount,
                      0
                  ) /
                  availablePrecision.reduce(
                      (sum, metric) => sum + metric.selectedCount,
                      0
                  ),
        distractingRate: average(
            completed.flatMap((metric) =>
                metric.distractingRate === null ? [] : [metric.distractingRate]
            )
        ),
        averageSelectedCount: average(
            completed.map((metric) => metric.selectedCount)
        ),
        averageScore: average(
            completed.flatMap((metric) =>
                metric.averageScore === null ? [] : [metric.averageScore]
            )
        ),
        nearThresholdRate: average(
            completed.flatMap((metric) =>
                metric.nearThresholdRate === null
                    ? []
                    : [metric.nearThresholdRate]
            )
        ),
        averageLatencyMs: average(
            completed.flatMap((metric) =>
                metric.latencyMs === null ? [] : [metric.latencyMs]
            )
        ),
    };
};

const getCredentials = (): {
    apiKey: string | undefined;
    endpoint: string | null;
    model: string | null;
} => {
    const typesafeKey = process.env.TYPESAFE_API_KEY?.trim();
    if (typesafeKey) {
        return {
            apiKey: typesafeKey,
            endpoint: 'https://api.typesafe.ai/v1/systemone',
            model: 'jev-1.13.0',
        };
    }
    const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
    return {
        apiKey: openRouterKey,
        endpoint: openRouterKey
            ? 'https://openrouter.ai/api/alpha/decisions'
            : null,
        model: openRouterKey ? 'typesafe/jev-1.13' : null,
    };
};

const requestJev = async (
    request: JevRequest,
    apiKey: string,
    endpoint: string
): Promise<JevResponse> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(request),
            signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
            throw new Error(`Jev request failed with HTTP ${response.status}`);
        }
        return parseResponse(payload);
    } finally {
        clearTimeout(timeout);
    }
};

const buildContextRequest = (
    benchmarkCase: ContextBenchmarkCase,
    model: string
): JevRequest => ({
    model,
    state: {
        latestUserInput: benchmarkCase.latestUserInput,
        messages: benchmarkCase.messages.map((message) => ({
            id: message.id,
            authorId: message.authorId,
            role: message.role,
            text: message.text,
            replyToId: message.replyToId,
        })),
    },
    questions: Object.fromEntries(
        benchmarkCase.messages.map((message, index) => [
            `message_${message.id}`,
            {
                type: 'noul',
                instructions: `Does messages[${index}] contain information necessary to answer latestUserInput? Judge the message text, not its position or author.`,
            },
        ])
    ),
});

const buildClaimRequest = (
    benchmarkCase: ClaimSupportCase,
    model: string
): JevRequest => ({
    model,
    state: {
        claim: benchmarkCase.claim,
        evidence: benchmarkCase.evidence,
    },
    questions: {
        claim_supported: {
            type: 'noul',
            instructions:
                'Does evidence support the claim? Treat the evidence as the only source of truth and do not add outside facts.',
        },
    },
});

/**
 * Scores one frozen case using the fixed exploratory threshold; this remains
 * evidence only and never grants routing or policy authority.
 */
export const scoreContextCase = (
    benchmarkCase: ContextBenchmarkCase,
    scores: Record<string, number>,
    latencyMs: number
): ContextMetric => {
    const selectedIds = benchmarkCase.messages
        .filter((message) => (scores[message.id] ?? 0) >= threshold)
        .map((message) => message.id);
    const necessary = new Set(benchmarkCase.necessaryMessageIds);
    const useful = new Set([
        ...benchmarkCase.necessaryMessageIds,
        ...benchmarkCase.usefulMessageIds,
    ]);
    const distracting = new Set(benchmarkCase.distractingMessageIds);
    const selectedNecessary = selectedIds.filter((id) => necessary.has(id));
    const selectedUseful = selectedIds.filter((id) => useful.has(id));
    const selectedDistracting = selectedIds.filter((id) => distracting.has(id));
    const knownScores = Object.values(scores);
    return {
        caseId: benchmarkCase.id,
        category: benchmarkCase.category,
        necessaryRecoveredCount: selectedNecessary.length,
        necessaryCount: necessary.size,
        usefulSelectedCount: selectedUseful.length,
        distractingSelectedCount: selectedDistracting.length,
        necessaryRecall:
            necessary.size === 0
                ? null
                : selectedNecessary.length / necessary.size,
        usefulPrecision:
            selectedIds.length === 0
                ? null
                : selectedUseful.length / selectedIds.length,
        distractingRate:
            selectedIds.length === 0
                ? 0
                : selectedDistracting.length / selectedIds.length,
        selectedCount: selectedIds.length,
        averageScore:
            knownScores.length === 0
                ? null
                : knownScores.reduce((sum, score) => sum + score, 0) /
                  knownScores.length,
        nearThresholdRate:
            knownScores.length === 0
                ? null
                : knownScores.filter(
                      (score) => Math.abs(score - threshold) < 0.1
                  ).length / knownScores.length,
        latencyMs,
    };
};

const evaluateContextCase = async (
    benchmarkCase: ContextBenchmarkCase,
    request: JevRequest,
    apiKey: string,
    endpoint: string,
    metadata: RunMetadata
): Promise<ContextMetric> => {
    const started = performance.now();
    try {
        const response = await requestJev(request, apiKey, endpoint);
        const scores: Record<string, number> = {};
        for (const message of benchmarkCase.messages) {
            const score = response.answers?.[`message_${message.id}`]?.noul;
            if (score === undefined) {
                throw new Error(`Missing Noul answer for ${message.id}`);
            }
            scores[message.id] = score;
        }
        metadata.resolvedModel ??= response.model ?? null;
        metadata.provider ??= response.provider ?? null;
        if (response.usage) {
            metadata.usage.push(response.usage);
        }
        return scoreContextCase(
            benchmarkCase,
            scores,
            performance.now() - started
        );
    } catch (error) {
        return {
            caseId: benchmarkCase.id,
            category: benchmarkCase.category,
            necessaryRecoveredCount: 0,
            necessaryCount: benchmarkCase.necessaryMessageIds.length,
            usefulSelectedCount: 0,
            distractingSelectedCount: 0,
            necessaryRecall: null,
            usefulPrecision: null,
            distractingRate: null,
            selectedCount: 0,
            averageScore: null,
            nearThresholdRate: null,
            latencyMs: null,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
};

const evaluateCase = async (
    caseId: string,
    expected: boolean,
    request: JevRequest,
    apiKey: string,
    endpoint: string,
    answerKey: string,
    metadata: RunMetadata
): Promise<JudgmentMetric> => {
    const started = performance.now();
    try {
        const response = await requestJev(request, apiKey, endpoint);
        const score = response.answers?.[answerKey]?.noul ?? null;
        if (score === null) {
            throw new Error(`Missing Noul answer for ${answerKey}`);
        }
        metadata.resolvedModel ??= response.model ?? null;
        metadata.provider ??= response.provider ?? null;
        if (response.usage) {
            metadata.usage.push(response.usage);
        }
        return {
            caseId,
            score,
            predicted: score >= threshold,
            expected,
            latencyMs: performance.now() - started,
        };
    } catch (error) {
        return {
            caseId,
            score: null,
            predicted: null,
            expected,
            latencyMs: null,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
};

const readFrozenMethods = (): FrozenMethod[] => {
    const file = path.resolve(
        'artifacts/direct-jev-judgment-741/frozen-baselines.json'
    );
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isObject(value) || !Array.isArray(value.methods)) {
        throw new Error('Frozen context-selection results are invalid');
    }
    return (value as FrozenResults).methods;
};

const formatNumber = (value: number | null): string =>
    value === null ? 'n/a' : value.toFixed(3);

const writeReport = (
    contextRun: ContextRun,
    claimRun: BenchmarkRun,
    metadata: RunMetadata,
    frozenMethods: FrozenMethod[]
): void => {
    fs.mkdirSync(outputDirectory, { recursive: true });
    const result = {
        generatedAt: new Date().toISOString(),
        threshold,
        metadata,
        frozenBaselines: frozenMethods.filter((method) =>
            ['current_window', 'bm25_graph_expansion'].includes(method.method)
        ),
        contextSelection: contextRun,
        claimSupport: claimRun,
    };
    const zeroRecallCategories = [
        ...new Set(
            contextRun.metrics
                .filter(
                    (metric) =>
                        metric.error === undefined &&
                        metric.necessaryRecall === 0
                )
                .map((metric) => metric.category)
        ),
    ];
    fs.writeFileSync(
        path.join(outputDirectory, 'results.json'),
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8'
    );
    const report = [
        '# Direct Jev judgment benchmark (#741)',
        '',
        `Generated: ${result.generatedAt}`,
        `Implementation: ${metadata.resolvedModel ?? metadata.model ?? 'n/a'} via ${metadata.provider ?? metadata.endpoint ?? 'n/a'}`,
        metadata.blockedReason
            ? `Hosted run: blocked (${metadata.blockedReason})`
            : 'Hosted run: completed',
        '',
        '## Context selection',
        '',
        '| Method | Necessary recall | Useful precision | Distracting rate | Avg messages | Avg input tokens | p95 ms |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...frozenMethods
            .filter((method) =>
                ['current_window', 'bm25_graph_expansion'].includes(
                    method.method
                )
            )
            .map(
                (method) =>
                    `| ${method.method} | ${formatNumber(method.necessaryMessageRecall)} | ${formatNumber(method.usefulContextPrecision)} | ${formatNumber(method.distractingContextRate)} | ${formatNumber(method.averageFinalMessageCount)} | ${formatNumber(method.averageEstimatedInputTokens)} | ${formatNumber(method.p95LatencyMs)} |`
            ),
        `| Jev Noul relevance | ${formatNumber(contextRun.summary.necessaryRecall)} | ${formatNumber(contextRun.summary.usefulPrecision)} | ${formatNumber(contextRun.summary.distractingRate)} | ${formatNumber(contextRun.summary.averageSelectedCount)} | n/a | ${formatNumber(contextRun.summary.averageLatencyMs)} |`,
        `- Jev context scores within 0.1 of the fixed 0.5 threshold: ${formatNumber(contextRun.summary.nearThresholdRate)}`,
        `- Context categories with zero necessary recall in this pass: ${zeroRecallCategories.length === 0 ? 'none' : zeroRecallCategories.join(', ')}`,
        '',
        '## Claim support',
        '',
        `- Cases: ${claimRun.summary.completedCases} completed, ${claimRun.summary.failedCases} failed`,
        `- Accuracy at fixed 0.5 threshold: ${formatNumber(claimRun.summary.accuracy)}`,
        `- Mean Noul score: ${formatNumber(claimRun.summary.averageScore)}`,
        `- Mean request latency: ${formatNumber(claimRun.summary.averageLatencyMs)} ms`,
        `- Reported input tokens: ${metadata.usage.reduce((sum, usage) => sum + (asNumber(usage.input_tokens) ?? asNumber(usage.inputTokens) ?? 0), 0)}`,
        `- Reported cost: $${metadata.usage.reduce((sum, usage) => sum + (asNumber(usage.cost) ?? 0), 0).toFixed(6)}`,
        '',
        '## Limits',
        '',
        '- The context corpus is synthetic and provider-neutral; it is not a production Discord estimate.',
        '- The Jev relevance row uses a fixed exploratory 0.5 threshold, not a threshold tuned on the evaluation cases.',
        '- This report is one pass per case; repeated hosted calls can vary even with the pinned returned model snapshot.',
        '- Noul scores are model probabilities, not Footnote policy confidence or authorization.',
        '- Results are observe-only. No runtime routing, context defaults, provenance, TRACE, or workflow behavior changed.',
        '- OpenRouter is the provider path when `OPENROUTER_API_KEY` is used; its routing and returned provider are part of this evidence.',
        '',
        '## Reproduction',
        '',
        '```text',
        'pnpm exec tsx scripts/direct-jev-judgment.ts',
        '```',
        '',
        'Official docs: [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript), [TypeSafe API reference](https://docs.typesafe.ai/api), [models](https://docs.typesafe.ai/models), and [model jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13).',
    ].join('\n');
    fs.writeFileSync(
        path.join(outputDirectory, 'summary.md'),
        `${report}\n`,
        'utf8'
    );
};

const run = async (): Promise<void> => {
    const credentials = getCredentials();
    const metadata: RunMetadata = {
        endpoint: credentials.endpoint,
        model: credentials.model,
        resolvedModel: null,
        provider: null,
        usage: [],
    };
    const contextCases = buildBenchmarkCorpus();
    const claims = JSON.parse(
        fs.readFileSync(
            path.resolve('scripts/fixtures/direct-jev-claim-support.json'),
            'utf8'
        )
    ) as ClaimSupportCase[];
    if (!credentials.apiKey || !credentials.endpoint || !credentials.model) {
        metadata.blockedReason =
            'Set TYPESAFE_API_KEY or OPENROUTER_API_KEY to run hosted Jev.';
        writeReport(
            {
                name: 'context_selection',
                summary: summarizeContextMetrics([]),
                metrics: [],
            },
            {
                name: 'claim_support',
                summary: summarizeMetrics([]),
                metrics: [],
            },
            metadata,
            readFrozenMethods()
        );
        return;
    }
    const limitArgument = process.argv.find((argument) =>
        argument.startsWith('--limit=')
    );
    const limit = limitArgument
        ? Number(limitArgument.slice('--limit='.length))
        : null;
    const selectedContextCases =
        limit !== null && Number.isFinite(limit)
            ? contextCases.slice(0, Math.max(0, limit))
            : contextCases;
    const contextMetrics: ContextMetric[] = [];
    for (const benchmarkCase of selectedContextCases) {
        const response = await evaluateContextCase(
            benchmarkCase,
            buildContextRequest(benchmarkCase, credentials.model),
            credentials.apiKey,
            credentials.endpoint,
            metadata
        );
        contextMetrics.push(response);
    }
    const claimMetrics: JudgmentMetric[] = [];
    for (const benchmarkCase of claims) {
        claimMetrics.push(
            await evaluateCase(
                benchmarkCase.id,
                benchmarkCase.supported,
                buildClaimRequest(benchmarkCase, credentials.model),
                credentials.apiKey,
                credentials.endpoint,
                'claim_supported',
                metadata
            )
        );
    }
    writeReport(
        {
            name: 'context_selection',
            summary: summarizeContextMetrics(contextMetrics),
            metrics: contextMetrics,
        },
        {
            name: 'claim_support',
            summary: summarizeMetrics(claimMetrics),
            metrics: claimMetrics,
        },
        metadata,
        readFrozenMethods()
    );
    console.log(
        JSON.stringify(
            {
                context: summarizeContextMetrics(contextMetrics),
                claimSupport: summarizeMetrics(claimMetrics),
                model: metadata.model,
                resolvedModel: metadata.resolvedModel,
                provider: metadata.provider,
            },
            null,
            2
        )
    );
};

if (process.argv[1]?.endsWith('direct-jev-judgment.ts')) {
    run().catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
    });
}
