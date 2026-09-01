/**
 * @description: Runs a redacted planner transport comparison across the configured strict and text paths.
 * @footnote-scope: utility
 * @footnote-module: PlannerComparisonHarness
 * @footnote-risk: medium - Live comparison calls can incur provider cost if explicitly enabled.
 * @footnote-ethics: high - Metrics must not retain prompts, outputs, secrets, or hidden reasoning.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createVoltAgentRuntime } from '@footnote/agent-runtime';
import type { PostChatRequest } from '@footnote/contracts/web';
import {
    createChatPlanner,
    type ChatPlannerInvocationContext,
} from '../packages/backend/src/services/chatPlanner.js';
import { chatPlannerDecisionStructuredOutput } from '../packages/backend/src/services/chatPlannerDecisionContract.js';
import { removePlannerTransportNulls } from '../packages/backend/src/services/plannerSchemaAdapter.js';

type ComparisonMode = 'deepseek_strict' | 'deepseek_text_json' | 'luna_strict';

type ComparisonMetric = {
    mode: ComparisonMode;
    status: 'executed' | 'failed' | 'skipped';
    validTransport: boolean;
    normalizationFallback: boolean;
    latencyMs: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    costUsd: number | null;
    actualProvider: string | null;
    actualModel: string | null;
    upstreamProvider: string | null;
    upstreamModel: string | null;
    fallbackFrequency: number;
    note?: string;
};

const invocationContext: ChatPlannerInvocationContext = {
    owner: 'workflow',
    workflowName: 'chat_orchestration',
    stepKind: 'plan',
    purpose: 'chat_orchestrator_action_selection',
};

const comparisonRequest: PostChatRequest = {
    surface: 'web',
    trigger: { kind: 'submit' },
    latestUserInput:
        'Compare the current planner fallback behavior with the strict provenance work, and identify which repository issue is still open.',
    conversation: [
        {
            role: 'user',
            content:
                'Compare the current planner fallback behavior with the strict provenance work, and identify which repository issue is still open.',
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
        };
    } | null,
    plannerResult: Awaited<ReturnType<ReturnType<typeof createChatPlanner>['planChat']>> | null,
    validTransport: boolean,
    note?: string
): ComparisonMetric => ({
    mode,
    status,
    validTransport,
    normalizationFallback:
        plannerResult?.execution.structuredOutputOutcome === 'policy_invalid' ||
        plannerResult?.execution.status === 'failed',
    latencyMs: runtimeResult ? Date.now() - startedAt : null,
    promptTokens: runtimeResult?.usage?.promptTokens ?? null,
    completionTokens: runtimeResult?.usage?.completionTokens ?? null,
    totalTokens: runtimeResult?.usage?.totalTokens ?? null,
    costUsd: plannerResult?.execution.cost?.totalCostUsd ?? null,
    actualProvider: mode === 'luna_strict' ? 'openai' : 'openrouter',
    actualModel: runtimeResult?.model ?? null,
    upstreamProvider: runtimeResult?.upstreamAttribution?.inferenceProvider ?? null,
    upstreamModel: runtimeResult?.upstreamAttribution?.resolvedModel ?? null,
    fallbackFrequency: plannerResult?.execution.status === 'failed' ? 1 : 0,
    ...(note !== undefined && { note }),
});

const runComparison = async (
    mode: ComparisonMode
): Promise<ComparisonMetric> => {
    const isLuna = mode === 'luna_strict';
    const runtime = createVoltAgentRuntime({
        defaultModel: isLuna ? 'gpt-5.6-luna' : 'deepseek/deepseek-v4-flash-0731',
        openrouter: {
            apiKey: process.env.OPENROUTER_API_KEY,
        },
    });
    let runtimeResult: Awaited<ReturnType<typeof runtime.generate>> | null = null;
    const startedAt = Date.now();
    const planner = createChatPlanner({
        executePlanner: async ({ messages, maxOutputTokens, reasoningEffort, verbosity }) => {
            runtimeResult = await runtime.generate({
                messages,
                model: isLuna ? 'gpt-5.6-luna' : 'deepseek/deepseek-v4-flash-0731',
                provider: isLuna ? 'openai' : 'openrouter',
                maxOutputTokens,
                reasoningEffort,
                verbosity,
            });
            return {
                text: runtimeResult.text,
                model: runtimeResult.model,
                usage: runtimeResult.usage,
            };
        },
        ...(mode !== 'deepseek_text_json' && {
            executePlannerStructured: async ({ messages, maxOutputTokens, reasoningEffort, verbosity }) => {
                runtimeResult = await runtime.generate({
                    messages,
                    model: isLuna ? 'gpt-5.6-luna' : 'deepseek/deepseek-v4-flash-0731',
                    provider: isLuna ? 'openai' : 'openrouter',
                    maxOutputTokens,
                    reasoningEffort,
                    verbosity,
                    structuredOutput: chatPlannerDecisionStructuredOutput,
                });
                const decision = JSON.parse(runtimeResult.text) as unknown;
                return {
                    decision: removePlannerTransportNulls(decision),
                    model: runtimeResult.model,
                    usage: runtimeResult.usage,
                };
            },
        }),
    });

    try {
        const plannerResult = await planner.planChat(
            comparisonRequest,
            invocationContext
        );
        return readMetric(
            mode,
            plannerResult.execution.status,
            startedAt,
            runtimeResult,
            plannerResult,
            runtimeResult !== null
        );
    } catch (error) {
        return readMetric(
            mode,
            'failed',
            startedAt,
            runtimeResult,
            null,
            false,
            error instanceof Error ? error.name : 'runtime_error'
        );
    }
};

const statusPath = path.resolve(
    'docs/status/planner-strict-provenance-comparison.md'
);

const writeStatus = (metrics: ComparisonMetric[]): void => {
    const generatedAt = new Date().toISOString();
    const lines = [
        '# Planner strict-output comparison',
        '',
        `Generated: ${generatedAt}`,
        '',
        'This file contains redacted transport metrics only. Raw prompts, model outputs, secrets, and hidden reasoning are never written.',
        '',
        '| Mode | Status | Valid transport | Normalization/fallback | Latency ms | Tokens (prompt/completion/total) | Cost USD | Actual provider/model | Upstream provider/model | Fallback frequency |',
        '| --- | --- | ---: | ---: | ---: | --- | ---: | --- | --- | ---: |',
        ...metrics.map((metric) =>
            `| ${metric.mode} | ${metric.status} | ${metric.validTransport ? 'yes' : 'no'} | ${metric.normalizationFallback ? 'yes' : 'no'} | ${metric.latencyMs ?? 'n/a'} | ${metric.promptTokens ?? 'n/a'}/${metric.completionTokens ?? 'n/a'}/${metric.totalTokens ?? 'n/a'} | ${metric.costUsd ?? 'n/a'} | ${metric.actualProvider ?? 'n/a'}/${metric.actualModel ?? 'n/a'} | ${metric.upstreamProvider ?? 'n/a'}/${metric.upstreamModel ?? 'n/a'} | ${metric.fallbackFrequency} |`
        ),
        '',
        'DeepSeek remains the configured planner preference. Change it only after measured evidence and an explicit follow-up decision.',
    ];
    fs.writeFileSync(statusPath, `${lines.join('\n')}\n`, 'utf8');
};

const main = async (): Promise<void> => {
    if (!process.argv.includes('--live')) {
        console.log('Planner comparison not run. Pass --live with provider credentials to collect redacted metrics.');
        return;
    }
    const metrics = await Promise.all([
        runComparison('deepseek_strict'),
        runComparison('deepseek_text_json'),
        runComparison('luna_strict'),
    ]);
    writeStatus(metrics);
    console.log(`Wrote redacted planner comparison metrics to ${statusPath}`);
};

void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
