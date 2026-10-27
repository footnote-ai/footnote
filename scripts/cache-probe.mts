/**
 * @description: Runs a bounded synthetic prefix-caching comparison through the real runtime adapters.
 * @footnote-scope: test
 * @footnote-module: CacheProbe
 * @footnote-risk: high - Live mode makes paid model requests under a shared conservative allowance.
 * @footnote-ethics: high - Reports contain measurements, never prompts, responses, credentials, or caller data.
 */
import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createVoltAgentRuntime,
    isGenerationRuntimeError,
    type GenerationRequest,
    type GenerationResult,
} from '../packages/agent-runtime/src/index.js';
import type {
    ModelProfile,
    PromptCachePolicy,
} from '../packages/contracts/src/index.js';
import {
    resolveOpenAITextPricingModel,
    openAITextPricingTable,
} from '../packages/contracts/src/pricing.js';
import { applyPromptCaching } from '../packages/backend/src/services/workflowEngine/promptCaching.js';
import { estimateBackendTextCost } from '../packages/backend/src/services/llmCostRecorder.js';
import { renderConversationPromptLayers } from '../packages/backend/src/services/prompts/conversationPromptLayers.js';
import {
    composeAssessPrompt,
    composeRefinementPrompt,
} from '../packages/backend/src/services/prompts/reviewPromptComposer.js';
import { renderPrompt } from '../packages/backend/src/services/prompts/promptRegistry.js';
import {
    reserveCacheProbeRequest,
    type CacheProbeBudget,
    type CacheProbePricing,
} from './lib/cache-probe-budget.js';
import {
    readCacheProbeCommit,
    resolveCacheProbeGit,
} from './lib/cache-probe-git.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = process.argv.slice(2);
if (
    flags.length > 1 ||
    (flags.length === 1 && !['--check', '--live'].includes(flags[0]!))
)
    throw new Error('Usage: pnpm cache:probe [--check | --live]');
const live = flags[0] === '--live';
const gitExecutable = resolveCacheProbeGit(process.platform);
const commit = readCacheProbeCommit(gitExecutable, root);
const budget: CacheProbeBudget = { calls: 0, reservedUsd: 0 };
const output = path.join(root, 'docs/status/prompt-cache-probe.json');
// Do not overlap manual --live runs; they share this checkpoint and budget.
const previous =
    live && fs.existsSync(output)
        ? (JSON.parse(fs.readFileSync(output, 'utf8')) as {
              experimentId: string;
              budget: CacheProbeBudget;
              samples: typeof samples;
          })
        : undefined;
if (previous !== undefined) {
    if (
        !Number.isSafeInteger(previous.budget.calls) ||
        previous.budget.calls < 0 ||
        previous.budget.calls > 60 ||
        !Number.isFinite(previous.budget.reservedUsd) ||
        previous.budget.reservedUsd < 0 ||
        previous.budget.reservedUsd > 2
    )
        throw new Error('Invalid probe checkpoint.');
    Object.assign(budget, previous.budget);
}
const experimentId = previous?.experimentId ?? randomUUID();
const purposes: PromptCachePolicy['purpose'][] = [
    'planner',
    'generation',
    'assessment',
    'revision',
    'presentation',
];
const profiles: ModelProfile[] = [
    {
        id: 'cache-probe-openai',
        description: 'Synthetic cache probe',
        provider: 'openai',
        providerModel: 'gpt-5.6-luna',
        enabled: true,
        tierBindings: [],
        capabilities: { canUseSearch: false },
    },
    {
        id: 'cache-probe-openrouter',
        description: 'Synthetic cache probe',
        provider: 'openrouter',
        providerModel: 'deepseek/deepseek-v4-flash-0731',
        enabled: true,
        tierBindings: [],
        capabilities: { canUseSearch: false },
        providerRouting: { openrouter: { allowFallbacks: false } },
    },
];
const pricing = new Map<string, CacheProbePricing>();
const preflight: Array<{
    provider: string;
    model: string;
    credentialsAvailable: boolean;
    pricingAvailable: boolean;
}> = [];
const samples: Array<{
    fixtureId: string;
    provider: string;
    model: string;
    purpose: PromptCachePolicy['purpose'];
    variant: string;
    repeat: number;
    durationMs: number;
    observedProvider?: string;
    observedModel?: string;
    status: 'measured' | 'failed';
    failure?: string;
    usage?: GenerationResult['usage'];
    cache?: GenerationResult['promptCache'];
    estimate?: ReturnType<typeof estimateBackendTextCost>;
    upstreamReportedCostUsd?: number;
}> = [];

