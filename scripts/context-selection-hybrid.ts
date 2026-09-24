/**
 * @description: Evaluates small hybrid context selectors using frozen semantic scores.
 * @footnote-scope: test
 * @footnote-module: ContextSelectionHybrid
 * @footnote-risk: medium - Offline selector comparisons can misstate production value if score reuse or label leakage is wrong.
 * @footnote-ethics: high - Only synthetic fixtures and already-captured model scores are used.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import {
    buildBenchmarkCorpus,
    buildCaseMetric,
    selectContext,
    selectContextAtBudget,
    type CaseMetric,
    type ContextBenchmarkCase,
    type SelectionResult,
} from './context-selection-benchmark.js';
import {
    readHostedSelectionRecords,
    type HostedCandidateScore,
    type HostedSelectionRecord,
} from './context-selection-hosted.js';

export type HybridMethod =
    | 'bm25_graph_semantic_prune'
    | 'semantic_structural_closure'
    | 'semantic_plus_bm25_top3';

type ComparisonMethod =
    | 'current_window'
    | 'bm25_graph_expansion'
    | 'hosted_zero_shot'
    | HybridMethod;

export const HYBRID_METHODS: readonly HybridMethod[] = [
    'bm25_graph_semantic_prune',
    'semantic_structural_closure',
    'semantic_plus_bm25_top3',
];

const STRUCTURAL_CLOSURE_BUDGET = 15;
const CONSERVATIVE_BM25_SEED_COUNT = 3;

type FrozenSemanticScores = ReadonlyMap<string, HostedCandidateScore>;

export type HybridSelection = SelectionResult & {
    hybridMethod: ComparisonMethod;
    semanticCandidateCount: number;
    semanticLatencyMs: number | null;
};

const candidateScores = (record: HostedSelectionRecord): FrozenSemanticScores =>
    new Map(
        record.candidates.map((candidate) => [candidate.messageId, candidate])
    );

const orderedIds = (
    entry: ContextBenchmarkCase,
    ids: Iterable<string>,
    budget: number | null = null
): string[] => {
    const wanted = new Set(ids);
    return entry.messages
        .filter((message) => wanted.has(message.id))
        .slice(0, budget ?? entry.messages.length)
        .map((message) => message.id);
};

const frozenSemanticIds = (record: HostedSelectionRecord): string[] => [
    ...record.selection.messageIds,
];

const structuralNeighbors = (
    entry: ContextBenchmarkCase,
    seedIds: ReadonlySet<string>
): Set<string> => {
    const neighbors = new Set<string>();
    const byId = new Map(
        entry.messages.map((message, index) => [message.id, index])
    );

    for (const seedId of seedIds) {
        const index = byId.get(seedId);
        if (index === undefined) continue;
        const message = entry.messages[index];
        if (message === undefined) continue;

        if (message.replyToId !== undefined) neighbors.add(message.replyToId);
        for (const candidate of entry.messages) {
            if (candidate.replyToId === seedId) neighbors.add(candidate.id);
        }

        const predecessor = entry.messages[index - 1];
        const successor = entry.messages[index + 1];
        if (predecessor !== undefined) neighbors.add(predecessor.id);
        if (successor !== undefined) neighbors.add(successor.id);
        if (
            predecessor !== undefined &&
            predecessor.authorId === message.authorId
        ) {
            neighbors.add(predecessor.id);
        }
        if (
            successor !== undefined &&
            successor.authorId === message.authorId
        ) {
            neighbors.add(successor.id);
        }
    }

    if (entry.triggerReplyToId !== undefined) {
        neighbors.add(entry.triggerReplyToId);
    }
    return neighbors;
};

/** Adds only deterministic message relationships, never benchmark labels. */
export const expandStructuralClosure = (
    entry: ContextBenchmarkCase,
    seedIds: readonly string[],
    budget = STRUCTURAL_CLOSURE_BUDGET
): string[] => {
    const seeds = new Set(seedIds);
    const additions = structuralNeighbors(entry, seeds);
    return orderedIds(entry, [...seeds, ...additions], budget);
};

