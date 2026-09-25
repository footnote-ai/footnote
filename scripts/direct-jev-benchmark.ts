/**
 * @description: Runs the frozen #717 baseline beside an optional hosted TypeSafe Jev judgment.
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
    type ContextBenchmarkCase,
} from './context-selection-benchmark.js';
import {
    createReplayFetch,
    JEV_LATEST_ALIAS,
    JevRequestError,
    systemOne,
    type JsonValue,
    type SystemOneResponse,
} from './direct-jev-adapter.js';

type HostedCase = {
    caseId: string;
    category: ContextBenchmarkCase['category'];
    selectedCount: number;
    necessaryRecall: number;
    usefulPrecision: number;
    distractingRate: number;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    model: string;
};

type HostedReport = {
    status: 'completed' | 'blocked' | 'error';
    requestedModel: string;
    threshold: number;
    casesCompleted: number;
    casesAttempted: number;
    metrics: {
        necessaryRecall: number | null;
        usefulPrecision: number | null;
        distractingRate: number | null;
        averageSelectedCount: number | null;
        p95LatencyMs: number | null;
        inputTokens: number;
        outputTokens: number;
    };
    errors: Array<{ caseId?: string; kind: string; message: string }>;
    cases: HostedCase[];
    reason?: string;
};

type ClaimEvidenceReport = {
    status: 'hosted' | 'replay_only' | 'blocked';
    answerProbability: number | null;
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    note: string;
};

type BenchmarkOutput = {
    benchmark: 'direct_typesafe_jev_741';
    corpus: {
        issue: 717;
        caseCount: number;
        provenance: string;
    };
    integration: {
        endpoint: string;
        sdkReference: string;
        alias: string;
        modelPinning: string;
        threshold: string;
    };
    baseline: ReturnType<typeof aggregateMetrics>;
    hostedJev: HostedReport;
    claimEvidence: ClaimEvidenceReport;
    limitations: string[];
};

const fixturePath = path.join('scripts', 'fixtures', 'claim-evidence.json');
const claimFixture = JSON.parse(
    fs.readFileSync(fixturePath, 'utf8')
) as {
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

const p95 = (values: number[]): number | null => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? null;
};

const average = (values: number[]): number | null =>
    values.length === 0
        ? null
        : values.reduce((total, value) => total + value, 0) / values.length;

const runHosted = async (
    corpus: ContextBenchmarkCase[],
    apiKey: string | undefined,
    model: string,
    threshold: number,
    baseUrl: string | undefined,
    timeoutMs: number
): Promise<HostedReport> => {
    if (!apiKey?.trim()) {
        return {
            status: 'blocked',
            requestedModel: model,
            threshold,
            casesCompleted: 0,
            casesAttempted: 0,
            metrics: {
                necessaryRecall: null,
                usefulPrecision: null,
                distractingRate: null,
                averageSelectedCount: null,
                p95LatencyMs: null,
                inputTokens: 0,
                outputTokens: 0,
            },
            errors: [],
            cases: [],
            reason: 'TYPESAFE_API_KEY is absent; hosted Jev was not invoked.',
        };
    }

    const cases: HostedCase[] = [];
    const errors: HostedReport['errors'] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    for (const entry of corpus) {
        const questions = Object.fromEntries(
            entry.messages.map((message) => [
                candidateKey(message.id),
                {
                    type: 'noul' as const,
                    instructions: {
                        question: 'Is this candidate useful for answering the trigger?',
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
        try {
            const response = await systemOne(
                { state: selectionState(entry), questions, model },
                { apiKey, baseUrl, timeoutMs }
            );
            const selectedIds = entry.messages
                .filter(
                    (message) =>
                        (response.answers[candidateKey(message.id)]?.noul ?? 0) >=
                        threshold
                )
                .map((message) => message.id);
            const selected = new Set(selectedIds);
            const necessary = entry.necessaryMessageIds;
            const useful = entry.usefulMessageIds;
            const distracting = entry.distractingMessageIds;
            cases.push({
                caseId: entry.id,
                category: entry.category,
                selectedCount: selected.size,
                necessaryRecall:
                    necessary.filter((id) => selected.has(id)).length /
                    Math.max(1, necessary.length),
                usefulPrecision:
                    useful.filter((id) => selected.has(id)).length /
                    Math.max(1, selected.size),
                distractingRate:
                    distracting.filter((id) => selected.has(id)).length /
                    Math.max(1, selected.size),
                latencyMs: performance.now() - started,
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
                model: response.model,
            });
            inputTokens += response.usage.input_tokens;
            outputTokens += response.usage.output_tokens;
        } catch (error) {
            const jevError =
                error instanceof JevRequestError
                    ? error
                    : new JevRequestError('network', 'Unexpected Jev error.');
            errors.push({ caseId: entry.id, kind: jevError.kind, message: jevError.message });
            break;
        }
    }
    return {
        status: errors.length > 0 && cases.length === 0 ? 'error' : 'completed',
        requestedModel: model,
        threshold,
        casesCompleted: cases.length,
        casesAttempted: cases.length + errors.length,
        metrics: {
            necessaryRecall: average(cases.map((item) => item.necessaryRecall)),
            usefulPrecision: average(cases.map((item) => item.usefulPrecision)),
            distractingRate: average(cases.map((item) => item.distractingRate)),
            averageSelectedCount: average(cases.map((item) => item.selectedCount)),
            p95LatencyMs: p95(cases.map((item) => item.latencyMs)),
            inputTokens,
            outputTokens,
        },
        errors,
        cases,
    };
};

const runClaimEvidence = async (
    apiKey: string | undefined,
    model: string,
    baseUrl: string | undefined,
    timeoutMs: number
): Promise<ClaimEvidenceReport> => {
    const replay: SystemOneResponse = {
        model: 'replay:claim-evidence',
        answers: { support: { type: 'noul', noul: 0.82 } },
        usage: { input_tokens: 0, output_tokens: 0 },
    };
    if (!apiKey?.trim()) {
        const response = await systemOne(
            {
                state: claimFixture.state,
                questions: { support: claimFixture.question },
            },
            { apiKey: 'replay-only', model, fetch: createReplayFetch(replay) }
        );
        return {
            status: 'replay_only',
            answerProbability: response.answers.support?.noul ?? null,
            model: response.model,
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            note: 'Deterministic adapter replay only; no hosted claim/evidence result.',
        };
    }
    try {
        const response = await systemOne(
            {
                state: claimFixture.state,
                questions: { support: claimFixture.question },
                model,
            },
            { apiKey, baseUrl, timeoutMs }
        );
        return {
            status: 'hosted',
            answerProbability: response.answers.support?.noul ?? null,
            model: response.model,
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            note: 'One hosted claim/evidence judgment; advisory only.',
        };
    } catch (error) {
        return {
            status: 'blocked',
            answerProbability: null,
            model: null,
            inputTokens: null,
            outputTokens: null,
            note:
                error instanceof JevRequestError
                    ? `${error.kind}: ${error.message}`
                    : 'Hosted claim/evidence judgment failed.',
        };
    }
};

export const buildReport = async (): Promise<BenchmarkOutput> => {
    const corpus = buildBenchmarkCorpus();
    const baseline = aggregateMetrics(
        'bm25_graph_expansion',
        corpus.map((entry) =>
            buildCaseMetric(entry, selectContext('bm25_graph_expansion', entry))
        )
    );
    const model = process.env.TYPESAFE_JEV_MODEL?.trim() || JEV_LATEST_ALIAS;
    const threshold = Number(process.env.TYPESAFE_JEV_THRESHOLD ?? '0.5');
    const timeoutMs = Number(process.env.TYPESAFE_JEV_TIMEOUT_MS ?? '10000');
    const apiKey = process.env.TYPESAFE_API_KEY;
    return {
        benchmark: 'direct_typesafe_jev_741',
        corpus: {
            issue: 717,
            caseCount: corpus.length,
            provenance: 'Frozen synthetic #717 corpus; no private transcripts.',
        },
        integration: {
            endpoint: 'POST https://api.typesafe.ai/v1/systemone',
            sdkReference: '@typesafe-ai/sdk (official reference; direct fetch used here)',
            alias: JEV_LATEST_ALIAS,
            modelPinning:
                'Use TYPESAFE_JEV_MODEL after GET /v1/models; jev-latest moves, while the response model is recorded.',
            threshold: `Exploratory noul threshold ${threshold}; not policy confidence.`,
        },
        baseline,
        hostedJev: await runHosted(
            corpus,
            apiKey,
            model,
            threshold,
            process.env.TYPESAFE_BASE_URL,
            timeoutMs
        ),
        claimEvidence: await runClaimEvidence(
            apiKey,
            model,
            process.env.TYPESAFE_BASE_URL,
            timeoutMs
        ),
        limitations: [
            'Hosted Jev is a typed relevance judgment, not a generic generative selector.',
            'The corpus is synthetic and the deterministic baseline is replayable evidence, not production traffic.',
            'No production runtime seam, routing, provenance, policy, or workflow behavior changes are made.',
        ],
    };
};

if (process.argv[1]?.endsWith('direct-jev-benchmark.ts')) {
    const report = await buildReport();
    console.log(JSON.stringify(report, null, 2));
}