if (previous !== undefined) samples.push(...previous.samples);

const baseLayers = renderConversationPromptLayers('web-chat');
const fixture = (
    profile: ModelProfile,
    purpose: PromptCachePolicy['purpose'],
    variant: string,
    control: string,
    repeat: number
): GenerationRequest => {
    const instruction =
        purpose === 'planner'
            ? renderPrompt('chat.planner.text_json.system').content
            : purpose === 'assessment'
              ? composeAssessPrompt({}).prompt
              : purpose === 'revision'
                ? composeRefinementPrompt({}).prompt
                : purpose === 'presentation'
                  ? 'Rewrite the supplied answer faithfully. Keep its facts and limits unchanged.'
                  : baseLayers.systemPrompt;
    const longReference =
        control === 'ordinary'
            ? ''
            : '\n' +
              'Synthetic reference: the fixture library has blue shelves, numbered books, and a quiet reading room. '.repeat(
                  512
              );
    const changed =
        control === 'invalidated' ? ' Changed trusted fixture version.' : '';
    const request: GenerationRequest = {
        provider: profile.provider,
        model: profile.providerModel,
        capabilities: profile.capabilities,
        providerRouting: profile.providerRouting,
        maxOutputTokens: 512,
        reasoningEffort: 'none',
        messages: [
            {
                role: 'system',
                cacheable: true,
                content: `Synthetic cache experiment ${experimentId}; arm ${variant}; purpose ${purpose}.\n${instruction}${longReference}${changed}`,
            },
            {
                role: 'system',
                content:
                    'Effective request time: 2026-10-27T00:00:00.000Z (UTC). This is a synthetic fixture.',
            },
            {
                role: 'user',
                content:
                    control === 'changed_suffix'
                        ? 'The synthetic library closes at six. Reply briefly.'
                        : 'The synthetic library closes at five. Reply briefly.',
            },
        ],
    };
    // Repeat index never enters the prefix; ordinary and long controls are reported separately.
    void repeat;
    return applyPromptCaching(
        request,
        {
            ...profile,
            promptCaching: {
                enabled: variant === 'candidate',
                ttlSeconds: 1800,
            },
        },
        purpose,
        'web'
    );
};