const selectionFromIds = (
    method: HybridMethod,
    entry: ContextBenchmarkCase,
    messageIds: readonly string[],
    semantic: HostedSelectionRecord,
    candidateCount: number,
    branchExpansions = 0
): HybridSelection => ({
    method,
    hybridMethod: method,
    status: semantic.selection.status,
    messageIds: orderedIds(entry, messageIds, STRUCTURAL_CLOSURE_BUDGET),
    candidateCount,
    retrievalDepth: semantic.selection.retrievalDepth,
    branchExpansions,
    expansionDepth: branchExpansions > 0 ? 1 : 0,
    latencyMs: semantic.latencyMs,
    semanticCandidateCount: semantic.selection.candidateCount,
    semanticLatencyMs: semantic.latencyMs,
});

export const buildHybridSelection = (
    entry: ContextBenchmarkCase,
    semantic: HostedSelectionRecord,
    method: HybridMethod
): HybridSelection => {
    const semanticIds = frozenSemanticIds(semantic);
    const semanticScores = candidateScores(semantic);
    const bm25Graph = selectContext('bm25_graph_expansion', entry);

    if (method === 'bm25_graph_semantic_prune') {
        const candidateIds = new Set(bm25Graph.messageIds);
        return selectionFromIds(
            method,
            entry,
            semanticIds.filter((messageId) => candidateIds.has(messageId)),
            semantic,
            bm25Graph.messageIds.length
        );
    }

    if (method === 'semantic_structural_closure') {
        const ids = expandStructuralClosure(entry, semanticIds);
        return selectionFromIds(
            method,
            entry,
            ids,
            semantic,
            semantic.selection.candidateCount,
            Math.max(0, ids.length - semanticIds.length)
        );
    }

    const topBm25Ids = selectContextAtBudget(
        'bm25',
        entry,
        CONSERVATIVE_BM25_SEED_COUNT
    ).messageIds;
    const semanticRankedIds = semanticIds
        .filter((messageId) => semanticScores.has(messageId))
        .concat(topBm25Ids);
    return selectionFromIds(
        method,
        entry,
        semanticRankedIds,
        semantic,
        semantic.selection.candidateCount,
        Math.max(0, new Set(semanticRankedIds).size - semanticIds.length)
    );
};

type HybridCaseResult = {
    caseId: string;
    category: ContextBenchmarkCase['category'];
    method: ComparisonMethod;
    selection: HybridSelection;
    metric: CaseMetric;
};

const metricForHybrid = (
    entry: ContextBenchmarkCase,
    selection: HybridSelection
): CaseMetric =>
    buildCaseMetric(entry, {
        ...selection,
        method: 'bm25_graph_expansion',
    });

const average = (values: readonly (number | null)[]): number | null => {
    const present = values.filter((value): value is number => value !== null);
    return present.length === 0
        ? null
        : present.reduce((sum, value) => sum + value, 0) / present.length;
};

const percentile = (
    values: readonly number[],
    value: number
): number | null => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil((value / 100) * sorted.length) - 1)
    );
    return sorted[index] ?? null;
};

const format = (value: number | null, digits = 3): string =>
    value === null ? 'n/a' : value.toFixed(digits);

const aggregate = (results: readonly HybridCaseResult[]) => ({
    cases: results.length,
    recall: average(results.map((result) => result.metric.necessaryRecall)),
    usefulPrecision: average(
        results.map((result) => result.metric.usefulContextPrecision)
    ),
    distractingRate: average(
        results.map((result) => result.metric.distractingContextRate)
    ),
    averageMessages: average(
        results.map((result) => result.metric.finalMessageCount)
    ),
    averageUnits: average(
        results.map((result) => result.metric.estimatedInputTokens)
    ),
    historicalRecovery: average(
        results.map((result) => result.metric.historicalDistanceRecovery)
    ),
    p95LatencyMs: percentile(
        results
            .map((result) => result.selection.semanticLatencyMs)
            .filter((value): value is number => value !== null),
        95
    ),
});

