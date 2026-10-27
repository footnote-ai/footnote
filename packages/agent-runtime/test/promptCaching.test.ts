/**
 * @description: Verifies provider cache measurements and serialized cache requests.
 * @footnote-scope: test
 * @footnote-module: PromptCachingTests
 * @footnote-risk: high - Invented cache counts can falsely claim financial savings.
 * @footnote-ethics: high - Provider measurements must remain distinct from missing data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createVoltAgentRuntime,
    normalizeVoltAgentResult,
} from '../src/voltagentRuntime.js';
import type { GenerationRequest } from '../src/index.js';
import { translatePromptCache } from '../src/promptCache.js';
import {
    AgentRegistry,
    createVoltAgentObservability,
    InMemoryObservabilityAdapter,
} from '@voltagent/core';

test('OpenRouter raw usage preserves missing reads and reported cache writes instead of SDK placeholders', () => {
    const result = normalizeVoltAgentResult(
        'openrouter/deepseek/test',
        {
            provider: 'openrouter',
            messages: [],
        },
        {
            text: 'answer',
            usage: {
                promptTokens: 100,
                completionTokens: 0,
                cachedInputTokens: 0,
            },
            response: {
                body: {
                    usage: {
                        prompt_tokens: 100,
                        prompt_tokens_details: { cache_write_tokens: 80 },
                    },
                },
            },
        }
    );
    assert.deepEqual(result.usage, { promptTokens: 100, cacheWriteTokens: 80 });
});

test('real hosted adapters serialize explicit stable-prefix breakpoints and keep request storage disabled', async () => {
    const observability = createVoltAgentObservability({
        storage: new InMemoryObservabilityAdapter(),
    });
    AgentRegistry.getInstance().setGlobalObservability(observability);
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'fixture-key';
    const captured: Record<string, unknown>[] = [];
    globalThis.fetch = async (input, init) => {
        captured.push(
            JSON.parse(String(init?.body)) as Record<string, unknown>
        );
        const responses = String(input).includes('/responses');
        return new Response(
            JSON.stringify(
                responses
                    ? {
                          id: 'resp_fixture',
                          created_at: 1,
                          status: 'completed',
                          model: 'gpt-5.6-luna',
                          output: [
                              {
                                  type: 'message',
                                  role: 'assistant',
                                  id: 'msg_fixture',
                                  content: [
                                      {
                                          type: 'output_text',
                                          text: 'answer',
                                          annotations: [],
                                      },
                                  ],
                              },
                          ],
                          usage: {
                              input_tokens: 100,
                              output_tokens: 2,
                              total_tokens: 102,
                              input_tokens_details: {
                                  cached_tokens: 0,
                                  cache_write_tokens: 80,
                              },
                          },
                      }
                    : {
                          id: 'chat_fixture',
                          created: 1,
                          model: 'openai/gpt-5.6-luna',
                          choices: [
                              {
                                  index: 0,
                                  message: {
                                      role: 'assistant',
                                      content: 'answer',
                                  },
                                  finish_reason: 'stop',
                              },
                          ],
                          usage: {
                              prompt_tokens: 100,
                              completion_tokens: 2,
                              total_tokens: 102,
                              prompt_tokens_details: {
                                  cached_tokens: 0,
                                  cache_write_tokens: 80,
                              },
                          },
                      }
            ),
            { headers: { 'content-type': 'application/json' } }
        );
    };
    try {
        for (const provider of ['openai', 'openrouter'] as const) {
            const runtime = createVoltAgentRuntime({
                defaultModel: 'gpt-5.6-luna',
                openrouter: {
                    apiKey: 'fixture-key',
                    baseUrl: 'https://router.example.test/v1',
                },
            });
            const request: GenerationRequest = {
                provider,
                model:
                    provider === 'openrouter'
                        ? 'openai/gpt-5.6-luna'
                        : 'gpt-5.6-luna',
                maxOutputTokens: 16,
                messages: [
                    {
                        role: 'system',
                        content: 'trusted stable prefix',
                        cacheable: true,
                    },
                    { role: 'system', content: 'changing UTC clock' },
                    { role: 'user', content: 'question' },
                ],
                promptCache: {
                    key: `footnote:cache:v1:${'a'.repeat(64)}`,
                    stablePrefixMessages: 1,
                    ttlSeconds: 43200,
                    purpose: 'generation',
                    surface: 'web',
                },
            };
            const result = await runtime.generate(request);
            assert.equal(result.usage?.cacheWriteTokens, 80);
            assert.equal(
                JSON.stringify(result).includes(request.promptCache!.key),
                false
            );
            assert.equal(result.promptCache?.appliedTtlSeconds, 43200);
            const body = captured.at(-1)!;
            assert.equal(body.prompt_cache_key, request.promptCache?.key);
            assert.deepEqual(body.prompt_cache_options, {
                mode: 'explicit',
                ttl: '30m',
            });
            if (provider === 'openai') assert.equal(body.store, false);
            const messages = (body.input ?? body.messages) as Array<{
                content: unknown;
            }>;
            const prefix = messages.find((message) =>
                JSON.stringify(message.content).includes(
                    'trusted stable prefix'
                )
            );
            assert.match(JSON.stringify(prefix), /prompt_cache_breakpoint/);
            assert.match(JSON.stringify(prefix), /12h/);
            const clock = messages.find((message) =>
                JSON.stringify(message.content).includes('changing UTC clock')
            );
            assert.equal(
                JSON.stringify(clock).includes('prompt_cache_breakpoint'),
                false
            );
        }
    } finally {
        await observability.shutdown();
        globalThis.fetch = previousFetch;
        if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previousKey;
    }
});

test('OpenAI raw usage distinguishes measured zero, absent usage, and retention-tier writes', () => {
    const request = { provider: 'openai' as const, messages: [] };
    const normalize = (body: unknown) =>
        normalizeVoltAgentResult('openai/gpt-5.6-luna', request, {
            text: 'answer',
            usage: { cachedInputTokens: 0, promptTokens: 0 },
            response: { body },
        }).usage;
    assert.equal(normalize({}), undefined);
    assert.deepEqual(
        normalize({
            usage: {
                input_tokens: 0,
                input_tokens_details: { cached_tokens: 0 },
            },
        }),
        {
            promptTokens: 0,
            cachedInputTokens: 0,
        }
    );
    assert.deepEqual(
        normalize({
            usage: {
                input_tokens: 100,
                input_tokens_details: {
                    cached_tokens: 20,
                    cache_write_tokens: 50,
                    cache_write_tokens_details: {
                        ttl_30m_tokens: 10,
                        ttl_12h_tokens: 40,
                    },
                },
            },
        }),
        {
            promptTokens: 100,
            cachedInputTokens: 20,
            cacheWriteTokens: 50,
            cacheWrite30mTokens: 10,
            cacheWrite12hTokens: 40,
        }
    );
});

test('unsupported cache providers and retention controls are omitted without preventing generation', async () => {
    const request: GenerationRequest = {
        provider: 'openrouter',
        model: 'unsupported/model',
        messages: [
            { role: 'system', content: 'trusted policy', cacheable: true },
        ],
        promptCache: {
            key: `footnote:cache:v1:${'b'.repeat(64)}`,
            stablePrefixMessages: 1,
            ttlSeconds: 3600,
            purpose: 'generation',
            surface: 'web',
        },
    };
    const runtime = createVoltAgentRuntime({
        defaultModel: 'unsupported/model',
        createExecutor: () => ({
            async generateText() {
                return { text: 'answer' };
            },
        }),
    });
    const result = await runtime.generate(request);
    assert.equal(result.text, 'answer');
    assert.equal(
        result.promptCache?.omissionReason,
        'unsupported_provider_or_model'
    );
    const supported = translatePromptCache({
        ...request,
        provider: 'openai',
        model: 'gpt-5.6-luna',
    });
    assert.equal(supported?.receipt.omissionReason, 'unsupported_retention');
    assert.equal(supported?.receipt.appliedTtlSeconds, 1800);
    assert.deepEqual(supported?.native.prompt_cache_options, {
        mode: 'explicit',
        ttl: '30m',
    });
});
