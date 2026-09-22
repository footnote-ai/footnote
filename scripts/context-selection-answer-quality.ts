/**
 * @description: Measures bounded downstream answer support from selected context packs.
 * It intentionally does not call a generator when no approved local/provider path is available.
 * @footnote-scope: utility
 * @footnote-module: ContextSelectionAnswerQuality
 * @footnote-risk: medium - A support proxy could be mistaken for end-to-end answer quality.
 * @footnote-ethics: high - Synthetic facts keep private conversation content out of evaluation artifacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
    buildBenchmarkCorpus,
    selectContext,
    type ContextBenchmarkCase,
    type ContextSelectionMethod,
} from './context-selection-benchmark.js';

type BenchmarkCategory = ContextBenchmarkCase['category'];

export type AnswerQualityMethod = Extract<
    ContextSelectionMethod,
    'current_window' | 'bm25' | 'bm25_graph_expansion'
>;

export type AnswerQualityCaseMetric = {
    caseId: string;
    category: BenchmarkCategory;
    method: AnswerQualityMethod;
    answerCorrect: boolean;
    referenceResolved: boolean;
    distractingMessageCount: number;
    contextWasConfusing: boolean;
    selectedMessageCount: number;
    estimatedContextTokens: number;
    retrievalLatencyMs: number | null;
    generationStatus: 'not_run';
    generationLatencyMs: null;
    generationCostUsd: null;
};

export type AnswerQualityMethodMetric = {
    method: AnswerQualityMethod;
    caseCount: number;
    answerCorrectnessRate: number;
    referenceResolutionRate: number;
    contextConfusionRate: number;
    averageDistractingMessageCount: number;
    averageSelectedMessageCount: number;
    averageContextTokens: number;
    retrievalP95LatencyMs: number | null;
    generationP95LatencyMs: null;
    generationCostUsd: null;
};

export type AnswerQualityReport = {
    benchmark: {
        issue: 717;
        evaluation: 'deterministic_context_support_proxy';
        subsetCaseCount: number;
        generationStatus: 'not_run';
        limitations: string[];
    };
    methods: AnswerQualityMethodMetric[];
    cases: AnswerQualityCaseMetric[];
};

const METHODS: AnswerQualityMethod[] = [
    'current_window',
    'bm25',
    'bm25_graph_expansion',
];

const CATEGORIES: BenchmarkCategory[] = [
    'trigger_only',
    'immediate_predecessor',
    'several_turns_back',
    'old_relevant_history',
    'reply_ancestry',
    'one_relevant_branch',
    'simultaneous_conversations',
    'topic_switch',
    'pronoun_reference',
    'same_author_continuation',
    'paraphrased_reference',
    'scattered_context',
    'irrelevant_high_similarity',
    'historical_context_not_recovered',
];

const REFERENCE_FACTS: Record<BenchmarkCategory, readonly string[][]> = {
    trigger_only: [],
    immediate_predecessor: [['database', 'url'], ['staging']],
    several_turns_back: [['canary'], ['ten', 'minutes']],
    old_relevant_history: [['amber-17']],
    reply_ancestry: [['seven', 'days']],
    one_relevant_branch: [['invoice', 'hash']],
    simultaneous_conversations: [['hmac-42'], ['troubleshooting']],
    topic_switch: [
        ['cache', 'invalidation'],
        ['image', 'worker'],
    ],
    pronoun_reference: [['blue-green'], ['amber']],
    same_author_continuation: [['assessor'], ['generator']],
    paraphrased_reference: [['amber-17'], ['prior', 'release']],
    scattered_context: [['signed', 'manifest'], ['lockfile']],
    irrelevant_high_similarity: [['canonical', 'trace']],
    historical_context_not_recovered: [['fresh', 'owner', 'assignment']],
};

const TOKEN_ESTIMATE_DIVISOR = 4;

const tokenize = (value: string): string[] =>
    value.toLocaleLowerCase('en-US').match(/[a-z0-9-]+/g) ?? [];

const average = (values: number[]): number =>
    values.reduce((total, value) => total + value, 0) /
    Math.max(1, values.length);

const percentile = (
    values: number[],
    percentileValue: number
): number | null => {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
    );
    return sorted[index] ?? null;
};

const factsSupportedByContext = (
    facts: readonly string[][],
    selectedTexts: readonly string[]
): boolean =>
    facts.every((fact) =>
        selectedTexts.some((text) => {
            const tokens = new Set(tokenize(text));
            return fact.every((token) => tokens.has(token));
        })
    );

const estimateContextTokens = (
    entry: ContextBenchmarkCase,
    selectedIds: readonly string[]
): number => {
    const selected = new Set(selectedIds);
    const selectedCharacters = entry.messages
        .filter((message) => selected.has(message.id))
        .reduce((total, message) => total + message.text.length, 0);
    return Math.ceil(selectedCharacters / TOKEN_ESTIMATE_DIVISOR);
};

/**
 * Builds one bounded synthetic representative for each corpus category.
 * The subset is fixed by category so method comparisons use identical cases.
 */