const markdownRow = (
    name: string,
    values: ReturnType<typeof aggregate>
): string =>
    `| ${name} | ${values.cases} | ${format(values.recall)} | ${format(values.usefulPrecision)} | ${format(values.distractingRate)} | ${format(values.averageMessages, 1)} | ${format(values.averageUnits, 1)} | ${format(values.p95LatencyMs, 0)} |`;

const writeReport = (
    outputDirectory: string,
    results: readonly HybridCaseResult[],
    baselineResults: readonly HybridCaseResult[],
    semanticRecords: readonly HostedSelectionRecord[],
    actionSummary: readonly string[]
): void => {
    const methods = [
        'current_window',
        'bm25_graph_expansion',
        'hosted_zero_shot',
        ...HYBRID_METHODS,
    ] as const;
    const allRows = methods.map((method) => {
        const matching = baselineResults.filter(
            (result) => result.method === method
        );
        return markdownRow(method, aggregate(matching));
    });
    const focusCategories = [
        'scattered_context',
        'coreference_ambiguous',
        'misleading_overlap_hard',
        'irrelevant_high_similarity',
        'negative_historical_match',
    ] as const;
    const categoryRows = focusCategories.flatMap((category) =>
        methods.map((method) => {
            const matching = baselineResults.filter(
                (result) =>
                    result.category === category && result.method === method
            );
            const values = aggregate(matching);
            return `| ${category} | ${method} | ${format(values.recall)} | ${format(values.usefulPrecision)} | ${format(values.averageUnits, 1)} |`;
        })
    );
    const lines = [
        '# Hybrid context-selection ablation',
        '',
        'This offline experiment reuses the frozen hosted candidate scores. It does not call the hosted selector again and does not use benchmark labels as selector inputs.',
        '',
        '## Variants',
        '',
        '- `bm25_graph_semantic_prune`: keep only frozen semantic selections that are also in the BM25 + graph candidate set.',
        '- `semantic_structural_closure`: keep frozen semantic selections, then add one-hop reply, adjacency, same-author, and trigger-reply neighbors up to 15 messages.',
        '- `semantic_plus_bm25_top3`: keep semantic selections and add the top three lexical BM25 messages, capped at 15 messages.',
        '',
        'No `necessaryMessageIds`, `usefulMessageIds`, `distractingMessageIds`, or manually labeled prerequisite relationships are read by the selector functions.',
        '',
        '## Full-corpus selector results',
        '',
        '| Method | Cases | Required recall | Useful precision | Distracting rate | Avg messages | Avg units | p95 semantic latency ms |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...allRows,
        '',
        'The hybrid latency column reuses the frozen semantic scoring latency. It does not claim that sending fewer candidates would reduce latency without another model-backed run.',
        '',
        '## Focus categories',
        '',
        '| Category | Method | Recall | Useful precision | Avg units |',
        '| --- | --- | ---: | ---: | ---: |',
        ...categoryRows,
        '',
        '## Action and ignore behavior',
        '',
        ...actionSummary,
        '',
        '## Downstream replay status',
        '',
        'No hybrid was replayed through `/api/chat` in this slice. The selector-only ablation must identify a meaningful recall/context-size improvement before spending generation and reviewer budget.',
        '',
        '## Evidence limits',
        '',
        `Frozen hosted records: ${semanticRecords.length}. Baseline and hybrid rows use the same synthetic corpus and the same context-unit estimate. Semantic score latency is retained for comparison, but reduced-candidate latency is only an estimate until a new model-backed run is justified.`,
    ];
    fs.writeFileSync(
        path.join(outputDirectory, 'report.md'),
        `${lines.join('\n')}\n`,
        'utf8'
    );
    fs.writeFileSync(
        path.join(outputDirectory, 'case-results.jsonl'),
        `${results.map((result) => JSON.stringify(result)).join('\n')}\n`,
        'utf8'
    );
};

