/**
 * @description: Blinded, bounded review of existing context-selection replay answers.
 * @footnote-scope: test
 * @footnote-module: ContextSelectionAnswerReview
 * @footnote-risk: medium - Reviewer drift or parsing errors could distort an experimental comparison.
 * @footnote-ethics: high - Synthetic answers stay local and the reviewer receives no selector identities.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import {
    createVoltAgentRuntime,
    type GenerationResult,
    type GenerationRuntime,
    type GenerationStructuredOutput,
    type GenerationRequest,
} from '@footnote/agent-runtime';
import type {
    ModelProfile,
    SupportedReasoningEffort,
} from '@footnote/contracts';

import {
    buildBenchmarkCorpus,
    type ContextBenchmarkCase,
} from './context-selection-benchmark.js';
import {
    REFERENCE_FACTS,
    type GeneratedAnswerSupport,
} from './context-selection-answer-quality.js';
import {
    loadResponseComparisonConfig,
    resolveModel,
    type ResponseComparisonModel,
} from './lib/response-comparison.js';
import type { ContextReplayRecord } from './context-selection-chat-replay.js';

export const CONTEXT_ANSWER_REVIEW_RUBRIC_VERSION = 'context-answer-review-v1';

type ReviewLabel = 'A' | 'B' | 'C';
type ReferenceResolution =
    'correct' | 'incorrect' | 'uncertain' | 'not_applicable';

export type ContextAnswerEvaluation = {
    label: ReviewLabel;
    requiredFactCoverage: number;
    referenceResolution: ReferenceResolution;
    unsupportedClaimCount: number;
    distractorContamination: boolean;
    sufficient: boolean;
    rationale: string;
    evidence: string[];
};

export type BlindedAnswer = {
    method: string;
    label: ReviewLabel;
    text: string;
};

export type ContextAnswerReviewCall = {
    status: 'completed' | 'failed';
    evaluations: ContextAnswerEvaluation[];
    latencyMs: number;
    usage: GenerationResult['usage'] | null;
    costUsd: number | null;
    failure: string | null;
    promptHash: string;
};

export type ContextAnswerReviewRecord = {
    schemaVersion: 1;
    rubricVersion: typeof CONTEXT_ANSWER_REVIEW_RUBRIC_VERSION;
    caseId: string;
    category: ContextBenchmarkCase['category'];
    reviewer: {
        profile: string;
        provider: string;
        model: string;
        reasoningEffort: SupportedReasoningEffort | null;
    };
    answers: Array<{
        method: string;
        label: ReviewLabel;
        chatStatus: ContextReplayRecord['chat']['status'];
        responseText: string | null;
        deterministicSupport: GeneratedAnswerSupport | null;
        evaluation: ContextAnswerEvaluation | null;
    }>;
    review: ContextAnswerReviewCall | null;
};

type ReviewRuntime = Pick<GenerationRuntime, 'generate'>;

const REVIEW_SYSTEM_PROMPT = `You are evaluating synthetic Footnote chat answers. The answer labels are anonymous and do not identify a selector. Judge each answer against the supplied trigger and conversation evidence, not against writing style or personal preference. Use the required fact groups as a checklist. Count only material unsupported claims. Mark distractor contamination true only when irrelevant evidence affected the answer. Use not_applicable for reference resolution when the trigger has no reference to resolve. Return exactly one evaluation for each answer label.`;

const REVIEW_SCHEMA: GenerationStructuredOutput['schema'] = {
    type: 'object',
    additionalProperties: false,
    properties: {
        answers: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    label: { type: 'string', enum: ['A', 'B', 'C'] },
                    required_fact_coverage: {
                        type: 'number',
                        minimum: 0,
                        maximum: 1,
                    },
                    reference_resolution: {
                        type: 'string',
                        enum: [
                            'correct',
                            'incorrect',
                            'uncertain',
                            'not_applicable',
                        ],
                    },
                    unsupported_claim_count: {
                        type: 'integer',
                        minimum: 0,
                    },
                    distractor_contamination: { type: 'boolean' },
                    sufficient: { type: 'boolean' },
                    rationale: { type: 'string' },
                    evidence: {
                        type: 'array',
                        items: { type: 'string' },
                    },
                },
                required: [
                    'label',
                    'required_fact_coverage',
                    'reference_resolution',
                    'unsupported_claim_count',
                    'distractor_contamination',
                    'sufficient',
                    'rationale',
                    'evidence',
                ],
            },
        },
    },
    required: ['answers'],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const hash = (value: unknown): string =>
    crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const labelFor = (index: number): ReviewLabel =>
    (['A', 'B', 'C'] as const)[index] ?? 'C';

/** Gives answer labels a stable, case-specific order without exposing methods. */
export const buildBlindedAnswers = (
    caseId: string,
    answers: readonly { method: string; text: string }[]
): BlindedAnswer[] =>
    [...answers]
        .sort((left, right) =>
            hash(`${caseId}:${left.method}`).localeCompare(
                hash(`${caseId}:${right.method}`)
            )
        )
        .map((answer, index) => ({ ...answer, label: labelFor(index) }));

