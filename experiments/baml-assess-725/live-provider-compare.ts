/**
 * @description: Compares the current assess runtime with the isolated BAML prototype on synthetic live-provider inputs.
 * @footnote-scope: test
 * @footnote-module: BamlAssessLiveProviderComparison
 * @footnote-risk: high - Live model output can be mistaken for production compatibility evidence.
 * @footnote-ethics: high - Synthetic fixtures avoid sending private conversation content to the provider.
 */
import { Collector, setLogLevel } from '@boundaryml/baml';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { b } from './baml_client/index.js';
import type { ReviewDecision as BamlReviewDecision } from './baml_client/types.js';
import {
    type GenerationRequest,
    type GenerationResult,
} from '../../packages/agent-runtime/src/index.js';
import {
    createVoltAgentRuntime,
    type VoltAgentLogger,
} from '../../packages/agent-runtime/src/voltagentRuntime.js';
import {
    DEFAULT_REVIEW_DECISION_PROMPT,
    REVIEW_DECISION_STRUCTURED_OUTPUT,
    parseReviewDecisionOutputResult,
} from '../../packages/backend/src/services/workflowEngine/reviewDecision.js';

type Fixture = {
    id: string;
    draft: string;
    reviewContext: string;
};

type UsageSummary = {
    inputTokens: number | null;
    outputTokens: number | null;
};

type PathResult = {
    status: 'success' | 'error';
    latencyMs: number;
    decision?: unknown;
    classification?: string;
    model?: string;
    provider?: string;
    usage?: UsageSummary;
    errorName?: string;
    errorMessage?: string;
};

const FIXTURES: readonly Fixture[] = [
    {
        id: 'ready_finalize',
        draft: 'The local benchmark uses synthetic inputs and records its model revision.',
        reviewContext:
            'The draft is accurate, concise, and includes the required provenance detail.',
    },
    {
        id: 'missing_caveat',
        draft: 'The benchmark proves production latency is safe.',
        reviewContext:
            'The measurements came from one active workstation and do not establish production latency guarantees. Request a cautious correction.',
    },
    {
        id: 'bounded_revision',
        draft: 'The provider returned a structured result.',
        reviewContext:
            'The result should name the provider-path limitation and avoid claiming that BAML preserves Footnote failure taxonomy.',
    },
];

const silentLogger: VoltAgentLogger = {
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    child: () => silentLogger,
};

const toErrorFields = (
    error: unknown
): Pick<PathResult, 'errorName' | 'errorMessage'> => ({
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorMessage: error instanceof Error ? error.message : String(error),
});

const parseCurrentResult = (result: GenerationResult): PathResult => {
    const parsed = parseReviewDecisionOutputResult(result.text);
    return {
        status: parsed.isOk() ? 'success' : 'error',
        latencyMs: 0,
        ...(parsed.isOk()
            ? { decision: parsed.value, classification: 'success' }
            : { classification: parsed.error.reason }),
        model: result.model,
        provider: result.upstreamAttribution?.inferenceProvider,
        ...(result.usage === undefined
            ? {}
            : {
                  usage: {
                      inputTokens: result.usage.promptTokens ?? null,
                      outputTokens: result.usage.completionTokens ?? null,
                  },
              }),
    };
};

const runCurrentPath = async (fixture: Fixture): Promise<PathResult> => {
    const runtime = createVoltAgentRuntime({
        defaultModel: 'gpt-5-mini',
        logger: silentLogger,
    });
    const request: GenerationRequest = {
        provider: 'openai',
        model: 'gpt-5-mini',
        messages: [
            { role: 'system', content: DEFAULT_REVIEW_DECISION_PROMPT },
            {
                role: 'user',
                content: `Draft:\n${fixture.draft}\n\nReview context:\n${fixture.reviewContext}`,
            },
        ],
        maxOutputTokens: 256,
        reasoningEffort: 'low',
        verbosity: 'low',
        structuredOutput: REVIEW_DECISION_STRUCTURED_OUTPUT,
    };
    const started = performance.now();
    try {
        const result = await runtime.generate(request);
        const parsed = parseCurrentResult(result);
        return {
            ...parsed,
            latencyMs: performance.now() - started,
        };
    } catch (error) {
        return {
            status: 'error',
            latencyMs: performance.now() - started,
            ...toErrorFields(error),
        };
    }
};

const bamlUsage = (collector: Collector): UsageSummary | undefined => {
    const usage = collector.usage;
    if (usage.inputTokens === null && usage.outputTokens === null) {
        return undefined;
    }
    return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
    };
};

const runBamlPath = async (fixture: Fixture): Promise<PathResult> => {
    const collector = new Collector(`live-assess-${fixture.id}`);
    const started = performance.now();
    try {
        const decision: BamlReviewDecision = await b.Assess(
            fixture.draft,
            fixture.reviewContext,
            { collector }
        );
        const call = collector.last?.calls.at(-1);
        return {
            status: 'success',
            latencyMs: performance.now() - started,
            decision,
            classification: 'success',
            provider: call?.provider,
            usage: bamlUsage(collector),
        };
    } catch (error) {
        return {
            status: 'error',
            latencyMs: performance.now() - started,
            provider: collector.last?.calls.at(-1)?.provider,
            usage: bamlUsage(collector),
            ...toErrorFields(error),
        };
    }
};

const main = async (): Promise<void> => {
    assert.ok(
        process.env.OPENAI_API_KEY,
        'OPENAI_API_KEY must be set for the live provider comparison'
    );
    setLogLevel('error');

    const rows: Array<{
        fixture: string;
        current: PathResult;
        baml: PathResult;
    }> = [];
    for (const fixture of FIXTURES) {
        rows.push({
            fixture: fixture.id,
            current: await runCurrentPath(fixture),
            baml: await runBamlPath(fixture),
        });
    }

    console.log(
        JSON.stringify(
            {
                benchmark: 'baml_assess_live_provider_compare',
                provider: 'openai',
                model: 'gpt-5-mini',
                fixtureCount: FIXTURES.length,
                rows,
                note: 'Synthetic live calls only. Footnote routing, retries, cost authority, cancellation ownership, and TRACE persistence were not delegated to BAML.',
            },
            null,
            2
        )
    );
};

await main();