const baselineSelection = (
    entry: ContextBenchmarkCase,
    method: 'current_window' | 'bm25_graph_expansion',
    semantic: HostedSelectionRecord
): HybridCaseResult => {
    const selection =
        method === 'current_window'
            ? selectContext('current_window', entry)
            : selectContext('bm25_graph_expansion', entry);
    const hybridSelection: HybridSelection = {
        ...selection,
        hybridMethod: method,
        semanticCandidateCount: semantic.selection.candidateCount,
        semanticLatencyMs:
            method === 'current_window' || method === 'bm25_graph_expansion'
                ? null
                : semantic.latencyMs,
    };
    return {
        caseId: entry.id,
        category: entry.category,
        method,
        selection: hybridSelection,
        metric: metricForHybrid(entry, hybridSelection),
    };
};

const semanticBaseline = (
    entry: ContextBenchmarkCase,
    semantic: HostedSelectionRecord
): HybridCaseResult => {
    const selection: HybridSelection = {
        ...semantic.selection,
        method: 'bm25_graph_expansion',
        hybridMethod: 'semantic_structural_closure',
        semanticCandidateCount: semantic.selection.candidateCount,
        semanticLatencyMs: semantic.latencyMs,
    };
    return {
        caseId: entry.id,
        category: entry.category,
        method: 'hosted_zero_shot',
        selection,
        metric: metricForHybrid(entry, selection),
    };
};

export const runHybridAblation = (input: {
    corpus: readonly ContextBenchmarkCase[];
    semanticRecords: readonly HostedSelectionRecord[];
}): HybridCaseResult[] => {
    const byCase = new Map(
        input.semanticRecords.map((record) => [record.caseId, record])
    );
    const results: HybridCaseResult[] = [];
    for (const entry of input.corpus) {
        const semantic = byCase.get(entry.id);
        if (semantic === undefined) continue;
        for (const method of HYBRID_METHODS) {
            const selection = buildHybridSelection(entry, semantic, method);
            results.push({
                caseId: entry.id,
                category: entry.category,
                method,
                selection,
                metric: metricForHybrid(entry, selection),
            });
        }
    }
    return results;
};

const readArgument = (args: readonly string[], name: string): string | null => {
    const index = args.indexOf(name);
    return index < 0 ? null : (args[index + 1] ?? null);
};

const main = (): void => {
    const root = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '..'
    );
    const hostedPath = path.resolve(
        readArgument(process.argv.slice(2), '--hosted-selection') ??
            path.join(
                root,
                '.footnote-dev/context-selection-717-replay/hosted-openai-gpt-6-luna-20260924/hosted-selection.jsonl'
            )
    );
    const outputDirectory = path.resolve(
        readArgument(process.argv.slice(2), '--output-dir') ??
            path.join(
                root,
                '.footnote-dev/context-selection-717-replay/hybrid-ablation-20260924'
            )
    );
    const corpus = buildBenchmarkCorpus();
    const semanticRecords = readHostedSelectionRecords(hostedPath);
    const results = runHybridAblation({ corpus, semanticRecords });
    const byCase = new Map(
        semanticRecords.map((record) => [record.caseId, record])
    );
    const baselineResults: HybridCaseResult[] = [];
    for (const entry of corpus) {
        const semantic = byCase.get(entry.id);
        if (semantic === undefined) continue;
        baselineResults.push(
            baselineSelection(entry, 'current_window', semantic)
        );
        baselineResults.push(
            baselineSelection(entry, 'bm25_graph_expansion', semantic)
        );
        baselineResults.push(semanticBaseline(entry, semantic));
    }
    fs.mkdirSync(outputDirectory, { recursive: true });
    const actionSummary = [
        'The existing 20-case `/api/chat` replay is descriptive only. It recorded `action: ignore` for many cases, but the synthetic fixtures define message relevance, not an expected engagement decision.',
        'Therefore this ablation does not score ignore as correct or incorrect and does not change planner behavior.',
    ];
    writeReport(
        outputDirectory,
        results,
        [...baselineResults, ...results],
        semanticRecords,
        actionSummary
    );
    console.log(
        JSON.stringify(
            { outputDirectory, cases: corpus.length, results: results.length },
            null,
            2
        )
    );
};

if (
    process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    const startedAt = performance.now();
    main();
    console.error(
        `hybrid ablation completed in ${(performance.now() - startedAt).toFixed(1)}ms`
    );
}