const run = async (): Promise<void> => {
    const originalFetch = globalThis.fetch;
    const openAiPricing =
        resolveOpenAITextPricingModel('gpt-5.6-luna').matchedModel;
    if (openAiPricing !== null) {
        const rate = openAITextPricingTable[openAiPricing];
        pricing.set('gpt-5.6-luna', {
            inputPerToken: rate.input / 1e6,
            outputPerToken: rate.output / 1e6,
        });
    }
    // Read-only router catalog; unknown or unavailable prices prevent paid calls.
    try {
        const response = await originalFetch(
            'https://openrouter.ai/api/v1/models',
            { signal: AbortSignal.timeout(10000) }
        );
        const catalog = (await response.json()) as {
            data?: Array<{
                id: string;
                pricing?: { prompt?: string; completion?: string };
            }>;
        };
        const rate = catalog.data?.find(
            (item) => item.id === profiles[1]!.providerModel
        )?.pricing;
        if (rate?.prompt?.trim() && rate.completion?.trim()) {
            const inputPerToken = Number(rate.prompt),
                outputPerToken = Number(rate.completion);
            if (
                Number.isFinite(inputPerToken) &&
                inputPerToken >= 0 &&
                Number.isFinite(outputPerToken) &&
                outputPerToken >= 0
            )
                pricing.set(profiles[1]!.providerModel, {
                    inputPerToken,
                    outputPerToken,
                });
        }
    } catch {
        /* Unknown prices remain a preflight failure, never a zero-cost assumption. */
    }
    for (const profile of profiles)
        preflight.push({
            provider: profile.provider,
            model: profile.providerModel,
            credentialsAvailable: Boolean(
                profile.provider === 'openai'
                    ? process.env.OPENAI_API_KEY
                    : process.env.OPENROUTER_API_KEY
            ),
            pricingAvailable: pricing.has(profile.providerModel),
        });
    if (!live) {
        console.log(
            JSON.stringify(
                {
                    mode: 'check',
                    preflight,
                    maxCalls: 60,
                    maxEstimatedUsd: 2,
                    billedCalls: 0,
                },
                null,
                2
            )
        );
        return;
    }
    const checkpoint = () => ({
        experimentId,
        reportSourceDigest: createHash('sha256')
            .update(
                [
                    'scripts/cache-probe.mts',
                    'packages/agent-runtime/src/voltagentRuntime.ts',
                    'packages/backend/src/services/workflowEngine/promptCaching.ts',
                ]
                    .map((file) =>
                        fs.readFileSync(path.join(root, file), 'utf8')
                    )
                    .join('\n')
            )
            .digest('hex'),
        capturedAt: new Date().toISOString(),
        commit,
        fixtureVersion: 1,
        synthetic: true,
        limits: { maxCalls: 60, maxEstimatedUsd: 2 },
        budget,
        preflight,
        pricingSources: [
            'checked-in OpenAI pricing table',
            'https://openrouter.ai/api/v1/models',
        ],
        pricing: Object.fromEntries(pricing),
        samples,
        limitations: [
            'Synthetic fixtures are not production hit-rate evidence.',
            'OpenRouter upstream charges remain separate from backend estimates.',
            'Missing credentials, rates, or measurements leave provider verification pending.',
        ],
        deliberateCachingEnabledByDefault: false,
    });
    const persist = (): void => {
        const temporary = output + '.tmp';
        fs.writeFileSync(
            temporary,
            JSON.stringify(checkpoint(), null, 2) + '\n'
        );
        fs.renameSync(temporary, output);
    };
    globalThis.fetch = async (input, init) => {
        const url = new URL(
            typeof input === 'string' || input instanceof URL
                ? String(input)
                : input.url
        );
        const method =
            init?.method ?? (input instanceof Request ? input.method : 'GET');
        if (method.toUpperCase() === 'POST') {
            const bodyText =
                typeof init?.body === 'string'
                    ? init.body
                    : input instanceof Request
                      ? await input.clone().text()
                      : undefined;
            if (
                !['api.openai.com', 'openrouter.ai'].includes(url.hostname) ||
                bodyText === undefined
            )
                throw new Error('Probe refuses an unexpected paid transport.');
            const body = JSON.parse(bodyText) as { model?: string };
            const rate =
                body.model === undefined ? undefined : pricing.get(body.model);
            if (rate === undefined)
                throw new Error('Probe refuses unknown model pricing.');
            reserveCacheProbeRequest(budget, bodyText, rate);
            persist();
        }
        return originalFetch(input, init);
    };
    try {
        for (const [index, profile] of profiles.entries()) {
            const ready = preflight[index]!;
            if (!ready.credentialsAvailable || !ready.pricingAvailable)
                continue;
            const runtime = createVoltAgentRuntime({
                defaultModel: profile.providerModel,
                openrouter: process.env.OPENROUTER_API_KEY
                    ? {
                          apiKey: process.env.OPENROUTER_API_KEY,
                          baseUrl: 'https://openrouter.ai/api/v1',
                      }
                    : undefined,
            });
            const matrix = purposes.flatMap((purpose) =>
                ['baseline', 'candidate'].flatMap((variant) =>
                    [0, 1].map((repeat) => ({
                        purpose,
                        variant,
                        repeat,
                        control: 'ordinary',
                    }))
                )
            );
            matrix.push(
                ...['baseline', 'candidate'].flatMap((variant) =>
                    [0, 1].map((repeat) => ({
                        purpose: 'generation' as const,
                        variant,
                        repeat,
                        control: 'long_positive_control',
                    }))
                )
            );
            matrix.push(
                ...['changed_suffix', 'invalidated'].map((control) => ({
                    purpose: 'generation' as const,
                    variant: 'candidate',
                    repeat: 2,
                    control,
                }))
            );
            for (const cell of matrix) {
                if (
                    samples.some(
                        (sample) =>
                            sample.model === profile.providerModel &&
                            sample.purpose === cell.purpose &&
                            sample.variant === cell.variant &&
                            sample.repeat === cell.repeat &&
                            sample.fixtureId === `v1:${cell.control}`
                    )
                )
                    continue;
                const started = Date.now();
                try {
                    const result = await runtime.generate({
                        ...fixture(
                            profile,
                            cell.purpose,
                            cell.variant,
                            cell.control,
                            cell.repeat
                        ),
                        signal: AbortSignal.timeout(45000),
                    });
                    const estimate = estimateBackendTextCost(
                        result.model ?? profile.providerModel,
                        result.usage?.promptTokens,
                        result.usage?.completionTokens,
                        result.usage
                    );
                    samples.push({
                        fixtureId: `v1:${cell.control}`,
                        provider: profile.provider,
                        model: profile.providerModel,
                        purpose: cell.purpose,
                        variant: cell.variant,
                        repeat: cell.repeat,
                        durationMs: Date.now() - started,
                        status: 'measured',
                        observedProvider:
                            result.upstreamAttribution?.inferenceProvider,
                        observedModel:
                            result.upstreamAttribution?.resolvedModel ??
                            result.model,
                        usage: result.usage,
                        cache: result.promptCache,
                        estimate,
                        upstreamReportedCostUsd:
                            result.upstreamAttribution?.upstreamReportedCostUsd,
                    });
                } catch (error) {
                    const runtimeError = isGenerationRuntimeError(error)
                        ? error
                        : undefined;
                    samples.push({
                        fixtureId: `v1:${cell.control}`,
                        provider: profile.provider,
                        model: profile.providerModel,
                        purpose: cell.purpose,
                        variant: cell.variant,
                        repeat: cell.repeat,
                        durationMs: Date.now() - started,
                        status: 'failed',
                        failure:
                            runtimeError !== undefined
                                ? runtimeError.details.classification
                                : 'request_failed_or_budget_exhausted',
                        ...(runtimeError?.usage !== undefined && {
                            usage: runtimeError.usage,
                            estimate: estimateBackendTextCost(
                                runtimeError.model ?? profile.providerModel,
                                runtimeError.usage.promptTokens,
                                runtimeError.usage.completionTokens,
                                runtimeError.usage,
                                profile.provider
                            ),
                        }),
                        ...(runtimeError?.promptCache !== undefined && {
                            cache: runtimeError.promptCache,
                        }),
                    });
                    if (
                        runtimeError === undefined ||
                        runtimeError.details.classification !== 'transient' ||
                        budget.calls >= 60
                    )
                        break;
                } finally {
                    persist();
                }
            }
        }
    } finally {
        globalThis.fetch = originalFetch;
    }
    persist();
    console.log(
        JSON.stringify(
            {
                output: path.relative(root, output),
                ...budget,
                measured: samples.filter(
                    (sample) => sample.status === 'measured'
                ).length,
                failed: samples.filter((sample) => sample.status === 'failed')
                    .length,
                preflight,
            },
            null,
            2
        )
    );
};
// This standalone process owns its finished requests; idle SDK tracing timers must not keep it alive.
void run().then(
    () => process.exit(0),
    () => {
        console.error(
            'Cache probe failed; any completed measurements remain checkpointed.'
        );
        process.exit(1);
    }
);