const requiredEvidence = (entry: ContextBenchmarkCase): string[] =>
    entry.necessaryMessageIds.flatMap((messageId) => {
        const message = entry.messages.find(
            (candidate) => candidate.id === messageId
        );
        return message === undefined ? [] : [message.text];
    });

/** Builds the reviewer request while keeping selector names out of the prompt. */
export const buildReviewRequest = (
    entry: ContextBenchmarkCase,
    answers: readonly BlindedAnswer[]
): GenerationRequest => ({
    messages: [
        { role: 'system', content: REVIEW_SYSTEM_PROMPT },
        {
            role: 'user',
            content: JSON.stringify({
                rubricVersion: CONTEXT_ANSWER_REVIEW_RUBRIC_VERSION,
                trigger: entry.latestUserInput,
                requiredFactGroups: REFERENCE_FACTS[entry.category],
                requiredEvidence: requiredEvidence(entry),
                conversationEvidence: entry.messages.map((message) => ({
                    speaker: message.authorName ?? message.authorId,
                    text: message.text,
                })),
                answers: answers.map(({ label, text }) => ({ label, text })),
            }),
        },
    ],
    structuredOutput: {
        name: 'context-answer-review',
        schema: REVIEW_SCHEMA,
    },
});

const parseEvaluation = (value: unknown): ContextAnswerEvaluation => {
    if (!isRecord(value)) throw new Error('Review answer must be an object.');
    const label = value.label;
    const referenceResolution = value.reference_resolution;
    const coverage = value.required_fact_coverage;
    const unsupported = value.unsupported_claim_count;
    if (
        !(['A', 'B', 'C'] as const).includes(label as ReviewLabel) ||
        typeof coverage !== 'number' ||
        !Number.isFinite(coverage) ||
        coverage < 0 ||
        coverage > 1 ||
        !(
            ['correct', 'incorrect', 'uncertain', 'not_applicable'] as const
        ).includes(referenceResolution as ReferenceResolution) ||
        typeof unsupported !== 'number' ||
        !Number.isSafeInteger(unsupported) ||
        unsupported < 0 ||
        typeof value.distractor_contamination !== 'boolean' ||
        typeof value.sufficient !== 'boolean' ||
        typeof value.rationale !== 'string' ||
        !Array.isArray(value.evidence) ||
        !value.evidence.every((item) => typeof item === 'string')
    ) {
        throw new Error('Review answer does not match the bounded rubric.');
    }
    return {
        label: label as ReviewLabel,
        requiredFactCoverage: coverage,
        referenceResolution: referenceResolution as ReferenceResolution,
        unsupportedClaimCount: unsupported,
        distractorContamination: value.distractor_contamination,
        sufficient: value.sufficient,
        rationale: value.rationale,
        evidence: value.evidence,
    };
};

/** Parses one structured reviewer response and rejects missing or duplicate labels. */
export const parseContextAnswerReview = (
    value: unknown,
    expectedLabels: readonly ReviewLabel[]
): ContextAnswerEvaluation[] => {
    if (!isRecord(value) || !Array.isArray(value.answers)) {
        throw new Error('Review response must contain an answers array.');
    }
    const evaluations = value.answers.map(parseEvaluation);
    const labels = evaluations.map((evaluation) => evaluation.label);
    if (
        labels.length !== expectedLabels.length ||
        new Set(labels).size !== labels.length ||
        expectedLabels.some((label) => !labels.includes(label))
    ) {
        throw new Error('Review response omitted or repeated an answer label.');
    }
    return evaluations;
};

const parseReviewText = (
    text: string,
    expectedLabels: readonly ReviewLabel[]
): ContextAnswerEvaluation[] => {
    let value: unknown;
    try {
        value = JSON.parse(text) as unknown;
    } catch (error) {
        throw new Error(
            `Reviewer returned malformed JSON: ${error instanceof Error ? error.message : String(error)}`
        );
    }
    return parseContextAnswerReview(value, expectedLabels);
};

