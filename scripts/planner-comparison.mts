/**
 * @description: Runs a serial, redacted planner settings comparison against live provider paths.
 * @footnote-scope: utility
 * @footnote-module: PlannerComparisonHarness
 * @footnote-risk: medium - Live comparison calls can incur provider cost if explicitly enabled.
 * @footnote-ethics: high - Metrics must not retain prompts, outputs, secrets, or hidden reasoning.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createVoltAgentRuntime } from '@footnote/agent-runtime';
import type { PostChatRequest } from '@footnote/contracts/web';
import { runtimeConfig } from '../packages/backend/src/config.js';
import {
    createChatPlanner,
    type ChatPlannerInvocationContext,
} from '../packages/backend/src/services/chatPlanner.js';
import { resolveModelSettings } from '../packages/backend/src/services/runtimeRequestControls.js';
import { chatPlannerDecisionStructuredOutput } from '../packages/backend/src/services/chatPlannerDecisionContract.js';
import { removePlannerTransportNulls } from '../packages/backend/src/services/plannerSchemaAdapter.js';

type ComparisonMode = 'deepseek_none_2000' | 'deepseek_low_512' | 'luna_strict';

const classifyRuntimeFailure = (error: unknown): string => {
    if (typeof error !== 'object' || error === null) return 'runtime_failure';
    const candidate = error as {
        code?: unknown;
        message?: unknown;
        cause?: unknown;
        details?: { classification?: unknown };
    };
    const cause =
        typeof candidate.cause === 'object' && candidate.cause !== null
            ? (candidate.cause as { code?: unknown; message?: unknown })
            : undefined;
    const message = [candidate.message, cause?.message]
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
    if (
        candidate.code === 'STRUCTURED_OUTPUT_NOT_GENERATED' ||
        cause?.code === 'STRUCTURED_OUTPUT_NOT_GENERATED' ||
        message.includes('no final output was generated')
    ) {
        if (message.includes('finishReason: length')) {
            return 'incomplete_output_length';
        }
        return message.includes('finishReason: other')
            ? 'incomplete_output_other'
            : 'incomplete_output';
    }
    if (message.includes('uniqueItems')) {
        return 'schema_rejected_unique_items';
    }
    if (candidate.details?.classification === 'structured_output_unavailable') {
        return 'structured_output_unavailable';
    }
    return 'runtime_failure';
};

type ComparisonMetric = {
    mode: ComparisonMode;
    repeat: number;
    status: 'executed' | 'failed' | 'skipped';
    requestedReasoningEffort: 'none' | 'low';
    requestedMaxOutputTokens: number;
    appliedReasoningEffort: string | null;
    appliedMaxOutputTokens: number | null;
    outcome: string;
    validTransport: boolean;
    normalizationFallback: boolean;
    latencyMs: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    reasoningTokens: number | null;
    costUsd: number | null;
    actualProvider: string | null;
    actualModel: string | null;
    upstreamProvider: string | null;
    upstreamModel: string | null;
    planAction: string | null;
    planModality: string | null;
    unnecessarySearch: boolean | null;
    note?: string;
};

const invocationContext: Omit<ChatPlannerInvocationContext, 'maxOutputTokens'> =
    {
        owner: 'workflow',
        workflowName: 'chat_orchestration',
        stepKind: 'plan',
        purpose: 'chat_orchestrator_action_selection',
    };

const comparisonPrompt =
    'Please draft three concise checks I can use when reviewing a small change that fixes Markdown table alignment and adds a regression test. Keep it self-contained; do not use search or tools.';

const comparisonRequest: PostChatRequest = {
    surface: 'web',
    trigger: { kind: 'submit' },
    latestUserInput: comparisonPrompt,
    conversation: [
        {
            role: 'user',
            content: comparisonPrompt,
        },
    ],
    capabilities: {
        canReact: false,
        canGenerateImages: false,
        canUseTts: false,
    },
};

const readMetric = (
    mode: ComparisonMode,
    repeat: number,
    status: ComparisonMetric['status'],
    startedAt: number,
    runtimeResult: {
        model?: string;
        upstreamAttribution?: {
            inferenceProvider?: string;
            resolvedModel?: string;
        };
        usage?: {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
            reasoningTokens?: number;
        };
    } | null,
    plannerResult: Awaited<
        ReturnType<ReturnType<typeof createChatPlanner>['planChat']>
    > | null,
    note?: string,
    appliedSettings?: {
        reasoningEffort?: string;
        maxOutputTokens?: number;
    }
): ComparisonMetric => {
    const structuredOutputOutcome =
        plannerResult?.execution.structuredOutputOutcome;
    const plannerSucceeded = plannerResult?.execution.status === 'executed';
    const strictSuccess =
        plannerSucceeded && structuredOutputOutcome === 'strict_success';
    const fallbackOccurred =
        plannerResult === null ||
        plannerResult?.execution.status === 'failed' ||
        structuredOutputOutcome === 'policy_invalid';

    return {
        mode,
        repeat,
        status,
        requestedReasoningEffort:
            mode === 'deepseek_none_2000' ? 'none' : 'low',
        requestedMaxOutputTokens: mode === 'deepseek_low_512' ? 512 : 2_000,
        appliedReasoningEffort: appliedSettings?.reasoningEffort ?? null,
        appliedMaxOutputTokens: appliedSettings?.maxOutputTokens ?? null,
        outcome:
            structuredOutputOutcome ??
            note ??
            plannerResult?.execution.reasonCode ??
            (plannerSucceeded ? 'success' : 'unknown'),
        validTransport: strictSuccess,
        normalizationFallback: fallbackOccurred,
        latencyMs: Date.now() - startedAt,
        promptTokens: runtimeResult?.usage?.promptTokens ?? null,
        completionTokens: runtimeResult?.usage?.completionTokens ?? null,
        totalTokens: runtimeResult?.usage?.totalTokens ?? null,
        reasoningTokens: runtimeResult?.usage?.reasoningTokens ?? null,
        costUsd:
            (plannerResult?.execution.cost?.totalCostUsd ?? 0) > 0
                ? (plannerResult?.execution.cost?.totalCostUsd ?? null)
                : null,
        actualProvider:
            runtimeResult === null
                ? null
                : mode === 'luna_strict'
                  ? 'openai'
                  : 'openrouter',
        actualModel: runtimeResult?.model ?? null,
        upstreamProvider:
            runtimeResult?.upstreamAttribution?.inferenceProvider ?? null,
        upstreamModel:
            runtimeResult?.upstreamAttribution?.resolvedModel ?? null,
        planAction: plannerSucceeded ? plannerResult.plan.action : null,
        planModality: plannerSucceeded ? plannerResult.plan.modality : null,
        unnecessarySearch: plannerSucceeded
            ? plannerResult.plan.generation.search !== undefined
            : null,
        ...(note !== undefined && { note }),
    };
};

const runComparison = async (
    mode: ComparisonMode,
    repeat: number
): Promise<ComparisonMetric> => {
    const isLuna = mode === 'luna_strict';
    const provider = isLuna ? 'openai' : 'openrouter';
    const requestedModel = isLuna
        ? 'gpt-5.6-luna'
        : 'deepseek/deepseek-v4-flash-0731';
    const profile = runtimeConfig.modelProfiles.catalog.find(
        (candidate) =>
            candidate.enabled &&
            candidate.provider === provider &&
            candidate.providerModel === requestedModel
    );
    if (!profile) {
        return readMetric(
            mode,
            repeat,
            'skipped',
            Date.now(),
            null,
            null,
            'profile_unavailable'
        );
    }
    const settingsResolution = resolveModelSettings({
        profile,
        request: {
            reasoningEffort: mode === 'deepseek_none_2000' ? 'none' : 'low',
            maxOutputTokens: mode === 'deepseek_low_512' ? 512 : 2_000,
        },
    });
    const runtime = createVoltAgentRuntime({
        defaultModel: profile.providerModel,
        openrouter: {
            apiKey: process.env.OPENROUTER_API_KEY,
        },
    });
    let runtimeResult: Awaited<ReturnType<typeof runtime.generate>> | null =
        null;
    const startedAt = Date.now();
    let runtimeFailureOutcome: string | undefined;
    const planner = createChatPlanner({
        plannerReasoningEffort: settingsResolution.applied.reasoningEffort,
        defaultModel: profile.providerModel,
        executePlannerStructured: async ({
            messages,
            maxOutputTokens,
            reasoningEffort,
            verbosity,
        }) => {
            try {
                runtimeResult = await runtime.generate({
                    messages,
                    model: profile.providerModel,
                    provider: profile.provider,
                    maxOutputTokens,
                    reasoningEffort,
                    verbosity,
                    capabilities: profile.capabilities,
                    providerRouting: profile.providerRouting,
                    structuredOutput: chatPlannerDecisionStructuredOutput,
                });
            } catch (error) {
                runtimeFailureOutcome = classifyRuntimeFailure(error);
                throw error;
            }
            const decision = JSON.parse(runtimeResult.text) as unknown;
            return {
                decision: removePlannerTransportNulls(decision),
                model: runtimeResult.model,
                usage: runtimeResult.usage,
                upstreamAttribution: runtimeResult.upstreamAttribution,
            };
        },
    });

    try {
        const plannerResult = await planner.planChat(comparisonRequest, {
            ...invocationContext,
            maxOutputTokens: settingsResolution.applied.maxOutputTokens,
        });
        return readMetric(
            mode,
            repeat,
            plannerResult.execution.status,
            startedAt,
            runtimeResult,
            plannerResult,
            runtimeFailureOutcome,
            settingsResolution.applied
        );
    } catch (error) {
        return readMetric(
            mode,
            repeat,
            'failed',
            startedAt,
            runtimeResult,
            null,
            runtimeFailureOutcome ?? classifyRuntimeFailure(error),
            settingsResolution.applied
        );
    }
};

const statusPath = path.resolve(
    'docs/status/planner-strict-provenance-comparison.md'
);

const formatPlanQuality = (metric: ComparisonMetric): string => {
    if (metric.planAction === null || metric.planModality === null) {
        return 'n/a';
    }
    return metric.planAction === 'message' &&
        metric.planModality === 'text' &&
        metric.unnecessarySearch === false
        ? 'pass'
        : 'fail';
};

const writeStatus = (metrics: ComparisonMetric[]): void => {
    const generatedAt = new Date().toISOString();
    const summarizeDeepSeek = (
        mode: 'deepseek_none_2000' | 'deepseek_low_512'
    ): {
        attempts: number;
        strictSuccesses: number;
        planningPasses: number;
    } => {
        const rows = metrics.filter((metric) => metric.mode === mode);
        return {
            attempts: rows.length,
            strictSuccesses: rows.filter((metric) => metric.validTransport)
                .length,
            planningPasses: rows.filter(
                (metric) => formatPlanQuality(metric) === 'pass'
            ).length,
        };
    };
    const currentCap = summarizeDeepSeek('deepseek_none_2000');
    const lowerCap = summarizeDeepSeek('deepseek_low_512');
    const lowerCapImproved =
        lowerCap.strictSuccesses > currentCap.strictSuccesses ||
        (lowerCap.strictSuccesses === currentCap.strictSuccesses &&
            lowerCap.planningPasses > currentCap.planningPasses);
    const lines = [
        '# Planner strict-output comparison',
        '',
        `Generated: ${generatedAt}`,
        '',
        'This file contains redacted transport metrics only. Raw prompts, model outputs, secrets, and hidden reasoning are never written.',
        '',
        'The synthetic workload is fixed in `scripts/planner-comparison.mts`:',
        '',
        `> ${comparisonPrompt}`,
        '',
        'It expects `message`/`text` with no search because the user requests a direct written checklist about a self-contained change and explicitly rules out search and tools. Three serial repeats compare OpenRouter DeepSeek strict output with reasoning `none`/the current 2,000-token cap and `low`/512 tokens. OpenAI GPT-5.6 Luna (`low`/2,000 tokens) is the existing strict-output baseline. No production setting is changed.',
        '',
        'The planner-quality check scores normalized action=message, modality=text, and no search request; it does not claim to score final answer quality. Cost is unknown when backend pricing is unavailable. Missing reasoning usage or provider paths are reported as unavailable.',
        '',
        '| Mode | Repeat | Requested settings | Applied settings | Status/outcome | Strict transport | Fallback | Latency ms | Tokens (prompt/completion/reasoning/total) | Backend cost USD | Actual provider/model | Upstream provider/model | Plan quality (message/text/no search) |',
        '| --- | ---: | --- | --- | --- | --- | ---: | --- | --- | ---: | --- | --- | --- |',
        ...metrics.map(
            (metric) =>
                `| ${metric.mode} | ${metric.repeat} | ${metric.requestedReasoningEffort}/${metric.requestedMaxOutputTokens} | ${metric.appliedReasoningEffort ?? 'n/a'}/${metric.appliedMaxOutputTokens ?? 'n/a'} | ${metric.status}/${metric.outcome} | ${metric.validTransport ? 'yes' : 'no'} | ${metric.normalizationFallback ? 'yes' : 'no'} | ${metric.latencyMs ?? 'n/a'} | ${metric.promptTokens ?? 'n/a'}/${metric.completionTokens ?? 'n/a'}/${metric.reasoningTokens ?? 'n/a'}/${metric.totalTokens ?? 'n/a'} | ${metric.costUsd ?? 'unknown (unpriced)'} | ${metric.actualProvider ?? 'n/a'}/${metric.actualModel ?? 'n/a'} | ${metric.upstreamProvider ?? 'n/a'}/${metric.upstreamModel ?? 'n/a'} | ${formatPlanQuality(metric)} |`
        ),
        '',
        `On this fixed workload, the current none/2,000 condition had ${currentCap.strictSuccesses}/${currentCap.attempts} strict successes and ${currentCap.planningPasses}/${currentCap.attempts} planning passes; the low/512 condition had ${lowerCap.strictSuccesses}/${lowerCap.attempts} strict successes and ${lowerCap.planningPasses}/${lowerCap.attempts} planning passes. ${lowerCapImproved ? 'The lower-cap condition showed stronger outcomes on this workload, but one synthetic workload does not justify a production change.' : 'The lower-cap condition did not establish superior reliability, so this experiment supports no production change.'}`,
        '',
        'An earlier run used an unretained transient prompt and recorded two policy-invalid current-cap results and two incomplete lower-cap results. Those failures are noted for context and are not attributed to this reproducible workload.',
        '',
        'The Luna baseline was rejected before a model response because the provider schema does not permit `uniqueItems`.',
    ];
    fs.writeFileSync(statusPath, `${lines.join('\n')}\n`, 'utf8');
};

const main = async (): Promise<void> => {
    if (!process.argv.includes('--live')) {
        console.log(
            'Planner comparison not run. Pass --live with provider credentials to collect redacted metrics.'
        );
        return;
    }
    const metrics: ComparisonMetric[] = [];
    for (const mode of [
        'deepseek_none_2000',
        'deepseek_low_512',
        'luna_strict',
    ] as const) {
        for (let repeat = 1; repeat <= 3; repeat += 1) {
            metrics.push(await runComparison(mode, repeat));
        }
    }
    writeStatus(metrics);
    console.log(`Wrote redacted planner comparison metrics to ${statusPath}`);
};

void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
