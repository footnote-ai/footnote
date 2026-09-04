/**
 * @description: Covers the VoltAgent-backed generation runtime adapter.
 * @footnote-scope: test
 * @footnote-module: VoltAgentRuntimeTests
 * @footnote-risk: medium - Missing tests here could let the new runtime drift on model mapping, fallback behavior, or usage normalization before cutover.
 * @footnote-ethics: medium - This adapter needs to preserve sourcing and transparency expectations while VoltAgent is still an alternate implementation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Agent } from '@voltagent/core';
import { APICallError } from 'ai';
import type { GenerationRequest, RuntimeMessage } from '../src/index.js';
import {
    createDefaultVoltAgentExecutor,
    createVoltAgentRuntime,
    buildVoltAgentProviderOptions,
    getToolForProvider,
    hasToolForProvider,
    normalizeVoltAgentResult,
    normalizeGenerationRuntimeError,
    openRouterMetadataExtractor,
    mergeOpenRouterRequestBody,
    resolveToolForProvider,
    type VoltAgentGenerateTextOptions,
    type VoltAgentLogger,
} from '../src/voltagentRuntime.js';
import { GenerationRuntimeError } from '../src/index.js';

type AgentGenerateTextResult = Awaited<ReturnType<Agent['generateText']>>;

const structuredOutput = {
    name: 'review_result',
    schema: {
        type: 'object' as const,
        properties: { verdict: { type: 'string' } },
        required: ['verdict'],
        additionalProperties: false,
    },
};

const apiError = (input: {
    statusCode?: number;
    responseBody?: string;
    isRetryable?: boolean;
}) =>
    new APICallError({
        message: 'provider request failed',
        url: 'https://provider.example.test/v1/generate',
        requestBodyValues: {},
        ...input,
    });

test('normalizes only structured billing and account availability failures', () => {
    const billing = normalizeGenerationRuntimeError(
        apiError({ statusCode: 402 })
    );
    assert.ok(billing instanceof GenerationRuntimeError);
    assert.deepEqual(billing.details, {
        classification: 'provider_temporary_unavailable',
        availabilityReason: 'billing_or_quota',
    });

    const topLevelType = normalizeGenerationRuntimeError(
        apiError({
            statusCode: 429,
            responseBody: JSON.stringify({ type: 'insufficient_quota' }),
        })
    );
    assert.ok(topLevelType instanceof GenerationRuntimeError);
    assert.deepEqual(topLevelType.details, {
        classification: 'provider_temporary_unavailable',
        availabilityReason: 'billing_or_quota',
    });

    const suspended = normalizeGenerationRuntimeError(
        apiError({
            statusCode: 403,
            responseBody: JSON.stringify({
                error: { code: 'account_suspended' },
            }),
        })
    );
    assert.ok(suspended instanceof GenerationRuntimeError);
    assert.deepEqual(suspended.details, {
        classification: 'provider_temporary_unavailable',
        availabilityReason: 'account_unavailable',
    });

    assert.equal(
        normalizeGenerationRuntimeError(
            apiError({
                statusCode: 400,
                responseBody: JSON.stringify({
                    error: { code: 'invalid_request' },
                }),
            })
        ),
        undefined
    );
});

test('normalizes retryable transport failures without turning them into availability claims', () => {
    const normalized = normalizeGenerationRuntimeError(
        apiError({ statusCode: 503, isRetryable: true })
    );

    assert.ok(normalized instanceof GenerationRuntimeError);
    assert.deepEqual(normalized.details, { classification: 'transient' });
});

test('voltAgent runtime carries normalized provider availability failures to routing', async () => {
    const runtime = createVoltAgentRuntime({
        defaultModel: 'gpt-5-mini',
        createExecutor: () => ({
            async generateText() {
                throw apiError({ statusCode: 402 });
            },
        }),
    });

    await assert.rejects(
        runtime.generate({
            messages: [{ role: 'user', content: 'Reply.' }],
        }),
        (error: unknown) => {
            assert.ok(error instanceof GenerationRuntimeError);
            assert.deepEqual(error.details, {
                classification: 'provider_temporary_unavailable',
                availabilityReason: 'billing_or_quota',
            });
            return true;
        }
    );
});

test('leaves credential, model, request, and unstructured provider failures unclassified', () => {
    for (const error of [
        apiError({ statusCode: 401 }),
        apiError({ statusCode: 404 }),
        apiError({ statusCode: 413 }),
        apiError({ statusCode: 429, responseBody: 'rate limited' }),
        new Error('provider account has no credits'),
    ]) {
        const normalized = normalizeGenerationRuntimeError(error);
        assert.equal(
            normalized === undefined ||
                normalized.details.classification === 'transient',
            true
        );
        assert.notEqual(
            normalized?.details.classification,
            'provider_temporary_unavailable'
        );
    }
});

test('voltagent runtime maps transcript and generation settings into executor options', async () => {
    let seenModel: string | undefined;
    let seenMessages: RuntimeMessage[] | undefined;
    let seenOptions: VoltAgentGenerateTextOptions | undefined;
    const signal = new AbortController().signal;
    const runtime = createVoltAgentRuntime({
        defaultModel: 'gpt-5-mini',
        createExecutor: ({ model }) => {
            seenModel = model;

            return {
                async generateText(messages, options) {
                    seenMessages = messages;
                    seenOptions = options;

                    return {
                        text: 'voltagent reply',
                        response: {
                            modelId: model,
                        },
                    };
                },
            };
        },
    });
    const request: GenerationRequest = {
        messages: [{ role: 'user', content: 'Summarize the repo changes.' }],
        model: 'gpt-5.1',
        maxOutputTokens: 800,
        temperature: 0.7,
        reasoningEffort: 'max',
        topP: undefined,
        verbosity: 'high',
        safetyIdentifier: 'derived-safety-id',
        structuredOutput: {
            name: 'test_output',
            schema: {
                type: 'object',
                properties: { ready: { type: 'boolean' } },
                required: ['ready'],
                additionalProperties: false,
            },
        },
        signal,
    };

    const result = await runtime.generate(request);

    assert.equal(seenModel, 'openai/gpt-5.1');
    assert.deepEqual(seenMessages, request.messages);
    assert.equal(seenOptions?.maxOutputTokens, 800);
    assert.equal(seenOptions?.temperature, 0.7);
    assert.equal(seenOptions?.topP, undefined);
    assert.equal(seenOptions?.signal, signal);
    assert.deepEqual(seenOptions?.structuredOutput, request.structuredOutput);
    assert.deepEqual(seenOptions?.providerOptions, {
        reasoningEffort: 'max',
        verbosity: 'high',
        safetyIdentifier: 'derived-safety-id',
    });
    assert.equal(result.text, 'voltagent reply');
    assert.equal(result.model, 'gpt-5.1');
});

test('voltagent runtime prefixes model with requested provider when model id is provider-local', async () => {
    let seenModel: string | undefined;
    const runtime = createVoltAgentRuntime({
        defaultModel: 'gpt-5-mini',
        createExecutor: ({ model }) => {
            seenModel = model;
            return {
                async generateText() {
                    return {
                        text: 'provider-routed reply',
                        response: {
                            modelId: model,
                        },
                    };
                },
            };
        },
    });

    const result = await runtime.generate({
        messages: [{ role: 'user', content: 'Summarize this.' }],
        model: 'claude-3-5-sonnet',
        provider: 'openai',
    });

    assert.equal(seenModel, 'openai/claude-3-5-sonnet');
    assert.equal(result.model, 'claude-3-5-sonnet');
});

test('voltagent runtime carries explicit OpenRouter routing and reported attribution', async () => {
    let seenModel: string | undefined;
    let seenOptions: VoltAgentGenerateTextOptions | undefined;
    const runtime = createVoltAgentRuntime({
        defaultModel: 'openrouter/thedrummer/cydonia-24b-v4.1',
        openrouter: {
            apiKey: 'test-openrouter-key',
            baseUrl: 'https://openrouter.ai/api/v1',
        },
        createExecutor: ({ model }) => {
            seenModel = model;
            return {
                async generateText(_messages, options) {
                    seenOptions = options;
                    return {
                        text: 'A carefully phrased answer.',
                        response: { modelId: model },
                        providerMetadata: {
                            openrouter: {
                                routing: {
                                    provider: 'Parasail',
                                    model: 'thedrummer/cydonia-24b-v4.1',
                                    attempt: 1,
                                    attempts: 1,
                                },
                                usage: { cost: 0.000012 },
                            },
                        },
                    };
                },
            };
        },
    });

    const result = await runtime.generate({
        messages: [{ role: 'user', content: 'Rewrite this carefully.' }],
        provider: 'openrouter',
        model: 'thedrummer/cydonia-24b-v4.1',
        providerRouting: {
            openrouter: {
                only: ['parasail'],
                allowFallbacks: false,
                dataCollection: 'deny',
            },
        },
    });

    assert.equal(seenModel, 'openrouter/thedrummer/cydonia-24b-v4.1');
    assert.deepEqual(seenOptions?.providerOptions, {
        providerHints: {
            openrouter: {
                provider: {
                    only: ['parasail'],
                    allow_fallbacks: false,
                    data_collection: 'deny',
                },
            },
        },
    });
    assert.deepEqual(result.upstreamAttribution, {
        inferenceProvider: 'Parasail',
        resolvedModel: 'thedrummer/cydonia-24b-v4.1',
        routingAttempt: 1,
        routingAttemptCount: 1,
        upstreamReportedCostUsd: 0.000012,
    });
});

test('voltagent runtime maps OpenRouter reasoning and structured-output settings', async () => {
    const providerOptions = buildVoltAgentProviderOptions(
        {
            messages: [{ role: 'user', content: 'Review this answer.' }],
            provider: 'openrouter',
            model: 'anthropic/claude-sonnet-5',
            reasoningEffort: 'medium',
            structuredOutput,
            providerRouting: {
                openrouter: {
                    only: ['anthropic'],
                    allowFallbacks: false,
                },
            },
        },
        'openrouter'
    );

    assert.deepEqual(providerOptions, {
        providerHints: {
            openrouter: {
                provider: {
                    only: ['anthropic'],
                    allow_fallbacks: false,
                    require_parameters: true,
                },
                reasoning: { effort: 'medium' },
                strictJsonSchema: true,
            },
        },
    });

    let configuredModel: unknown;
    let seenOptions: VoltAgentGenerateTextOptions | undefined;
    const executor = createDefaultVoltAgentExecutor({
        model: 'openrouter/anthropic/claude-sonnet-5',
        openrouter: {
            apiKey: 'test-openrouter-key',
            baseUrl: 'https://openrouter.ai/api/v1',
        },
        agentFactory: ({ model }) => {
            configuredModel = model;
            return {
                async generateText(
                    _messages,
                    options
                ): Promise<AgentGenerateTextResult> {
                    seenOptions = options;
                    return {
                        text: '{"verdict":"clear"}',
                        output: { verdict: 'clear' },
                        finishReason: 'stop',
                        usage: {
                            inputTokens: 0,
                            inputTokenDetails: {
                                noCacheTokens: 0,
                                cacheReadTokens: 0,
                                cacheWriteTokens: 0,
                            },
                            outputTokens: 0,
                            outputTokenDetails: { reasoningTokens: 0 },
                            totalTokens: 0,
                        },
                        response: {
                            modelId: 'openrouter/anthropic/claude-sonnet-5',
                        },
                    } as unknown as AgentGenerateTextResult;
                },
            };
        },
    });
    await executor.generateText(
        [{ role: 'user', content: 'Review this answer.' }],
        { structuredOutput, providerOptions }
    );

    const modelCapabilities = configuredModel as {
        supportsStructuredOutputs?: boolean;
    };
    assert.equal(modelCapabilities.supportsStructuredOutputs, true);
    assert.deepEqual(seenOptions?.providerOptions, {
        openrouter: providerOptions?.providerHints?.openrouter,
    });
});

test('voltagent runtime preserves per-call OpenRouter requirements beside static routing', () => {
    assert.deepEqual(
        mergeOpenRouterRequestBody(
            {
                model: 'anthropic/claude-sonnet-5',
                provider: {
                    require_parameters: true,
                    reasoning: { effort: 'medium' },
                },
            },
            {
                only: ['anthropic'],
                allow_fallbacks: false,
            }
        ),
        {
            model: 'anthropic/claude-sonnet-5',
            provider: {
                only: ['anthropic'],
                allow_fallbacks: false,
                require_parameters: true,
                reasoning: { effort: 'medium' },
            },
        }
    );
});

test('voltagent runtime preserves explicit OpenRouter none reasoning instead of inventing a fallback', async () => {
    let seenOptions: VoltAgentGenerateTextOptions | undefined;
    const runtime = createVoltAgentRuntime({
        defaultModel: 'openrouter/anthropic/claude-sonnet-5',
        openrouter: {
            apiKey: 'test-openrouter-key',
            baseUrl: 'https://openrouter.ai/api/v1',
        },
        createExecutor: () => ({
            async generateText(_messages, options) {
                seenOptions = options;
                return { text: 'reply' };
            },
        }),
    });

    await runtime.generate({
        messages: [{ role: 'user', content: 'Answer briefly.' }],
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-5',
        reasoningEffort: 'none',
    });

    assert.deepEqual(seenOptions?.providerOptions, {
        providerHints: {
            openrouter: {
                provider: { require_parameters: true },
                reasoning: { effort: 'none' },
            },
        },
    });
});

test('voltagent runtime omits reasoning efforts absent from OpenRouter discovery', async () => {
    let seenOptions: VoltAgentGenerateTextOptions | undefined;
    const runtime = createVoltAgentRuntime({
        defaultModel: 'openrouter/z-ai/glm-5.3',
        openrouter: {
            apiKey: 'test-openrouter-key',
            baseUrl: 'https://openrouter.ai/api/v1',
        },
        createExecutor: () => ({
            async generateText(_messages, options) {
                seenOptions = options;
                return { text: 'fallback answer' };
            },
        }),
    });

    const result = await runtime.generate({
        messages: [{ role: 'user', content: 'Answer briefly.' }],
        provider: 'openrouter',
        model: 'z-ai/glm-5.3',
        capabilities: {
            canUseSearch: false,
            supportedReasoningEfforts: ['low', 'medium', 'high'],
        },
        reasoningEffort: 'none',
    });

    assert.equal(result.text, 'fallback answer');
    assert.equal(seenOptions?.providerOptions, undefined);
});

test('voltagent runtime normalizes production OpenRouter metadata', async () => {
    const metadata = await openRouterMetadataExtractor.extractMetadata({
        parsedBody: {
            openrouter_metadata: {
                endpoints: {
                    available: [
                        {
                            selected: true,
                            provider: 'Parasail',
                            model: 'thedrummer/cydonia-24b-v4.1',
                        },
                    ],
                },
                attempts: [{ provider: 'Parasail' }, { provider: 'Parasail' }],
            },
            usage: { cost: 0.000012 },
        },
    });
    const result = normalizeVoltAgentResult(
        'openrouter/thedrummer/cydonia-24b-v4.1',
        { messages: [{ role: 'user', content: 'Rewrite this carefully.' }] },
        {
            text: 'A carefully phrased answer.',
            response: { modelId: 'thedrummer/cydonia-24b-v4.1' },
            providerMetadata: metadata,
        }
    );

    assert.deepEqual(result.upstreamAttribution, {
        inferenceProvider: 'Parasail',
        resolvedModel: 'thedrummer/cydonia-24b-v4.1',
        routingAttemptCount: 2,
        upstreamReportedCostUsd: 0.000012,
    });
});

test('voltagent runtime warns and skips absent OpenRouter credentials', async () => {
    const warnings: string[] = [];
    const logger: VoltAgentLogger = {
        trace() {},
        debug() {},
        info() {},
        warn(message) {
            warnings.push(message);
        },
        error() {},
        fatal() {},
        child() {
            return logger;
        },
    };
    let seenOpenRouterConfig: unknown;
    const runtime = createVoltAgentRuntime({
        defaultModel: 'openrouter/thedrummer/cydonia-24b-v4.1',
        logger,
        createExecutor: ({ openrouter }) => {
            seenOpenRouterConfig = openrouter;
            return {
                async generateText() {
                    return { text: 'Fallback presentation.' };
                },
            };
        },
    });

    await runtime.generate({
        provider: 'openrouter',
        model: 'thedrummer/cydonia-24b-v4.1',
        messages: [{ role: 'user', content: 'Rewrite this carefully.' }],
    });

    assert.equal(seenOpenRouterConfig, undefined);
    assert.match(warnings[0] ?? '', /API key is unavailable/u);
});

test('voltagent runtime uses default model when request model is blank', async () => {
    let seenModel: string | undefined;
    const runtime = createVoltAgentRuntime({
        defaultModel: 'gpt-5-mini',
        createExecutor: ({ model }) => {
            seenModel = model;
            return {
                async generateText() {
                    return {
                        text: 'default-model reply',
                        response: {
                            modelId: model,
                        },
                    };
                },
            };
        },
    });

    const result = await runtime.generate({
        messages: [{ role: 'user', content: 'Summarize this.' }],
        model: '   ',
    });

    assert.equal(seenModel, 'openai/gpt-5-mini');
    assert.equal(result.model, 'gpt-5-mini');
});

test('voltagent runtime infers provider from configured default model when request model is blank', async () => {
    let seenModel: string | undefined;
    const runtime = createVoltAgentRuntime({
        defaultModel: 'ollama/gpt-oss:20b-cloud',
        createExecutor: ({ model }) => {
            seenModel = model;
            return {
                async generateText() {
                    return {
                        text: 'default-provider reply',
                        response: {
                            modelId: model,
                        },
                    };
                },
            };
        },
    });

    const result = await runtime.generate({
        messages: [{ role: 'user', content: 'Summarize this.' }],
        model: '   ',
    });

    assert.equal(seenModel, 'ollama/gpt-oss:20b-cloud');
    assert.equal(result.model, 'gpt-oss:20b-cloud');
});

test('voltagent runtime does not infer provider from default model for explicit unprefixed request models', async () => {
    let seenModel: string | undefined;
    const runtime = createVoltAgentRuntime({
        defaultModel: 'ollama/gpt-oss:20b-cloud',
        createExecutor: ({ model }) => {
            seenModel = model;
            return {
                async generateText() {
                    return {
                        text: 'explicit-model reply',
                        response: {
                            modelId: model,
                        },
                    };
                },
            };
        },
    });

    const result = await runtime.generate({
        messages: [{ role: 'user', content: 'Summarize this.' }],
        model: 'qwen3.5:cloud',
    });

    assert.equal(seenModel, 'openai/qwen3.5:cloud');
    assert.equal(result.model, 'qwen3.5:cloud');
});

test('voltagent runtime normalizes non-search output into GenerationResult', async () => {
    const runtime = createVoltAgentRuntime({
        defaultModel: 'gpt-5-mini',
        createExecutor: () => ({
            async generateText() {
                return {
                    text: 'normalized VoltAgent reply',
                    finishReason: 'stop',
                    usage: {
                        promptTokens: 90,
                        completionTokens: 45,
                        totalTokens: 135,
                    },
                    response: {
                        modelId: 'openai/gpt-5.2',
                    },
                };
            },
        }),
    });

    const result = await runtime.generate({
        messages: [
            { role: 'user', content: 'Explain the current runtime seam.' },
        ],
        model: 'gpt-5-mini',
    });

    assert.equal(result.text, 'normalized VoltAgent reply');
    assert.equal(result.model, 'gpt-5.2');
    assert.equal(result.finishReason, 'stop');
    assert.deepEqual(result.usage, {
        promptTokens: 90,
        completionTokens: 45,
        totalTokens: 135,
    });
    assert.deepEqual(result.citations, []);
    assert.deepEqual(result.retrieval, {
        requested: false,
        used: false,
    });
    assert.equal(result.provenance, 'Inferred');
});

test('voltagent runtime preserves safe incomplete reasoning metadata without response text', async () => {
    const runtime = createVoltAgentRuntime({
        defaultModel: 'gpt-5.6-terra',
        createExecutor: () => ({
            async generateText() {
                return {
                    text: '',
                    finishReason: 'length',
                    usage: {
                        promptTokens: 2400,
                        completionTokens: 1200,
                        totalTokens: 3600,
                    },
                    response: {
                        modelId: 'openai/gpt-5.6-terra',
                        body: {
                            status: 'incomplete',
                            incomplete_details: {
                                reason: 'max_output_tokens',
                            },
                            usage: {
                                output_tokens: 1200,
                                output_tokens_details: {
                                    reasoning_tokens: 1200,
                                },
                            },
                        },
                    },
                };
            },
        }),
    });

    const result = await runtime.generate({
        messages: [{ role: 'user', content: 'Answer briefly.' }],
        model: 'gpt-5.6-terra',
        reasoningEffort: 'medium',
        maxOutputTokens: 1200,
    });

    assert.equal(result.text, '');
    assert.equal(result.finishReason, 'length');
    assert.deepEqual(result.usage, {
        promptTokens: 2400,
        completionTokens: 1200,
        totalTokens: 3600,
        reasoningTokens: 1200,
    });
    assert.deepEqual(result.completion, {
        status: 'incomplete',
        reason: 'max_output_tokens',
        visibleTextLength: 0,
    });
});

test('voltagent runtime executes search requests through the VoltAgent executor', async () => {
    let seenOptions: VoltAgentGenerateTextOptions | undefined;
    const runtime = createVoltAgentRuntime({
        defaultModel: 'gpt-5-mini',
        createExecutor: () => ({
            async generateText(_messages, options) {
                seenOptions = options;

                return {
                    text: 'search-backed reply',
                    sources: [
                        {
                            title: 'Latest Policy Update',
                            url: 'https://example.com/policy',
                        },
                    ],
                    response: {
                        modelId: 'openai/gpt-5-mini',
                        body: {
                            output: [{ type: 'web_search_call' }],
                        },
                    },
                };
            },
        }),
    });
    const request: GenerationRequest = {
        messages: [
            { role: 'user', content: 'Find the latest policy changes.' },
        ],
        capabilities: {
            canUseSearch: true,
        },
        search: {
            query: 'latest policy changes',
            contextSize: 'low',
            intent: 'current_facts',
        },
    };

    const result = await runtime.generate(request);

    assert.deepEqual(seenOptions?.search, {
        query: 'latest policy changes',
        contextSize: 'low',
        intent: 'current_facts',
    });
    assert.equal(result.text, 'search-backed reply');
    assert.deepEqual(result.citations, [
        {
            title: 'Latest Policy Update',
            url: 'https://example.com/policy',
        },
    ]);
    assert.deepEqual(result.retrieval, {
        requested: true,
        used: true,
    });
    assert.deepEqual(result.toolExecution, {
        toolName: 'web_search',
        status: 'executed',
    });
    assert.equal(result.provenance, 'Retrieved');
});

test('voltagent runtime omits openai-only options for ollama models', async () => {
    let seenOptions: VoltAgentGenerateTextOptions | undefined;
    const runtime = createVoltAgentRuntime({
        defaultModel: 'ollama/llama3.2:3b',
        createExecutor: () => ({
            async generateText(_messages, options) {
                seenOptions = options;
                return {
                    text: 'ollama reply',
                    response: {
                        modelId: 'ollama/llama3.2:3b',
                    },
                };
            },
        }),
    });

    await runtime.generate({
        messages: [{ role: 'user', content: 'Summarize this.' }],
        model: 'ollama/llama3.2:3b',
        reasoningEffort: 'high',
        verbosity: 'high',
        search: {
            query: 'latest release notes',
            contextSize: 'high',
            intent: 'current_facts',
        },
    });

    assert.equal(seenOptions?.providerOptions, undefined);
    assert.equal(seenOptions?.search, undefined);
});

test('voltagent runtime does not forward search for providers without a mapped search tool', async () => {
    let seenOptions: VoltAgentGenerateTextOptions | undefined;
    const runtime = createVoltAgentRuntime({
        defaultModel: 'ollama/llama3.2:3b',
        createExecutor: () => ({
            async generateText(_messages, options) {
                seenOptions = options;
                return {
                    text: 'capability-enabled search reply',
                    response: {
                        modelId: 'ollama/llama3.2:3b',
                    },
                };
            },
        }),
    });

    const result = await runtime.generate({
        messages: [{ role: 'user', content: 'Summarize this.' }],
        model: 'ollama/llama3.2:3b',
        search: {
            query: 'latest release notes',
            contextSize: 'high',
            intent: 'current_facts',
        },
        capabilities: {
            canUseSearch: true,
        },
    });

    assert.equal(seenOptions?.search, undefined);
    assert.deepEqual(result.toolExecution, {
        toolName: 'web_search',
        status: 'skipped',
        reasonCode: 'tool_unavailable',
    });
});

test('voltagent runtime forwards search for ollama-cloud when a provider mapping exists', async () => {
    let seenModel: string | undefined;
    let seenOptions: VoltAgentGenerateTextOptions | undefined;
    const runtime = createVoltAgentRuntime({
        defaultModel: 'gpt-oss:20b-cloud',
        ollama: {
            baseUrl: 'https://ollama.com/api',
            localInferenceEnabled: false,
        },
        createExecutor: ({ model }) => {
            seenModel = model;
            return {
                async generateText(_messages, options) {
                    seenOptions = options;
                    return {
                        text: 'cloud-search reply',
                        response: {
                            modelId: model,
                            body: {
                                output: [{ type: 'web_search_call' }],
                            },
                        },
                        sources: [
                            {
                                title: 'Cloud Source',
                                url: 'https://example.com/cloud',
                            },
                        ],
                    };
                },
            };
        },
    });

    const result = await runtime.generate({
        messages: [{ role: 'user', content: 'What changed this week?' }],
        model: 'gpt-oss:20b-cloud',
        provider: 'ollama',
        search: {
            query: 'latest cloud release notes',
            contextSize: 'medium',
            intent: 'current_facts',
        },
        capabilities: {
            canUseSearch: true,
        },
    });

    assert.equal(seenModel, 'ollama-cloud/gpt-oss:20b-cloud');
    assert.deepEqual(seenOptions?.search, {
        query: 'latest cloud release notes',
        contextSize: 'medium',
        intent: 'current_facts',
    });
    assert.deepEqual(result.toolExecution, {
        toolName: 'web_search',
        status: 'executed',
    });
    assert.equal(result.retrieval?.used, true);
});

test('voltagent runtime fails open for unknown provider/tool combinations with stable reason code', async () => {
    let seenOptions: VoltAgentGenerateTextOptions | undefined;
    const runtime = createVoltAgentRuntime({
        defaultModel: 'claude-3-5-sonnet',
        createExecutor: () => ({
            async generateText(_messages, options) {
                seenOptions = options;
                return {
                    text: 'unsupported provider reply',
                    response: {
                        modelId: 'anthropic/claude-3-5-sonnet',
                    },
                };
            },
        }),
    });

    const result = await runtime.generate({
        messages: [{ role: 'user', content: 'Summarize this.' }],
        model: 'claude-3-5-sonnet',
        provider: 'anthropic' as GenerationRequest['provider'],
        search: {
            query: 'latest safety policy',
            contextSize: 'low',
            intent: 'current_facts',
        },
        capabilities: {
            canUseSearch: true,
        },
    });

    assert.equal(seenOptions?.search, undefined);
    assert.deepEqual(result.toolExecution, {
        toolName: 'web_search',
        status: 'skipped',
        reasonCode: 'tool_unavailable',
    });
});

test('voltagent runtime maps remote ollama provider to ollama-cloud and normalizes cloud base URL', async () => {
    let seenModel: string | undefined;
    let seenOllamaConfig:
        | {
              provider: 'ollama' | 'ollama-cloud';
              baseUrl?: string;
              apiKey?: string;
              localInferenceEnabled: boolean;
          }
        | undefined;

    const runtime = createVoltAgentRuntime({
        defaultModel: 'gpt-oss:20b-cloud',
        ollama: {
            baseUrl: 'https://ollama.com/api',
            apiKey: 'test-ollama-key',
            localInferenceEnabled: false,
        },
        createExecutor: ({ model, ollama: ollamaConfig }) => {
            seenModel = model;
            seenOllamaConfig = ollamaConfig;
            return {
                async generateText() {
                    return {
                        text: 'cloud ollama reply',
                        response: {
                            modelId: model,
                        },
                    };
                },
            };
        },
    });

    const result = await runtime.generate({
        messages: [{ role: 'user', content: 'Summarize this.' }],
        model: 'gpt-oss:20b-cloud',
        provider: 'ollama',
    });

    assert.equal(seenModel, 'ollama-cloud/gpt-oss:20b-cloud');
    assert.equal(result.model, 'gpt-oss:20b-cloud');
    assert.deepEqual(seenOllamaConfig, {
        provider: 'ollama-cloud',
        baseUrl: 'https://ollama.com/v1',
        apiKey: 'test-ollama-key',
        localInferenceEnabled: false,
    });
});

test('provider tool registry lookups expose search mappings for supported providers', () => {
    assert.equal(hasToolForProvider('web_search', 'openai'), true);
    assert.equal(hasToolForProvider('web_search', 'ollama-cloud'), true);
    assert.equal(hasToolForProvider('web_search', 'ollama'), false);

    const openAiSearchToolFactory = getToolForProvider('web_search', 'openai');
    assert.ok(openAiSearchToolFactory);
    assert.deepEqual(
        openAiSearchToolFactory?.({
            query: 'latest policy updates',
            contextSize: 'low',
            intent: 'current_facts',
        }),
        {
            type: 'provider',
            id: 'openai.web_search',
            name: 'web_search',
            args: {
                searchContextSize: 'low',
            },
        }
    );

    const ollamaCloudSearchToolFactory = getToolForProvider(
        'web_search',
        'ollama-cloud'
    );
    assert.ok(ollamaCloudSearchToolFactory);
    assert.deepEqual(
        ollamaCloudSearchToolFactory?.({
            query: 'latest cloud policy updates',
            contextSize: 'medium',
            intent: 'current_facts',
        }),
        {
            type: 'provider',
            id: 'ollama-cloud.web_search',
            name: 'web_search',
            args: {
                searchContextSize: 'medium',
            },
        }
    );
});

test('provider tool registry resolution reports stable reasons for unsupported mappings', () => {
    const supportedMapping = resolveToolForProvider('web_search', 'openai');
    assert.equal(supportedMapping.supported, true);
    if (supportedMapping.supported) {
        assert.equal(typeof supportedMapping.factory, 'function');
    }
    assert.deepEqual(resolveToolForProvider('web_search', 'anthropic'), {
        supported: false,
        reason: 'provider_not_registered',
    });
    assert.deepEqual(resolveToolForProvider('unknown_tool', 'openai'), {
        supported: false,
        reason: 'tool_not_registered',
    });
});

test('voltagent runtime recovers markdown-link citations when retrieved output lacks structured sources', async () => {
    const runtime = createVoltAgentRuntime({
        defaultModel: 'gpt-5-mini',
        createExecutor: () => ({
            async generateText() {
                return {
                    text: 'Recent headlines: [1](https://example.com/a) [Policy Blog](https://example.com/b)',
                    response: {
                        modelId: 'openai/gpt-5-mini',
                        body: {
                            output: [{ type: 'web_search_call' }],
                        },
                    },
                };
            },
        }),
    });

    const result = await runtime.generate({
        messages: [{ role: 'user', content: 'What changed today?' }],
        capabilities: {
            canUseSearch: true,
        },
        search: {
            query: 'latest changes today',
            contextSize: 'low',
            intent: 'current_facts',
        },
    });

    assert.deepEqual(result.citations, [
        { title: 'Source', url: 'https://example.com/a' },
        { title: 'Policy Blog', url: 'https://example.com/b' },
    ]);
    assert.equal(result.provenance, 'Retrieved');
});

test('voltagent runtime recovers citations from nested markdown link labels', async () => {
    const runtime = createVoltAgentRuntime({
        defaultModel: 'gpt-5-mini',
        createExecutor: () => ({
            async generateText() {
                return {
                    text: 'Build status: [![build](https://img.example.com/status.svg)](https://example.com/build)',
                    response: {
                        modelId: 'openai/gpt-5-mini',
                        body: {
                            output: [{ type: 'web_search_call' }],
                        },
                    },
                };
            },
        }),
    });

    const result = await runtime.generate({
        messages: [{ role: 'user', content: 'What changed today?' }],
        capabilities: {
            canUseSearch: true,
        },
        search: {
            query: 'latest changes today',
            contextSize: 'low',
            intent: 'current_facts',
        },
    });

    assert.deepEqual(result.citations, [
        {
            title: '![build](https://img.example.com/status.svg)',
            url: 'https://example.com/build',
        },
    ]);
    assert.equal(result.provenance, 'Retrieved');
});

test('voltagent runtime ignores malformed bracket-heavy markdown without falling back or hanging', async () => {
    const runtime = createVoltAgentRuntime({
        defaultModel: 'gpt-5-mini',
        createExecutor: () => ({
            async generateText() {
                return {
                    text: `${'[!](http://'.repeat(200)} not a real citation`,
                    response: {
                        modelId: 'openai/gpt-5-mini',
                        body: {
                            output: [{ type: 'web_search_call' }],
                        },
                    },
                };
            },
        }),
    });

    const result = await runtime.generate({
        messages: [{ role: 'user', content: 'What changed today?' }],
        capabilities: {
            canUseSearch: true,
        },
        search: {
            query: 'latest changes today',
            contextSize: 'low',
            intent: 'current_facts',
        },
    });

    assert.deepEqual(result.citations, []);
    assert.equal(result.provenance, 'Retrieved');
});

test('voltagent runtime requires a request model or configured default model', async () => {
    const runtime = createVoltAgentRuntime({
        createExecutor: () => ({
            async generateText() {
                return {
                    text: 'unexpected',
                };
            },
        }),
    });

    await assert.rejects(
        () =>
            runtime.generate({
                messages: [{ role: 'user', content: 'Hello there.' }],
            }),
        /VoltAgent runtime requires request\.model or a configured defaultModel\./
    );
});

test('default VoltAgent executor maps structured output to a validated JSON result', async () => {
    let sawOutput = false;
    const fakeAgent = {
        generateText: async (
            ...args: Parameters<Agent['generateText']>
        ): Promise<Awaited<ReturnType<Agent['generateText']>>> => {
            sawOutput = args[1]?.output !== undefined;
            return {
                content: [],
                text: 'untrusted raw text',
                reasoning: [],
                reasoningText: undefined,
                files: [],
                sources: [],
                toolCalls: [],
                staticToolCalls: [],
                dynamicToolCalls: [],
                toolResults: [],
                staticToolResults: [],
                dynamicToolResults: [],
                finishReason: 'stop',
                rawFinishReason: 'stop',
                usage: {
                    inputTokens: 0,
                    inputTokenDetails: {
                        noCacheTokens: 0,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                    },
                    outputTokens: 0,
                    outputTokenDetails: {
                        textTokens: 0,
                        reasoningTokens: 0,
                    },
                    totalTokens: 0,
                },
                totalUsage: {
                    inputTokens: 0,
                    inputTokenDetails: {
                        noCacheTokens: 0,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                    },
                    outputTokens: 0,
                    outputTokenDetails: {
                        textTokens: 0,
                        reasoningTokens: 0,
                    },
                    totalTokens: 0,
                },
                warnings: undefined,
                request: {},
                response: {
                    modelId: 'ollama/gemma4:31b',
                    id: 'response_1',
                    timestamp: new Date(0),
                    messages: [],
                },
                providerMetadata: undefined,
                steps: [],
                experimental_output: {
                    verdict: 'clear',
                    feedback: '',
                },
                output: { verdict: 'clear', feedback: '' },
                context: new Map(),
                feedback: null,
            } as unknown as Awaited<ReturnType<Agent['generateText']>>;
        },
    } satisfies Pick<Agent, 'generateText'>;
    const executor = createDefaultVoltAgentExecutor({
        model: 'ollama/gemma4:31b',
        agentFactory: () => fakeAgent,
    });

    const result = await executor.generateText(
        [{ role: 'user', content: 'Return the structured result.' }],
        {
            structuredOutput: {
                name: 'structured_result',
                schema: {
                    type: 'object',
                    properties: {
                        verdict: { type: 'string' },
                        feedback: { type: 'string' },
                    },
                    required: ['verdict', 'feedback'],
                    additionalProperties: false,
                },
            },
        }
    );

    assert.equal(sawOutput, true);
    assert.equal(result.text, '{"verdict":"clear","feedback":""}');
});

test('default VoltAgent executor maps usage from the installed AI SDK token fields', async () => {
    const fakeAgent = {
        generateText: async (
            ..._args: Parameters<Agent['generateText']>
        ): Promise<Awaited<ReturnType<Agent['generateText']>>> => ({
            content: [],
            text: 'executor reply',
            reasoning: [],
            reasoningText: undefined,
            files: [],
            sources: [],
            toolCalls: [],
            staticToolCalls: [],
            dynamicToolCalls: [],
            toolResults: [],
            staticToolResults: [],
            dynamicToolResults: [],
            finishReason: 'stop',
            rawFinishReason: 'stop',
            usage: {
                inputTokens: 21,
                inputTokenDetails: {
                    noCacheTokens: 13,
                    cacheReadTokens: 5,
                    cacheWriteTokens: 3,
                },
                outputTokens: 9,
                outputTokenDetails: {
                    textTokens: 9,
                    reasoningTokens: 0,
                },
                totalTokens: 30,
            },
            totalUsage: {
                inputTokens: 21,
                inputTokenDetails: {
                    noCacheTokens: 13,
                    cacheReadTokens: 5,
                    cacheWriteTokens: 3,
                },
                outputTokens: 9,
                outputTokenDetails: {
                    textTokens: 9,
                    reasoningTokens: 0,
                },
                totalTokens: 30,
            },
            warnings: undefined,
            request: {},
            response: {
                modelId: 'openai/gpt-5-mini',
                id: 'response_1',
                timestamp: new Date(0),
                messages: [],
            },
            providerMetadata: undefined,
            steps: [],
            experimental_output: undefined,
            output: undefined,
            context: new Map(),
            feedback: null,
        }),
    } satisfies Pick<Agent, 'generateText'>;
    const executor = createDefaultVoltAgentExecutor({
        model: 'openai/gpt-5-mini',
        agentFactory: () => fakeAgent,
    });

    const result = await executor.generateText(
        [{ role: 'user', content: 'Summarize the change.' }],
        {}
    );

    assert.deepEqual(result.usage, {
        promptTokens: 21,
        cachedInputTokens: 5,
        cacheWriteTokens: 3,
        completionTokens: 9,
        reasoningTokens: 0,
        totalTokens: 30,
    });
});

test('default VoltAgent executor passes the configured logger into Agent creation', async () => {
    const seenLoggers: VoltAgentLogger[] = [];
    const logger: VoltAgentLogger = {
        trace() {},
        debug() {},
        info() {},
        warn() {},
        error() {},
        fatal() {},
        child() {
            return this;
        },
    };
    const executor = createDefaultVoltAgentExecutor({
        model: 'openai/gpt-5-mini',
        logger,
        agentFactory: ({ logger: agentLogger }) => {
            if (agentLogger) {
                seenLoggers.push(agentLogger);
            }

            const fakeAgent = {
                generateText: async (
                    ..._args: Parameters<Agent['generateText']>
                ): Promise<Awaited<ReturnType<Agent['generateText']>>> => ({
                    content: [],
                    text: 'executor reply',
                    reasoning: [],
                    reasoningText: undefined,
                    files: [],
                    sources: [],
                    toolCalls: [],
                    staticToolCalls: [],
                    dynamicToolCalls: [],
                    toolResults: [],
                    staticToolResults: [],
                    dynamicToolResults: [],
                    finishReason: 'stop',
                    rawFinishReason: 'stop',
                    usage: {
                        inputTokens: 0,
                        inputTokenDetails: {
                            noCacheTokens: 0,
                            cacheReadTokens: 0,
                            cacheWriteTokens: 0,
                        },
                        outputTokens: 0,
                        outputTokenDetails: {
                            textTokens: 0,
                            reasoningTokens: 0,
                        },
                        totalTokens: 0,
                    },
                    totalUsage: {
                        inputTokens: 0,
                        inputTokenDetails: {
                            noCacheTokens: 0,
                            cacheReadTokens: 0,
                            cacheWriteTokens: 0,
                        },
                        outputTokens: 0,
                        outputTokenDetails: {
                            textTokens: 0,
                            reasoningTokens: 0,
                        },
                        totalTokens: 0,
                    },
                    warnings: undefined,
                    request: {},
                    response: {
                        modelId: 'openai/gpt-5-mini',
                        id: 'response_1',
                        timestamp: new Date(0),
                        messages: [],
                    },
                    providerMetadata: undefined,
                    steps: [],
                    experimental_output: undefined,
                    output: undefined,
                    context: new Map(),
                    feedback: null,
                }),
            } satisfies Pick<Agent, 'generateText'>;

            return fakeAgent;
        },
    });

    await executor.generateText([{ role: 'user', content: 'Ping' }], {});

    assert.deepEqual(seenLoggers, [logger]);
});

test('default executor strips leading system messages into Agent instructions', async () => {
    const seenInstructions: Array<string | undefined> = [];
    let seenGenerateMessages: RuntimeMessage[] | undefined;
    const fakeAgent = {
        async generateText(
            messages: RuntimeMessage[]
        ): Promise<Awaited<ReturnType<Agent['generateText']>>> {
            seenGenerateMessages = messages;
            return {
                content: [],
                text: 'instructions reply',
                reasoning: [],
                reasoningText: undefined,
                files: [],
                sources: [],
                toolCalls: [],
                staticToolCalls: [],
                dynamicToolCalls: [],
                toolResults: [],
                staticToolResults: [],
                dynamicToolResults: [],
                finishReason: 'stop',
                rawFinishReason: 'stop',
                usage: {
                    inputTokens: 0,
                    inputTokenDetails: {
                        noCacheTokens: 0,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                    },
                    outputTokens: 0,
                    outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
                    totalTokens: 0,
                },
                totalUsage: {
                    inputTokens: 0,
                    inputTokenDetails: {
                        noCacheTokens: 0,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                    },
                    outputTokens: 0,
                    outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
                    totalTokens: 0,
                },
                warnings: undefined,
                request: {},
                response: {
                    modelId: 'openai/gpt-5-mini',
                    id: 'response_1',
                    timestamp: new Date(0),
                    messages: [],
                },
                providerMetadata: undefined,
                steps: [],
                experimental_output: undefined,
                output: undefined,
                context: new Map(),
                feedback: null,
            };
        },
    } satisfies Pick<Agent, 'generateText'>;
    const executor = createDefaultVoltAgentExecutor({
        model: 'openai/gpt-5-mini',
        agentFactory: ({ instructions }) => {
            seenInstructions.push(instructions);
            return fakeAgent;
        },
    });

    const result = await executor.generateText(
        [
            { role: 'system', content: 'First instruction.' },
            { role: 'system', content: 'Second instruction.' },
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi' },
        ],
        {}
    );

    assert.equal(result.text, 'instructions reply');
    assert.deepEqual(seenInstructions, [
        'First instruction.\n\nSecond instruction.',
    ]);
    assert.deepEqual(seenGenerateMessages, [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
    ]);
});

test('default executor merges search instructions with system instructions', async () => {
    const seenInstructions: Array<string | undefined> = [];
    const fakeAgent = {
        async generateText(): Promise<
            Awaited<ReturnType<Agent['generateText']>>
        > {
            return {
                content: [],
                text: 'search reply',
                reasoning: [],
                reasoningText: undefined,
                files: [],
                sources: [],
                toolCalls: [],
                staticToolCalls: [],
                dynamicToolCalls: [],
                toolResults: [],
                staticToolResults: [],
                dynamicToolResults: [],
                finishReason: 'stop',
                rawFinishReason: 'stop',
                usage: {
                    inputTokens: 0,
                    inputTokenDetails: {
                        noCacheTokens: 0,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                    },
                    outputTokens: 0,
                    outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
                    totalTokens: 0,
                },
                totalUsage: {
                    inputTokens: 0,
                    inputTokenDetails: {
                        noCacheTokens: 0,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                    },
                    outputTokens: 0,
                    outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
                    totalTokens: 0,
                },
                warnings: undefined,
                request: {},
                response: {
                    modelId: 'openai/gpt-5-mini',
                    id: 'response_1',
                    timestamp: new Date(0),
                    messages: [],
                },
                providerMetadata: undefined,
                steps: [],
                experimental_output: undefined,
                output: undefined,
                context: new Map(),
                feedback: null,
            };
        },
    } satisfies Pick<Agent, 'generateText'>;
    const executor = createDefaultVoltAgentExecutor({
        model: 'openai/gpt-5-mini',
        agentFactory: ({ instructions }) => {
            seenInstructions.push(instructions);
            return fakeAgent;
        },
    });

    await executor.generateText(
        [{ role: 'system', content: 'System context.' }],
        {
            search: {
                query: 'latest news',
                contextSize: 'low',
                intent: 'current_facts',
            },
        }
    );

    assert.equal(seenInstructions.length, 1);
    assert.match(seenInstructions[0] ?? '', /^System context\.\n\n/);
    assert.match(seenInstructions[0] ?? '', /latest news/);
});

test('default executor leaves non-leading system messages in the transcript', async () => {
    let seenGenerateMessages: RuntimeMessage[] | undefined;
    const fakeAgent = {
        async generateText(
            messages: RuntimeMessage[]
        ): Promise<Awaited<ReturnType<Agent['generateText']>>> {
            seenGenerateMessages = messages;
            return {
                content: [],
                text: 'fail open',
                reasoning: [],
                reasoningText: undefined,
                files: [],
                sources: [],
                toolCalls: [],
                staticToolCalls: [],
                dynamicToolCalls: [],
                toolResults: [],
                staticToolResults: [],
                dynamicToolResults: [],
                finishReason: 'stop',
                rawFinishReason: 'stop',
                usage: {
                    inputTokens: 0,
                    inputTokenDetails: {
                        noCacheTokens: 0,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                    },
                    outputTokens: 0,
                    outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
                    totalTokens: 0,
                },
                totalUsage: {
                    inputTokens: 0,
                    inputTokenDetails: {
                        noCacheTokens: 0,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                    },
                    outputTokens: 0,
                    outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
                    totalTokens: 0,
                },
                warnings: undefined,
                request: {},
                response: {
                    modelId: 'openai/gpt-5-mini',
                    id: 'response_1',
                    timestamp: new Date(0),
                    messages: [],
                },
                providerMetadata: undefined,
                steps: [],
                experimental_output: undefined,
                output: undefined,
                context: new Map(),
                feedback: null,
            };
        },
    } satisfies Pick<Agent, 'generateText'>;
    const executor = createDefaultVoltAgentExecutor({
        model: 'openai/gpt-5-mini',
        agentFactory: () => fakeAgent,
    });

    await executor.generateText(
        [
            { role: 'user', content: 'Hello' },
            { role: 'system', content: 'Late system note.' },
        ],
        {}
    );

    assert.deepEqual(seenGenerateMessages, [
        { role: 'user', content: 'Hello' },
        { role: 'system', content: 'Late system note.' },
    ]);
});