export const reviewBlindedAnswers = async (input: {
    entry: ContextBenchmarkCase;
    answers: readonly BlindedAnswer[];
    runtime: ReviewRuntime;
    profile: ModelProfile;
    reasoningEffort: SupportedReasoningEffort | null;
}): Promise<ContextAnswerReviewCall> => {
    const request = buildReviewRequest(input.entry, input.answers);
    const promptHash = hash(request.messages);
    const startedAt = Date.now();
    try {
        const result = await input.runtime.generate({
            ...request,
            model: input.profile.providerModel,
            provider: input.profile.provider,
            capabilities: input.profile.capabilities,
            ...(input.reasoningEffort === null
                ? {}
                : { reasoningEffort: input.reasoningEffort }),
        });
        return {
            status: 'completed',
            evaluations: parseReviewText(
                result.text,
                input.answers.map((answer) => answer.label)
            ),
            latencyMs: Date.now() - startedAt,
            usage: result.usage ?? null,
            costUsd:
                result.upstreamAttribution?.upstreamReportedCostUsd ?? null,
            failure: null,
            promptHash,
        };
    } catch (error) {
        return {
            status: 'failed',
            evaluations: [],
            latencyMs: Date.now() - startedAt,
            usage: null,
            costUsd: null,
            failure: error instanceof Error ? error.message : String(error),
            promptHash,
        };
    }
};

const readJsonLines = (filePath: string): ContextReplayRecord[] =>
    fs
        .readFileSync(filePath, 'utf8')
        .split(/\r?\n/gu)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as ContextReplayRecord);

const modelText = (model: ResponseComparisonModel): string =>
    'profile' in model ? model.profile : `${model.provider}/${model.model}`;

const average = (values: readonly number[]): number | null =>
    values.length === 0
        ? null
        : values.reduce((sum, value) => sum + value, 0) / values.length;

const writeSummary = (
    outputDirectory: string,
    records: readonly ContextAnswerReviewRecord[]
): void => {
    const methods = [
        ...new Set(
            records.flatMap((record) =>
                record.answers.map((answer) => answer.method)
            )
        ),
    ];
    const rows = methods.map((method) => {
        const answers = records.flatMap((record) =>
            record.answers.filter(
                (answer) =>
                    answer.method === method && answer.evaluation !== null
            )
        );
        const reviews = records.filter(
            (record) =>
                record.review?.status === 'failed' &&
                record.answers.some((answer) => answer.method === method)
        );
        const referenceResults = answers.filter(
            (answer) =>
                answer.evaluation?.referenceResolution !== 'not_applicable'
        );
        return `| ${method} | ${answers.length} | ${average(answers.map((answer) => answer.evaluation!.requiredFactCoverage))?.toFixed(3) ?? 'n/a'} | ${referenceResults.filter((answer) => answer.evaluation?.referenceResolution === 'correct').length}/${referenceResults.length} | ${answers.filter((answer) => answer.evaluation!.unsupportedClaimCount > 0).length}/${answers.length} | ${answers.filter((answer) => answer.evaluation!.distractorContamination).length}/${answers.length} | ${answers.filter((answer) => answer.evaluation!.sufficient).length}/${answers.length} | ${reviews.length} |`;
    });
    const reviewer = records[0]?.reviewer;
    const calls = records
        .map((record) => record.review)
        .filter((review): review is ContextAnswerReviewCall => review !== null);
    const completedCalls = calls.filter(
        (review) => review.status === 'completed'
    );
    const sumUsage = (
        field: 'promptTokens' | 'completionTokens' | 'totalTokens'
    ) =>
        completedCalls.reduce(
            (sum, review) => sum + (review.usage?.[field] ?? 0),
            0
        );
    const reportedCost = completedCalls.reduce(
        (sum, review) => sum + (review.costUsd ?? 0),
        0
    );
    const lines = [
        '# Blinded context-selection answer review',
        '',
        `Rubric: ${CONTEXT_ANSWER_REVIEW_RUBRIC_VERSION}. Answers were reviewed against the synthetic trigger, required fact groups, and conversation evidence. Selector names were omitted from reviewer prompts.`,
        '',
        '| Reviewer profile | Provider | Model | Reasoning |',
        '| --- | --- | --- | --- |',
        `| ${reviewer?.profile ?? 'n/a'} | ${reviewer?.provider ?? 'n/a'} | ${reviewer?.model ?? 'n/a'} | ${reviewer?.reasoningEffort ?? 'default'} |`,
        '',
        `Reviewer calls: ${completedCalls.length} completed, ${calls.length - completedCalls.length} failed; average latency ${average(completedCalls.map((review) => review.latencyMs))?.toFixed(0) ?? 'n/a'} ms; reported cost $${reportedCost.toFixed(6)}; tokens prompt/completion/total ${sumUsage('promptTokens')}/${sumUsage('completionTokens')}/${sumUsage('totalTokens')}.`,
        '',
        '| Method | Answers evaluated | Avg fact coverage | Reference resolution | Unsupported claims | Distractor contamination | Sufficient | Reviewer failures |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...rows,
        '',
        'Fact coverage is a bounded reviewer estimate from 0 to 1. The deterministic support proxy remains in the JSONL records so disagreements can be inspected.',
    ];
    fs.writeFileSync(
        path.join(outputDirectory, 'summary.md'),
        `${lines.join('\n')}\n`,
        'utf8'
    );
};

