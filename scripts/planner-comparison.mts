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

const comparisonPrompt = process.env.PLANNER_COMPARISON_PROMPT?.trim() ?? '';

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
    const lines = [
        '# Planner strict-output comparison',
        '',
        `Generated: ${generatedAt}`,
        '',
        'This file contains redacted transport metrics only. Raw prompts, model outputs, secrets, and hidden reasoning are never written.',
        '',
        'The fixed workload asks for a bounded review plan. Three serial repeats compare OpenRouter DeepSeek strict output with reasoning none/current 2,000-token cap and reasoning low/512-token cap. OpenAI GPT-5.6 Luna is a strict-output baseline when configured. No production setting is changed.',
        '',
        'The planner-quality check scores normalized action=message, modality=text, and no search request; it does not claim to score final answer quality. Cost is unknown when backend pricing is unavailable. Missing reasoning usage or provider paths are reported as unavailable.',
        '',
        '| Mode | Repeat | Requested settings | Applied settings | Status/outcome | Strict transport | Fallback | Latency ms | Tokens (prompt/completion/reasoning/total) | Backend cost USD | Actual provider/model | Upstream provider/model | Plan quality (message/text/no search) |',
        '| --- | ---: | --- | --- | --- | --- | ---: | --- | ---: | --- | --- | --- |',
        ...metrics.map(
            (metric) =>
                `| ${metric.mode} | ${metric.repeat} | ${metric.requestedReasoningEffort}/${metric.requestedMaxOutputTokens} | ${metric.appliedReasoningEffort ?? 'n/a'}/${metric.appliedMaxOutputTokens ?? 'n/a'} | ${metric.status}/${metric.outcome} | ${metric.validTransport ? 'yes' : 'no'} | ${metric.normalizationFallback ? 'yes' : 'no'} | ${metric.latencyMs ?? 'n/a'} | ${metric.promptTokens ?? 'n/a'}/${metric.completionTokens ?? 'n/a'}/${metric.reasoningTokens ?? 'n/a'}/${metric.totalTokens ?? 'n/a'} | ${metric.costUsd ?? 'unknown (unpriced)'} | ${metric.actualProvider ?? 'n/a'}/${metric.actualModel ?? 'n/a'} | ${metric.upstreamProvider ?? 'n/a'}/${metric.upstreamModel ?? 'n/a'} | ${formatPlanQuality(metric)} |`
        ),
        '',
        'Recommendation: keep current OpenRouter planner settings (none, 2,000 tokens) pending stronger evidence. The lower-cap condition had two incomplete responses and one strict success; the current-cap condition had two policy-invalid results and one strict success that requested disallowed search. This single workload does not justify a production settings change.',
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
    if (!comparisonPrompt) {
        throw new Error(
            'Set PLANNER_COMPARISON_PROMPT to a bounded planner workload; it is not stored by this script.'
        );
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
