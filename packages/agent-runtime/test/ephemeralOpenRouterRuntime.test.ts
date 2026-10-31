/**
 * @description: Exercises the private text transport with intercepted HTTP and sentinel content.
 * @footnote-scope: test
 * @footnote-module: EphemeralOpenRouterRuntimeTests
 * @footnote-risk: high - Regressions could leak voice content through diagnostics or unsafe routes.
 * @footnote-ethics: high - Synthetic requests qualify local handling, never provider retention.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerTelemetryIntegration } from 'ai';
import {
    AgentRegistry,
    createVoltAgentObservability,
    InMemoryObservabilityAdapter,
} from '@voltagent/core';
import type { GenerationRequest } from '../src/index.js';
import { createEphemeralOpenRouterRuntime } from '../src/ephemeralOpenRouterRuntime.js';

const diagnosticStorage = new InMemoryObservabilityAdapter();
const observability = createVoltAgentObservability({
    storage: diagnosticStorage,
    flushOnFinishStrategy: 'never',
    voltOpsSync: { sampling: { strategy: 'never' } },
});
AgentRegistry.getInstance().setGlobalObservability(observability);
test.after(async () => {
    await observability.shutdown();
});

test('the qualified route sends text once and returns normalized usage without SDK generation', async (t) => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    t.mock.method(
        globalThis,
        'fetch',
        async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
            requests.push({ url, body: JSON.parse(String(init.body)) });
            return Response.json({
                model: 'openai/gpt-5-mini',
                provider: 'OpenAI',
                choices: [
                    {
                        message: { content: 'PRIVATE ANSWER' },
                        finish_reason: 'stop',
                    },
                ],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15,
                },
            });
        }
    );
    const runtime = createEphemeralOpenRouterRuntime({
        apiKey: 'synthetic-key',
    });
    const result = await runtime.generate({
        provider: 'openrouter',
        model: 'openai/gpt-5-mini',
        messages: [{ role: 'user', content: 'PRIVATE INPUT' }],
        maxOutputTokens: 100,
    });
    assert.equal(runtime.supportsEphemeralContent, true);
    assert.equal(requests.length, 1);
    assert.equal(
        requests[0].url,
        'https://openrouter.ai/api/v1/chat/completions'
    );
    assert.deepEqual(requests[0].body.messages, [
        { role: 'user', content: 'PRIVATE INPUT' },
    ]);
    assert.equal(
        (requests[0].body.provider as Record<string, unknown>).allow_fallbacks,
        false
    );
    assert.equal(result.text, 'PRIVATE ANSWER');
    assert.deepEqual(result.usage, {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
    });
});

test('structured requests preserve schema and routing controls without enabling tools or caching', async (t) => {
    let body: Record<string, unknown> | undefined;
    t.mock.method(
        globalThis,
        'fetch',
        async (
            _url: string,
            init: NonNullable<Parameters<typeof fetch>[1]>
        ) => {
            body = JSON.parse(String(init.body));
            return Response.json({
                choices: [
                    {
                        message: { content: '{"decision":"finalize"}' },
                        finish_reason: 'stop',
                    },
                ],
            });
        }
    );
    const result = await createEphemeralOpenRouterRuntime({
        apiKey: 'synthetic-key',
    }).generate({
        provider: 'openrouter',
        model: 'openai/gpt-5-mini',
        messages: [{ role: 'system', content: 'PRIVATE SYSTEM' }],
        structuredOutput: {
            name: 'decision',
            schema: {
                type: 'object',
                properties: { decision: { type: 'string' } },
                required: ['decision'],
                additionalProperties: false,
            },
        },
        providerRouting: {
            openrouter: { only: ['OpenAI'], dataCollection: 'deny', zdr: true },
        },
        capabilities: {
            canUseSearch: false,
            supportedReasoningEfforts: ['low'],
        },
        reasoningEffort: 'low',
        temperature: 0.2,
        topP: 0.9,
    });
    assert.equal(result.text, '{"decision":"finalize"}');
    assert.equal(
        (body?.response_format as Record<string, unknown>)?.type,
        'json_schema'
    );
    assert.deepEqual(body?.provider, {
        only: ['OpenAI'],
        data_collection: 'deny',
        zdr: true,
        require_parameters: true,
        allow_fallbacks: false,
    });
    assert.deepEqual(body?.reasoning, { effort: 'low' });
    assert.equal(body?.temperature, 0.2);
    assert.equal(body?.top_p, 0.9);
    assert.deepEqual(body?.plugins, []);
    assert.equal(body?.tools, undefined);
    assert.equal(body?.prompt_cache_key, undefined);
});

test('provider attribution cannot smuggle echoed private content into execution metadata', async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
        Response.json({
            model: 'openai/gpt-5-mini',
            choices: [
                {
                    message: { content: 'PRIVATE ANSWER' },
                    finish_reason: 'stop',
                },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
            openrouter_metadata: {
                endpoints: {
                    available: [
                        {
                            selected: true,
                            provider: 'PRIVATE INPUT',
                            model: 'PRIVATE ANSWER',
                        },
                    ],
                },
            },
        })
    );
    const result = await createEphemeralOpenRouterRuntime({
        apiKey: 'synthetic-key',
    }).generate({
        provider: 'openrouter',
        model: 'openai/gpt-5-mini',
        messages: [],
    });
    assert.equal(result.text, 'PRIVATE ANSWER');
    assert.equal(result.model, 'openai/gpt-5-mini');
    assert.equal(result.upstreamAttribution, undefined);
});

test('errors and invalid provider output cannot expose response bodies or transport causes', async (t) => {
    const runtime = createEphemeralOpenRouterRuntime({
        apiKey: 'synthetic-key',
    });
    const request = {
        provider: 'openrouter' as const,
        model: 'openai/gpt-5-mini',
        messages: [{ role: 'user' as const, content: 'PRIVATE INPUT' }],
    };
    for (const response of [
        () => new Response('PRIVATE ERROR BODY', { status: 500 }),
        () => new Response('PRIVATE INVALID JSON'),
        () =>
            Response.json({
                choices: [
                    {
                        message: { content: 'PRIVATE FILTERED' },
                        finish_reason: 'content_filter',
                    },
                ],
            }),
        () =>
            Response.json({
                choices: [
                    {
                        message: {
                            content: null,
                            tool_calls: [{ arguments: 'PRIVATE TOOL' }],
                        },
                        finish_reason: 'tool_calls',
                    },
                ],
            }),
        () => {
            throw new Error('PRIVATE TRANSPORT');
        },
    ]) {
        t.mock.method(globalThis, 'fetch', async () => response());
        await assert.rejects(runtime.generate(request), (error: Error) => {
            assert.doesNotMatch(error.message, /PRIVATE/);
            assert.equal(error.cause, undefined);
            return true;
        });
    }
});

test('instrumentation registered after construction is rejected before any request or callback', async (t) => {
    const runtime = createEphemeralOpenRouterRuntime({
        apiKey: 'synthetic-key',
    });
    const original = globalThis.AI_SDK_TELEMETRY_INTEGRATIONS;
    let observations = 0;
    const remote = t.mock.method(globalThis, 'fetch', async () => {
        throw new Error('PRIVATE NETWORK');
    });
    try {
        registerTelemetryIntegration({
            onStart: () => {
                observations += 1;
            },
        });
        await assert.rejects(
            runtime.generate({
                provider: 'openrouter',
                model: 'openai/gpt-5-mini',
                messages: [{ role: 'user', content: 'PRIVATE INPUT' }],
            }),
            /instrumentation/
        );
        assert.equal(remote.mock.callCount(), 0);
        assert.equal(observations, 0);
    } finally {
        globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = original;
    }
});

test('unsupported routes, retrieval, identities and provider fallback are denied before HTTP', async (t) => {
    const runtime = createEphemeralOpenRouterRuntime({
        apiKey: 'synthetic-key',
    });
    const remote = t.mock.method(globalThis, 'fetch', async () => {
        throw new Error('PRIVATE NETWORK');
    });
    const request = {
        provider: 'openrouter' as const,
        model: 'openai/gpt-5-mini',
        messages: [{ role: 'user' as const, content: 'PRIVATE INPUT' }],
    };
    const changes: Partial<GenerationRequest>[] = [
        { provider: 'openai' as const },
        { model: 'another/model' },
        {
            search: {
                query: 'PRIVATE QUERY',
                intent: 'current_facts' as const,
                contextSize: 'low',
            },
        },
        { userId: 'PRIVATE ID' },
        { providerRouting: { openrouter: { allowFallbacks: true } } },
    ];
    for (const change of changes) {
        await assert.rejects(
            runtime.generate({ ...request, ...change }),
            /not qualified/
        );
    }
    assert.equal(remote.mock.callCount(), 0);
});

test('instrumentation added during HTTP cannot observe content and blocks the next invocation', async (t) => {
    const original = globalThis.AI_SDK_TELEMETRY_INTEGRATIONS;
    let observations = 0;
    const runtime = createEphemeralOpenRouterRuntime({
        apiKey: 'synthetic-key',
    });
    const request: GenerationRequest = {
        provider: 'openrouter',
        model: 'openai/gpt-5-mini',
        messages: [{ role: 'user', content: 'PRIVATE INPUT' }],
    };
    const remote = t.mock.method(globalThis, 'fetch', async () => {
        registerTelemetryIntegration({
            onStart: () => {
                observations += 1;
            },
            onFinish: () => {
                observations += 1;
            },
        });
        return Response.json({
            choices: [
                {
                    message: { content: 'PRIVATE ANSWER' },
                    finish_reason: 'stop',
                },
            ],
        });
    });
    try {
        assert.equal((await runtime.generate(request)).text, 'PRIVATE ANSWER');
        await assert.rejects(runtime.generate(request), /instrumentation/);
        assert.equal(observations, 0);
        assert.equal(remote.mock.callCount(), 1);
    } finally {
        globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = original;
    }
});

test('active VoltAgent diagnostics receive neither successful nor failed request content', async (t) => {
    const events: unknown[] = [];
    const consoleOutput: unknown[] = [];
    for (const method of ['log', 'debug', 'info', 'warn', 'error'] as const)
        t.mock.method(console, method, (...args: unknown[]) => {
            consoleOutput.push(args);
        });
    const unsubscribe = observability.subscribeToWebSocketEvents(
        (event: unknown) => {
            events.push(event);
        }
    );
    observability
        .startSpan('diagnostic-control', { attributes: { marker: 'control' } })
        .end();
    await observability.forceFlush();
    assert.ok((await diagnosticStorage.listTraces()).length > 0);
    t.mock.method(globalThis, 'fetch', async () =>
        Response.json({
            choices: [
                {
                    message: { content: 'PRIVATE ANSWER' },
                    finish_reason: 'stop',
                },
            ],
        })
    );
    const runtime = createEphemeralOpenRouterRuntime({
        apiKey: 'synthetic-key',
    });
    const request: GenerationRequest = {
        provider: 'openrouter',
        model: 'openai/gpt-5-mini',
        messages: [{ role: 'user', content: 'PRIVATE INPUT' }],
    };
    assert.equal((await runtime.generate(request)).text, 'PRIVATE ANSWER');
    t.mock.method(globalThis, 'fetch', async () => {
        throw new Error('PRIVATE FAILURE');
    });
    await assert.rejects(runtime.generate(request), /generation failed/);
    await observability.forceFlush();
    const traces = await Promise.all(
        (await diagnosticStorage.listTraces()).map((id) =>
            diagnosticStorage.getTrace(id)
        )
    );
    const logs = await diagnosticStorage.queryLogs({});
    assert.doesNotMatch(
        JSON.stringify([traces, logs, events, consoleOutput]),
        /PRIVATE/
    );
    unsubscribe?.();
});

test('abort reaches HTTP without leaking its reason or retrying', async (t) => {
    const runtime = createEphemeralOpenRouterRuntime({
        apiKey: 'synthetic-key',
    });
    const controller = new AbortController();
    const remote = t.mock.method(
        globalThis,
        'fetch',
        async (_url: string, init: NonNullable<Parameters<typeof fetch>[1]>) =>
            new Promise<Response>((_resolve, reject) => {
                assert.equal(init.signal, controller.signal);
                init.signal?.addEventListener(
                    'abort',
                    () => reject(new Error('PRIVATE ABORT')),
                    { once: true }
                );
            })
    );
    const request: GenerationRequest = {
        provider: 'openrouter',
        model: 'openai/gpt-5-mini',
        messages: [{ role: 'user', content: 'PRIVATE INPUT' }],
        signal: controller.signal,
    };
    const pending = runtime.generate(request);
    controller.abort('PRIVATE REASON');
    await assert.rejects(
        pending,
        (error: Error) =>
            error.name === 'AbortError' && !error.message.includes('PRIVATE')
    );
    await assert.rejects(runtime.generate(request), { name: 'AbortError' });
    assert.equal(remote.mock.callCount(), 1);
});

test('HTTP errors retain safe provider classifications and never retry', async (t) => {
    const runtime = createEphemeralOpenRouterRuntime({
        apiKey: 'synthetic-key',
    });
    for (const [status, classification] of [
        [402, 'provider_temporary_unavailable'],
        [401, 'provider_temporary_unavailable'],
        [429, 'transient'],
        [503, 'transient'],
    ] as const) {
        const remote = t.mock.method(
            globalThis,
            'fetch',
            async () => new Response('PRIVATE PROVIDER ERROR', { status })
        );
        await assert.rejects(
            runtime.generate({
                provider: 'openrouter',
                model: 'openai/gpt-5-mini',
                messages: [],
            }),
            (error: unknown) => {
                assert.ok(error instanceof Error && 'details' in error);
                assert.equal(
                    (error.details as { classification: string })
                        .classification,
                    classification
                );
                assert.doesNotMatch(error.message, /PRIVATE/);
                return true;
            }
        );
        assert.equal(remote.mock.callCount(), 1);
    }
});