export const aggregateReviewRecords = (
    records: readonly ContextAnswerReviewRecord[]
): Array<{
    method: string;
    answerCount: number;
    sufficientRate: number | null;
}> => {
    const methods = [
        ...new Set(
            records.flatMap((record) =>
                record.answers.map((answer) => answer.method)
            )
        ),
    ];
    return methods.map((method) => {
        const answers = records.flatMap((record) =>
            record.answers.filter(
                (answer) =>
                    answer.method === method && answer.evaluation !== null
            )
        );
        return {
            method,
            answerCount: answers.length,
            sufficientRate:
                answers.length === 0
                    ? null
                    : answers.filter((answer) => answer.evaluation!.sufficient)
                          .length / answers.length,
        };
    });
};

type CliArguments = {
    currentReplay: string;
    graphReplay: string;
    hostedReplay: string;
    outputDirectory: string;
    limit: number;
    caseId?: string;
};

const readArguments = (args: readonly string[]): CliArguments => {
    const root = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '..'
    );
    const values: CliArguments = {
        currentReplay: path.join(
            root,
            '.footnote-dev/context-selection-717-replay/category-balanced-20260924/replay.jsonl'
        ),
        graphReplay: path.join(
            root,
            '.footnote-dev/context-selection-717-replay/category-balanced-20260924/replay.jsonl'
        ),
        hostedReplay: path.join(
            root,
            '.footnote-dev/context-selection-717-replay/hosted-frozen-balanced-20260924/replay.jsonl'
        ),
        outputDirectory: path.join(
            root,
            '.footnote-dev/context-selection-717-replay/blinded-review-20260924'
        ),
        limit: 20,
    };
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        const value = args[index + 1];
        if (argument === '--current-replay' && value !== undefined) {
            values.currentReplay = path.resolve(value);
            index += 1;
        } else if (argument === '--graph-replay' && value !== undefined) {
            values.graphReplay = path.resolve(value);
            index += 1;
        } else if (argument === '--hosted-replay' && value !== undefined) {
            values.hostedReplay = path.resolve(value);
            index += 1;
        } else if (argument === '--output-dir' && value !== undefined) {
            values.outputDirectory = path.resolve(value);
            index += 1;
        } else if (argument === '--limit' && value !== undefined) {
            values.limit = Number(value);
            index += 1;
        } else if (argument === '--case-id' && value !== undefined) {
            values.caseId = value;
            index += 1;
        } else {
            throw new Error(`Unknown or incomplete argument: ${argument}`);
        }
    }
    if (!Number.isSafeInteger(values.limit) || values.limit <= 0) {
        throw new Error('--limit must be a positive integer.');
    }
    return values;
};

