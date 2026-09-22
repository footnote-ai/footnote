/**
 * @description: Measures context budgets, deterministic-edge ablations, and bounded recursive expansion for #717.
 * @footnote-scope: test
 * @footnote-module: ContextSelectionEvidence
 * @footnote-risk: medium - Offline benchmark results can mislead later context architecture decisions.
 * @footnote-ethics: high - All fixtures are synthetic and no private conversation content is retained.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
    aggregateMetrics,
    buildBenchmarkCorpus,
    buildCaseMetric,
    selectBm25GraphExpansionWithEdges,
    selectContextAtBudget,
    type ContextBenchmarkCase,
    type ContextGraphEdge,
    type ContextSelectionMethod,
    type SelectionResult,
} from './context-selection-benchmark.js';

const BUDGETS = [3, 5, 8, 10, 15, 20, 24] as const;
const GRAPH_EDGES: readonly ContextGraphEdge[] = [
    'reply',
    'adjacent',
    'same_author',
    'trigger_reply',
];

type EvidenceAggregate = {
    label: string;
    method: ContextSelectionMethod;
    caseCount: number;
    necessaryMessageRecall: number | null;
    usefulContextPrecision: number | null;
    distractingContextRate: number | null;
    averageFinalMessageCount: number | null;
    averageEstimatedInputTokens: number | null;
    averageBranchExpansionCount: number | null;
    averageExpansionDepth: number | null;
    p95LatencyMs: number | null;
};

type BudgetCurveRow = EvidenceAggregate & {
    budget: number;
};

type AblationRow = EvidenceAggregate & {
    edges: readonly ContextGraphEdge[];
};

type BranchPruningRow = EvidenceAggregate & {
    budget: number;
    seedCount: number;
    maxDepth: number | null;
};

type EvidenceReport = {
    issue: 717;
    generatedAt: string;
    corpus: {
        caseCount: number;
        categoryCounts: Record<string, number>;
        fixtureProvenance: string;
    };
    budgetCurves: BudgetCurveRow[];
    ablations: AblationRow[];
    branchPruning: {
        comparison: string;
        rows: BranchPruningRow[];
    };
    limitations: string[];
};

const average = (values: number[]): number | null =>
    values.length === 0
        ? null
        : values.reduce((total, value) => total + value, 0) / values.length;

const summarize = (
    label: string,
    pairs: Array<{ entry: ContextBenchmarkCase; result: SelectionResult }>
): EvidenceAggregate => {
    const metrics = pairs.map(({ entry, result }) =>
        buildCaseMetric(entry, result)
    );
    const aggregate = aggregateMetrics(
        pairs[0]?.result.method ?? 'bm25',
        metrics
    );
    return {
        label,
        method: aggregate.method,
        caseCount: pairs.length,
        necessaryMessageRecall: aggregate.necessaryMessageRecall,
        usefulContextPrecision: aggregate.usefulContextPrecision,
        distractingContextRate: aggregate.distractingContextRate,
        averageFinalMessageCount: aggregate.averageFinalMessageCount,
        averageEstimatedInputTokens: aggregate.averageEstimatedInputTokens,
        averageBranchExpansionCount: aggregate.averageBranchExpansionCount,
        averageExpansionDepth: average(
            pairs
                .map(({ result }) => result.expansionDepth)
                .filter((depth): depth is number => depth !== undefined)
        ),
        p95LatencyMs: aggregate.p95LatencyMs,
    };
};

const selectBudgeted = (
    method: ContextSelectionMethod,
    entry: ContextBenchmarkCase,
    budget: number
): SelectionResult => selectContextAtBudget(method, entry, budget);

const runBudgetCurves = (corpus: ContextBenchmarkCase[]): BudgetCurveRow[] => {
    const methods: Array<{
        method: ContextSelectionMethod;
        label: string;
    }> = [
        { method: 'current_window', label: 'current_window' },
        { method: 'bm25', label: 'bm25' },
        { method: 'bm25_reply_expansion', label: 'bm25_reply_expansion' },
        { method: 'bm25_graph_expansion', label: 'bm25_graph_expansion' },
    ];
    return methods.flatMap(({ method, label }) =>
        BUDGETS.map((budget) => ({
            ...summarize(
                label,
                corpus.map((entry) => ({
                    entry,
                    result: selectBudgeted(method, entry, budget),
                }))
            ),
            budget,
        }))
    );
};

const runAblations = (corpus: ContextBenchmarkCase[]): AblationRow[] => {
    const configurations: Array<{
        label: string;
        method: ContextSelectionMethod;
        edges: readonly ContextGraphEdge[];
    }> = [
        { label: 'bm25', method: 'bm25', edges: [] },
        {
            label: 'bm25_plus_reply',
            method: 'bm25_reply_expansion',
            edges: ['reply'],
        },
        {
            label: 'bm25_plus_adjacent',
            method: 'bm25_graph_expansion',
            edges: ['adjacent'],
        },
        {
            label: 'bm25_plus_same_author',
            method: 'bm25_graph_expansion',
            edges: ['same_author'],
        },
        {
            label: 'bm25_plus_trigger_reply',
            method: 'bm25_graph_expansion',
            edges: ['trigger_reply'],
        },
        {
            label: 'bm25_plus_reply_adjacent',
            method: 'bm25_graph_expansion',
            edges: ['reply', 'adjacent'],
        },
        {
            label: 'bm25_full_graph',
            method: 'bm25_graph_expansion',
            edges: GRAPH_EDGES,
        },
    ];
    return configurations.map(({ label, method, edges }) => ({
        ...summarize(
            label,
            corpus.map((entry) => ({
                entry,
                result:
                    method === 'bm25' || method === 'bm25_reply_expansion'
                        ? selectContextAtBudget(method, entry, 24)
                        : selectBm25GraphExpansionWithEdges(entry, {
                              budget: 24,
                              edges,
                          }),
            }))
        ),
        edges,
    }));
};

const runBranchPruning = (
    corpus: ContextBenchmarkCase[]
): BranchPruningRow[] => {
    const seedCount = 3;
    const maxDepth = 2;
    return BUDGETS.filter((budget) => budget <= 15).flatMap((budget) => {
        const topN = summarize(
            `top_n_bm25_${budget}`,
            corpus.map((entry) => ({
                entry,
                result: selectContextAtBudget('bm25', entry, budget),
            }))
        );
        const recursive = summarize(
            `recursive_graph_${budget}`,
            corpus.map((entry) => ({
                entry,
                result: selectBm25GraphExpansionWithEdges(entry, {
                    budget,
                    seedCount,
                    maxDepth,
                    edges: GRAPH_EDGES,
                }),
            }))
        );
        return [
            { ...topN, budget, seedCount: budget, maxDepth: null },
            { ...recursive, budget, seedCount, maxDepth },
        ];
    });
};

const format = (value: number | null): string =>
    value === null ? 'n/a' : value.toFixed(3);

const writeSummary = (report: EvidenceReport): void => {
    const lines = [
        '# Context-selection evidence expansion (#717)',
        '',
        `Generated: ${report.generatedAt}`,
        `Corpus: ${report.corpus.caseCount} synthetic cases`,
        `Category counts: ${JSON.stringify(report.corpus.categoryCounts)}`,
        '',
        '## Selection budgets',
        '',
        '| Method | Budget | Recall | Precision | Distracting | Avg msgs | Avg units | p95 ms |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...report.budgetCurves.map(
            (row) =>
                `| ${row.label} | ${row.budget} | ${format(row.necessaryMessageRecall)} | ${format(row.usefulContextPrecision)} | ${format(row.distractingContextRate)} | ${format(row.averageFinalMessageCount)} | ${format(row.averageEstimatedInputTokens)} | ${format(row.p95LatencyMs)} |`
        ),
        '',
        '## Deterministic-edge ablations',
        '',
        '| Configuration | Recall | Precision | Distracting | Avg msgs | Avg units | Branches |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...report.ablations.map(
            (row) =>
                `| ${row.label} | ${format(row.necessaryMessageRecall)} | ${format(row.usefulContextPrecision)} | ${format(row.distractingContextRate)} | ${format(row.averageFinalMessageCount)} | ${format(row.averageEstimatedInputTokens)} | ${format(row.averageBranchExpansionCount)} |`
        ),
        '',
        '## Branch-pruning comparison',
        '',
        '| Strategy | Budget | Recall | Precision | Distracting | Avg msgs | Branches | Depth |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...report.branchPruning.rows.map(
            (row) =>
                `| ${row.label} | ${row.budget} | ${format(row.necessaryMessageRecall)} | ${format(row.usefulContextPrecision)} | ${format(row.distractingContextRate)} | ${format(row.averageFinalMessageCount)} | ${format(row.averageBranchExpansionCount)} | ${format(row.averageExpansionDepth)} |`
        ),
        '',
        '## Interpretation guardrails',
        '',
        '- These are offline synthetic fixtures; they are not production Discord estimates.',
        '- The budget curve measures answerability pressure as context is reduced; it does not choose a production token budget.',
        '- Ablations report regressions as well as gains. No deterministic edge is presumed useful before measurement.',
        '- Recursive expansion is bounded benchmark code, not a production graph implementation.',
        ...report.limitations.map((limitation) => `- ${limitation}`),
    ];
    fs.writeFileSync(
        path.resolve('artifacts/context-selection-717/evidence-summary.md'),
        `${lines.join('\n')}\n`,
        'utf8'
    );
};

const main = (): void => {
    const corpus = buildBenchmarkCorpus();
    const categoryCounts = Object.fromEntries(
        corpus.map((entry) => entry.category).map((category) => [category, 0])
    );
    for (const entry of corpus) {
        categoryCounts[entry.category] =
            (categoryCounts[entry.category] ?? 0) + 1;
    }
    const report: EvidenceReport = {
        issue: 717,
        generatedAt: new Date().toISOString(),
        corpus: {
            caseCount: corpus.length,
            categoryCounts,
            fixtureProvenance:
                'synthetic_structurally_faithful_discord_shapes; no private transcripts',
        },
        budgetCurves: runBudgetCurves(corpus),
        ablations: runAblations(corpus),
        branchPruning: {
            comparison:
                'top-N BM25 versus three-seed bounded recursive graph expansion',
            rows: runBranchPruning(corpus),
        },
        limitations: [
            'No neural embedding, reranker, OpenJEV, or generated answer call is made.',
            'The deterministic support proxy remains the downstream answerability check; provider-backed generation is a separate blocked gate.',
        ],
    };
    const outputDirectory = path.resolve('artifacts/context-selection-717');
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(
        path.join(outputDirectory, 'evidence.json'),
        `${JSON.stringify(report, null, 2)}\n`,
        'utf8'
    );
    writeSummary(report);
    console.log(
        JSON.stringify(
            {
                issue: report.issue,
                cases: report.corpus.caseCount,
                budgets: BUDGETS,
                ablations: report.ablations.length,
                branchRows: report.branchPruning.rows.length,
            },
            null,
            2
        )
    );
};

main();
