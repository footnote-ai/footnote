/**
 * @description: Runs the frozen #717 context workload through OpenRouter Jev.
 * @footnote-scope: test
 * @footnote-module: DirectJevBenchmark
 * @footnote-risk: medium - Results can influence later judgment architecture decisions.
 * @footnote-ethics: high - Synthetic fixtures only; hosted results remain advisory and fail-open.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
    aggregateMetrics,
    buildBenchmarkCorpus,
    buildCaseMetric,
    selectContext,
    type AggregateMetric,
    type ContextBenchmarkCase,
    type SelectionResult,
} from './context-selection-benchmark.js';
import {
    createReplayFetch,
    decisions,
    JEV_MODEL,
    JevRequestError,
    type DecisionsResponse,
    type JsonValue,
} from './direct-jev-adapter.js';

type HostedCase = {
    caseId: string;
    category: ContextBenchmarkCase['category'];
    selectedMessageIds: string[];
    probabilities: Record<string, number>;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    requestId: string | null;
    provider: string | null;
    model: string;
};

type HostedReport = {
    status: 'completed' | 'partial' | 'blocked' | 'error';
    requestedModel: string;
    threshold: number;
    thresholdStatus: 'exploratory';
    callsAttempted: number;
    callsCompleted: number;
    casesCompleted: number;
    casesAttempted: number;
    providers: string[];
    servedModels: string[];
    metrics: Omit<AggregateMetric, 'method' | 'unavailableCases'> & {
        inputTokens: number;
        outputTokens: number;
        costUsd: number | null;
        averageLatencyMs: number | null;
    };
    errors: Array<{ caseId?: string; kind: string; message: string }>;
    cases: HostedCase[];
    reason?: string;
};

type ClaimEvidenceReport = {
    status: 'hosted' | 'replay_only' | 'blocked';
    answerProbability: number | null;
    model: string | null;
    provider: string | null;
    requestId: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    latencyMs: number | null;
    note: string;
};

type BenchmarkOutput = {
    benchmark: 'direct_openrouter_jev_741';
    corpus: {
        issue: 717;
        caseCount: number;
        provenance: string;
    };
    integration: {
        endpoint: string;
        model: string;
        requestResponse: string;
        threshold: string;
        cancellation: string;
    };
    baseline: ReturnType<typeof aggregateMetrics>[];
    hostedJev: HostedReport;
    claimEvidence: ClaimEvidenceReport;
    limitations: string[];
};

const fixturePath = path.join('scripts', 'fixtures', 'claim-evidence.json');
const claimFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
    state: Record<string, JsonValue>;
    question: {
        type: 'noul';
        instructions: JsonValue;
        criteria: { true: JsonValue; false: JsonValue };
    };
};

const candidateKey = (id: string): string =>
    `candidate_${id.replace(/[^a-zA-Z0-9_]/g, '_')}`;

const selectionState = (entry: ContextBenchmarkCase): JsonValue => ({
    trigger: entry.latestUserInput,
    candidates: entry.messages.map((message) => ({
        id: message.id,
        authorId: message.authorId,
        text: message.text,
        ...(message.replyToId === undefined
            ? {}
            : { replyToId: message.replyToId }),
    })),
});

const emptyMetrics = (): HostedReport['metrics'] => ({
    completedCases: 0,
    necessaryMessageRecall: null,
    necessaryMessageRecall95Ci: null,
    usefulContextPrecision: null,
    usefulContextPrecision95Ci: null,
    distractingContextRate: null,
    averageFinalMessageCount: null,
    averageEstimatedInputTokens: null,
    averageCandidateCount: null,
    averageRetrievalDepth: null,
    historicalDistanceRecovery: null,
    averageBranchExpansionCount: null,
    p50LatencyMs: null,
    p95LatencyMs: null,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
    averageLatencyMs: null,
});

const runHosted = async (
    corpus: ContextBenchmarkCase[],
    apiKey: string | undefined,
    threshold: number,
    timeoutMs: number
): Promise<HostedReport> => {
    if (!apiKey?.trim()) {
        return {
            status: 'blocked',
            requestedModel: JEV_MODEL,
            threshold,
            thresholdStatus: 'exploratory',
            callsAttempted: 0,
            callsCompleted: 0,
            casesCompleted: 0,
            casesAttempted: 0,
            providers: [],
            servedModels: [],
            metrics: emptyMetrics(),
            errors: [],
            cases: [],
            reason: 'OPENROUTER_API_KEY is absent; hosted Jev was not invoked.',
        };
    }

    const cases: HostedCase[] = [];
    const caseMetrics = [];
    const errors: HostedReport['errors'] = [];
    const providers = new Set<string>();
    const servedModels = new Set<string>();
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    let allCostsReported = true;
    let latencyTotal = 0;
    let callsAttempted = 0;
    let callsCompleted = 0;
    for (const entry of corpus) {
        const questions = Object.fromEntries(
            entry.messages.map((message) => [
                candidateKey(message.id),
                {
                    type: 'noul' as const,
                    instructions: {
                        question:
                            'Is this candidate useful for answering the trigger?',
                        candidateId: message.id,
                    },
                    criteria: {
                        true: 'The candidate provides useful context for the trigger.',
                        false: 'The candidate is irrelevant or distracting for the trigger.',
                    },
                },
            ])
        );
        const started = performance.now();
        callsAttempted += 1;
        try {
            const response = await decisions(
                { state: selectionState(entry), questions, model: JEV_MODEL },
                { apiKey, timeoutMs }
            );
            callsCompleted += 1;
            const latencyMs = performance.now() - started;
            const probabilities = Object.fromEntries(
                entry.messages.map((message) => [
                    message.id,
                    response.answers[candidateKey(message.id)]?.noul ?? 0,
                ])
            );
            const selectedMessageIds = Object.entries(probabilities)
                .filter(([, probability]) => probability >= threshold)
                .map(([id]) => id);
            const selection: SelectionResult = {
                method: 'openjev',
                status: 'completed',
                messageIds: selectedMessageIds,
                candidateCount: entry.messages.length,
                retrievalDepth: entry.messages.length,
                branchExpansions: 0,
                latencyMs,
            };
            caseMetrics.push(buildCaseMetric(entry, selection));
            cases.push({
                caseId: entry.id,
                category: entry.category,
                selectedMessageIds,
                probabilities,
                latencyMs,
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
                costUsd: response.usage.cost ?? null,
                requestId: response.id ?? null,
                provider: response.provider ?? null,
                model: response.model,
            });
            inputTokens += response.usage.input_tokens;
            outputTokens += response.usage.output_tokens;
            latencyTotal += latencyMs;
            if (response.usage.cost === undefined) allCostsReported = false;
            else costUsd += response.usage.cost;
            if (response.provider) providers.add(response.provider);
            servedModels.add(response.model);
        } catch (error) {
            const jevError =
                error instanceof JevRequestError
                    ? error
                    : new JevRequestError('network', 'Unexpected Jev error.');
            errors.push({
                caseId: entry.id,
                kind: jevError.kind,
                message: jevError.message,
            });
            break;
        }
    }
    const aggregate = aggregateMetrics('openjev', caseMetrics);
    return {
        status:
            errors.length === 0
                ? 'completed'
                : cases.length === 0
                  ? 'error'
                  : 'partial',
        requestedModel: JEV_MODEL,
        threshold,
        thresholdStatus: 'exploratory',
        callsAttempted,
        callsCompleted,
        casesCompleted: cases.length,
        casesAttempted: callsAttempted,
        providers: [...providers],
        servedModels: [...servedModels],
        metrics: {
            completedCases: aggregate.completedCases,
            necessaryMessageRecall: aggregate.necessaryMessageRecall,
            necessaryMessageRecall95Ci: aggregate.necessaryMessageRecall95Ci,
            usefulContextPrecision: aggregate.usefulContextPrecision,
            usefulContextPrecision95Ci: aggregate.usefulContextPrecision95Ci,
            distractingContextRate: aggregate.distractingContextRate,
            averageFinalMessageCount: aggregate.averageFinalMessageCount,
            averageEstimatedInputTokens: aggregate.averageEstimatedInputTokens,
            averageCandidateCount: aggregate.averageCandidateCount,
            averageRetrievalDepth: aggregate.averageRetrievalDepth,
            historicalDistanceRecovery: aggregate.historicalDistanceRecovery,
            averageBranchExpansionCount: aggregate.averageBranchExpansionCount,
            p50LatencyMs: aggregate.p50LatencyMs,
            p95LatencyMs: aggregate.p95LatencyMs,
            inputTokens,
            outputTokens,
            costUsd: allCostsReported ? costUsd : null,
            averageLatencyMs:
                cases.length === 0 ? null : latencyTotal / cases.length,
        },
        errors,
        cases,
    };
};

const runClaimEvidence = async (
    apiKey: string | undefined,
    timeoutMs: number
): Promise<ClaimEvidenceReport> => {
    const replay: DecisionsResponse = {
        model: 'replay:claim-evidence',
        answers: { support: { type: 'noul', noul: 0.82 } },
        usage: { input_tokens: 0, output_tokens: 0, cost: 0 },
    };
    if (!apiKey?.trim()) {
        const response = await decisions(
            {
                state: claimFixture.state,
                questions: { support: claimFixture.question },
            },
            {
                apiKey: 'replay-only',
                model: JEV_MODEL,
                fetch: createReplayFetch(replay),
            }
        );
        return {
            status: 'replay_only',
            answerProbability: response.answers.support?.noul ?? null,
            model: response.model,
            provider: null,
            requestId: null,
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            costUsd: response.usage.cost ?? null,
            latencyMs: 0,
            note: 'Deterministic adapter replay only; no hosted claim/evidence result.',
        };
    }
    const started = performance.now();
    try {
        const response = await decisions(
            {
                state: claimFixture.state,
                questions: { support: claimFixture.question },
                model: JEV_MODEL,
            },
            { apiKey, timeoutMs }
        );
        return {
            status: 'hosted',
            answerProbability: response.answers.support?.noul ?? null,
            model: response.model,
            provider: response.provider ?? null,
            requestId: response.id ?? null,
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            costUsd: response.usage.cost ?? null,
            latencyMs: performance.now() - started,
            note: 'One hosted claim/evidence judgment; advisory only.',
        };
    } catch (error) {
        return {
            status: 'blocked',
            answerProbability: null,
            model: null,
            provider: null,
            requestId: null,
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
            latencyMs: performance.now() - started,
            note:
                error instanceof JevRequestError
                    ? `${error.kind}: ${error.message}`
                    : 'Hosted claim/evidence judgment failed.',
        };
    }
};

export const buildReport = async (): Promise<BenchmarkOutput> => {
    const corpus = buildBenchmarkCorpus();
    const baseline = (
        ['current_window', 'bm25_graph_expansion', 'openjev'] as const
    ).map((method) =>
        aggregateMetrics(
            method,
            corpus.map((entry) =>
                buildCaseMetric(entry, selectContext(method, entry))
            )
        )
    );
    const threshold = Number(process.env.OPENROUTER_JEV_THRESHOLD ?? '0.5');
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw new Error('OPENROUTER_JEV_THRESHOLD must be between 0 and 1.');
    }
    const timeoutMs = Number(process.env.OPENROUTER_JEV_TIMEOUT_MS ?? '10000');
    return {
        benchmark: 'direct_openrouter_jev_741',
        corpus: {
            issue: 717,
            caseCount: corpus.length,
            provenance: 'Frozen synthetic #717 corpus; no private transcripts.',
        },
        integration: {
            endpoint: 'POST https://openrouter.ai/api/alpha/decisions',
            model: JEV_MODEL,
            requestResponse:
                'state + named noul questions; typed answer probabilities, provider/model/id, input/output tokens, and USD usage cost.',
            threshold: `Exploratory noul threshold ${threshold}; not policy confidence and not split-tuned.`,
            cancellation:
                'Client AbortSignal and timeout abort the HTTP request. OpenRouter documentation does not specify Decisions API billing/refund or provider cancellation behavior after abort.',
        },
        baseline,
        hostedJev: await runHosted(
            corpus,
            process.env.OPENROUTER_API_KEY,
            threshold,
            timeoutMs
        ),
        claimEvidence: await runClaimEvidence(
            process.env.OPENROUTER_API_KEY,
            timeoutMs
        ),
        limitations: [
            'Jev probabilities are an advisory relevance signal and do not authorize or route production behavior.',
            'The frozen generic selector (openjev) remains unavailable in #717; only deterministic current-window and BM25 plus graph expansion are directly comparable here.',
            'The corpus is synthetic and not production traffic; the exploratory threshold was fixed before evaluation and was not tuned on a split.',
            'No production runtime seam, routing, provenance, policy, workflow, or JudgmentRuntime behavior changes are made.',
        ],
    };
};

if (process.argv[1]?.endsWith('direct-jev-benchmark.ts')) {
    void buildReport().then((report) => {
        console.log(JSON.stringify(report, null, 2));
    });
}