const main = async (): Promise<void> => {
    dotenv.config({ quiet: true });
    const root = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '..'
    );
    const args = readArguments(process.argv.slice(2));
    const loaded = loadResponseComparisonConfig(
        path.join(root, 'response-comparison/config.yaml'),
        root
    );
    const reviewerSetting = loaded.config.review.automaticReviewer;
    if (reviewerSetting === undefined)
        throw new Error('Automatic reviewer is not configured.');
    const { runtimeConfig } = await import('../packages/backend/src/config.js');
    const profiles = new Map(
        runtimeConfig.modelProfiles.catalog.map((profile) => [
            profile.id,
            profile,
        ])
    );
    const profile = resolveModel(reviewerSetting.model, profiles);
    if (profile === null)
        throw new Error(
            `Reviewer profile was not found: ${modelText(reviewerSetting.model)}`
        );
    const runtime = createVoltAgentRuntime({
        defaultModel: `${profile.provider}/${profile.providerModel}`,
        openrouter: {
            apiKey: runtimeConfig.openrouter.apiKey ?? undefined,
            baseUrl: runtimeConfig.openrouter.baseUrl,
        },
    });
    const current = readJsonLines(args.currentReplay).filter(
        (record) => record.selector.method === 'current_window'
    );
    const graph = readJsonLines(args.graphReplay).filter(
        (record) => record.selector.method === 'bm25_graph_expansion'
    );
    const hosted = readJsonLines(args.hostedReplay).filter(
        (record) => record.selector.method === 'hosted_zero_shot'
    );
    const byMethod = new Map<string, Map<string, ContextReplayRecord>>([
        [
            'current_window',
            new Map(current.map((record) => [record.caseId, record])),
        ],
        [
            'bm25_graph_expansion',
            new Map(graph.map((record) => [record.caseId, record])),
        ],
        [
            'hosted_zero_shot',
            new Map(hosted.map((record) => [record.caseId, record])),
        ],
    ]);
    const cases = buildBenchmarkCorpus()
        .filter((entry) =>
            args.caseId === undefined ? true : entry.id === args.caseId
        )
        .slice(0, args.limit);
    if (cases.length === 0)
        throw new Error(`Benchmark case not found: ${args.caseId ?? 'none'}`);
    fs.mkdirSync(args.outputDirectory, { recursive: true });
    const records: ContextAnswerReviewRecord[] = [];
    for (const entry of cases) {
        const answers = buildBlindedAnswers(
            entry.id,
            [...byMethod.entries()].flatMap(([method, recordsByCase]) => {
                const responseText = recordsByCase.get(entry.id)?.chat
                    .responseText;
                return responseText === null || responseText === undefined
                    ? []
                    : [{ method, text: responseText }];
            })
        );
        const review =
            answers.length === 0
                ? null
                : await reviewBlindedAnswers({
                      entry,
                      answers,
                      runtime,
                      profile,
                      reasoningEffort: reviewerSetting.reasoningEffort ?? null,
                  });
        const evaluations = new Map(
            review?.evaluations.map((evaluation) => [
                evaluation.label,
                evaluation,
            ]) ?? []
        );
        records.push({
            schemaVersion: 1,
            rubricVersion: CONTEXT_ANSWER_REVIEW_RUBRIC_VERSION,
            caseId: entry.id,
            category: entry.category,
            reviewer: {
                profile: profile.id,
                provider: profile.provider,
                model: profile.providerModel,
                reasoningEffort: reviewerSetting.reasoningEffort ?? null,
            },
            answers: answers.map((answer) => {
                const replay = byMethod.get(answer.method)?.get(entry.id);
                return {
                    method: answer.method,
                    label: answer.label,
                    chatStatus: replay?.chat.status ?? 'not_run',
                    responseText: answer.text,
                    deterministicSupport: replay?.downstream ?? null,
                    evaluation: evaluations.get(answer.label) ?? null,
                };
            }),
            review,
        });
        console.log(
            `${entry.id} ${review?.status ?? 'not_run'} ${answers.length} answers`
        );
    }
    const serialized = records
        .map((record) => JSON.stringify(record))
        .join('\n');
    fs.writeFileSync(
        path.join(args.outputDirectory, 'answer-review.jsonl'),
        `${serialized}\n`,
        'utf8'
    );
    const disagreements = records.flatMap((record) =>
        record.answers.flatMap((answer) => {
            const deterministic = answer.deterministicSupport?.answerCorrect;
            const evaluation = answer.evaluation;
            if (deterministic === undefined || evaluation === null) return [];
            const reviewedCorrect =
                evaluation.sufficient &&
                evaluation.requiredFactCoverage >= 1 &&
                evaluation.referenceResolution !== 'incorrect' &&
                evaluation.unsupportedClaimCount === 0 &&
                !evaluation.distractorContamination;
            return deterministic === reviewedCorrect
                ? []
                : [
                      {
                          caseId: record.caseId,
                          category: record.category,
                          ...answer,
                          reviewedCorrect,
                      },
                  ];
        })
    );
    fs.writeFileSync(
        path.join(args.outputDirectory, 'disagreements.jsonl'),
        disagreements.map((item) => JSON.stringify(item)).join('\n') +
            (disagreements.length > 0 ? '\n' : ''),
        'utf8'
    );
    writeSummary(args.outputDirectory, records);
    console.log(
        JSON.stringify(
            { outputDirectory: args.outputDirectory, cases: records.length },
            null,
            2
        )
    );
};

const currentModulePath = fileURLToPath(import.meta.url);
if (
    process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === currentModulePath
) {
    main().catch((error: unknown) => {
        console.error(
            `[context-selection-answer-review] ${error instanceof Error ? error.message : String(error)}`
        );
        process.exitCode = 1;
    });
}