export const buildAnswerQualitySubset = (): ContextBenchmarkCase[] => {
    const corpus = buildBenchmarkCorpus();
    return CATEGORIES.map((category) => {
        const entry = corpus.find(
            (candidate) => candidate.category === category
        );
        if (entry === undefined) {
            throw new Error(`Missing answer-quality category: ${category}`);
        }
        return entry;
    });
};

const evaluateCase = (
    entry: ContextBenchmarkCase,
    method: AnswerQualityMethod
): AnswerQualityCaseMetric => {
    const selectionStartedAt = performance.now();
    const result = selectContext(method, entry);
    const retrievalLatencyMs =
        result.latencyMs ?? performance.now() - selectionStartedAt;
    const selected = new Set(result.messageIds);
    const selectedTexts = entry.messages
        .filter((message) => selected.has(message.id))
        .map((message) => message.text);
    const distractingMessageCount = entry.distractingMessageIds.filter(
        (messageId) => selected.has(messageId)
    ).length;
    const answerCorrect = factsSupportedByContext(
        REFERENCE_FACTS[entry.category],
        selectedTexts
    );
    const referenceResolved = entry.necessaryMessageIds.every((messageId) =>
        selected.has(messageId)
    );

    return {
        caseId: entry.id,
        category: entry.category,
        method,
        answerCorrect,
        referenceResolved,
        distractingMessageCount,
        contextWasConfusing: !answerCorrect && distractingMessageCount > 0,
        selectedMessageCount: selected.size,
        estimatedContextTokens: estimateContextTokens(entry, result.messageIds),
        retrievalLatencyMs,
        generationStatus: 'not_run',
        generationLatencyMs: null,
        generationCostUsd: null,
    };
};

const aggregateMethod = (
    method: AnswerQualityMethod,
    cases: AnswerQualityCaseMetric[]
): AnswerQualityMethodMetric => {
    const latencyValues = cases
        .map((metric) => metric.retrievalLatencyMs)
        .filter((value): value is number => value !== null);
    return {
        method,
        caseCount: cases.length,
        answerCorrectnessRate: average(
            cases.map((metric) => (metric.answerCorrect ? 1 : 0))
        ),
        referenceResolutionRate: average(
            cases.map((metric) => (metric.referenceResolved ? 1 : 0))
        ),
        contextConfusionRate: average(
            cases.map((metric) => (metric.contextWasConfusing ? 1 : 0))
        ),
        averageDistractingMessageCount: average(
            cases.map((metric) => metric.distractingMessageCount)
        ),
        averageSelectedMessageCount: average(
            cases.map((metric) => metric.selectedMessageCount)
        ),
        averageContextTokens: average(
            cases.map((metric) => metric.estimatedContextTokens)
        ),
        retrievalP95LatencyMs: percentile(latencyValues, 95),
        generationP95LatencyMs: null,
        generationCostUsd: null,
    };
};

/**
 * Compares context packs with a deterministic answer-support proxy.
 * Generation is deliberately not attempted without an approved local/provider path.
 */
export const runAnswerQualityEvaluation = (
    subset: ContextBenchmarkCase[] = buildAnswerQualitySubset()
): AnswerQualityReport => {
    const cases = METHODS.flatMap((method) =>
        subset.map((entry) => evaluateCase(entry, method))
    );
    return {
        benchmark: {
            issue: 717,
            evaluation: 'deterministic_context_support_proxy',
            subsetCaseCount: subset.length,
            generationStatus: 'not_run',
            limitations: [
                'This is a deterministic context-support proxy, not a generated answer evaluation.',
                'Reference facts are synthetic and hand-authored by category.',
                'No generation latency, provider usage, or cost was observed because generation was not run.',
                'The proxy must be replaced or supplemented by blinded downstream generation and human scoring.',
            ],
        },
        methods: METHODS.map((method) =>
            aggregateMethod(
                method,
                cases.filter((metric) => metric.method === method)
            )
        ),
        cases,
    };
};

const writeReport = (report: AnswerQualityReport): void => {
    const outputDirectory = path.resolve('artifacts/context-selection-717');
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(
        path.join(outputDirectory, 'answer-quality.json'),
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8'
    );
    const format = (value: number | null): string =>
        value === null ? 'n/a' : value.toFixed(3);
    const summary = [
        '# Context-selection downstream support evaluation #717',
        '',
        'This is a deterministic context-support proxy; no final answer generation was run.',
        '',
        '| Method | Answer correctness | Reference resolution | Confusion rate | Avg messages | Avg tokens | Retrieval p95 ms |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...report.methods.map(
            (metric) =>
                `| ${metric.method} | ${format(metric.answerCorrectnessRate)} | ${format(metric.referenceResolutionRate)} | ${format(metric.contextConfusionRate)} | ${format(metric.averageSelectedMessageCount)} | ${format(metric.averageContextTokens)} | ${format(metric.retrievalP95LatencyMs)} |`
        ),
        '',
        'Generation latency and cost are `n/a`; provider-path evidence is intentionally not invented.',
    ].join('\n');
    fs.writeFileSync(
        path.join(outputDirectory, 'answer-quality-summary.md'),
        `${summary}\n`,
        'utf8'
    );
};

if (process.argv[1]?.endsWith('context-selection-answer-quality.ts')) {
    const report = runAnswerQualityEvaluation();
    writeReport(report);
    console.log(JSON.stringify(report.methods, null, 2));
}
