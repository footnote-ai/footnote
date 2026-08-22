/**
 * @description: Pins the installed VoltAgent and AI SDK OpenAI Responses path and the controls Footnote relies on.
 * @footnote-scope: test
 * @footnote-module: OpenAIResponsesConformanceTests
 * @footnote-risk: medium - Dependency drift can silently change the provider endpoint or request controls.
 * @footnote-ethics: medium - Reliable execution facts support transparent model behavior and safety controls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    Agent,
    AgentRegistry,
    createVoltAgentObservability,
} from '@voltagent/core';
import {
    createDefaultVoltAgentExecutor,
    normalizeVoltAgentResult,
    type VoltAgentTextResult,
} from '../src/voltagentRuntime.js';

type CapturedRequest = {
    url: string;
    body: Record<string, unknown>;
};

const testObservability = createVoltAgentObservability({
    serviceName: 'openai-responses-conformance-test',
    flushOnFinishStrategy: 'never',
    voltOpsSync: { sampling: { strategy: 'never' } },
    spanProcessors: [],
    logProcessors: [],
});
AgentRegistry.getInstance().setGlobalObservability(testObservability);

const responsesBody = (input: {
    text: string;
    model: string;
    responseId: string;
}): Record<string, unknown> => ({
    id: input.responseId,
    object: 'response',
    created_at: 0,
    status: 'completed',
    model: input.model,
    output: [
        {
            id: 'msg_test',
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [
                {
                    type: 'output_text',
                    annotations: [],
                    logprobs: [],
                    text: input.text,
                },
            ],
        },
    ],
    usage: {
        input_tokens: 12,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens: 7,
        output_tokens_details: { reasoning_tokens: 2 },
        total_tokens: 19,
    },
});

const withMockedResponses = async (
    response: Record<string, unknown>,
    execute: (captured: CapturedRequest[]) => Promise<void>
): Promise<void> => {
    const originalFetch = globalThis.fetch;
    const captured: CapturedRequest[] = [];
    const originalApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
        const [input, init] = args;
        const body =
            typeof init?.body === 'string'
                ? (JSON.parse(init.body) as Record<string, unknown>)
                : {};
        captured.push({
            url: String(input),
            body,
        });
        return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }) as typeof fetch;

    try {
        await execute(captured);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalApiKey === undefined) {
            delete process.env.OPENAI_API_KEY;
        } else {
            process.env.OPENAI_API_KEY = originalApiKey;
        }
    }
};

const createExecutor = () =>
    createDefaultVoltAgentExecutor({
        model: 'openai/gpt-5.6-luna',
        agentFactory: ({ model, instructions, tools }) =>
            new Agent({
                name: 'openai-responses-conformance',
                model,
                instructions:
                    instructions ??
                    'Continue the provided conversation transcript.',
                memory: false,
                maxSteps: 1,
                ...(tools !== undefined && { tools }),
            }),
    });

test.after(async () => {
    await testObservability.shutdown();
});

test('real VoltAgent executor uses OpenAI Responses and preserves relied-on controls', async () => {
    await withMockedResponses(
        responsesBody({
            text: 'A conformance response.',
            model: 'gpt-5.6-luna',
            responseId: 'resp_conformance_text',
        }),
        async (captured) => {
            const result = await createExecutor().generateText(
                [{ role: 'user', content: 'Summarize this test.' }],
                {
                    maxOutputTokens: 240,
                    providerOptions: {
                        reasoningEffort: 'low',
                        verbosity: 'low',
                        safetyIdentifier: 'pseudonymous-test-id',
                    },
                }
            );

            const request = captured[0];
            assert.ok(request);
            assert.equal(request.url, 'https://api.openai.com/v1/responses');
            assert.equal(request.body.model, 'gpt-5.6-luna');
            assert.equal(request.body.max_output_tokens, 240);
            assert.deepEqual(request.body.reasoning, { effort: 'low' });
            assert.equal(
                request.body.safety_identifier,
                'pseudonymous-test-id'
            );
            assert.deepEqual(request.body.text, { verbosity: 'low' });
            assert.equal(request.body.tools, undefined);
            assert.equal(result.text, 'A conformance response.');
            assert.equal(result.response?.modelId, 'gpt-5.6-luna');
            assert.equal(
                (result.response?.body as { id?: string } | undefined)?.id,
                'resp_conformance_text'
            );
            assert.equal('id' in (result.response ?? {}), false);
            const normalized = normalizeVoltAgentResult(
                'openai/gpt-5.6-luna',
                {
                    model: 'gpt-5.6-luna',
                    messages: [
                        { role: 'user', content: 'Summarize this test.' },
                    ],
                },
                result
            );
            assert.equal(normalized.model, 'gpt-5.6-luna');
            assert.equal('responseId' in normalized, false);
        }
    );
});

test('real VoltAgent executor sends structured output through the Responses path', async () => {
    await withMockedResponses(
        responsesBody({
            text: '{"ready":true}',
            model: 'gpt-5.6-luna',
            responseId: 'resp_conformance_structured',
        }),
        async (captured) => {
            const result: VoltAgentTextResult =
                await createExecutor().generateText(
                    [{ role: 'user', content: 'Return the readiness result.' }],
                    {
                        structuredOutput: {
                            name: 'readiness_result',
                            schema: {
                                type: 'object',
                                properties: { ready: { type: 'boolean' } },
                                required: ['ready'],
                                additionalProperties: false,
                            },
                        },
                    }
                );

            const request = captured[0];
            assert.ok(request);
            assert.equal(request.url, 'https://api.openai.com/v1/responses');
            const text = request.body.text as Record<string, unknown>;
            const format = text.format as Record<string, unknown>;
            assert.equal(format.type, 'json_schema');
            assert.equal(format.name, 'readiness_result');
            assert.deepEqual(format.schema, {
                type: 'object',
                properties: { ready: { type: 'boolean' } },
                required: ['ready'],
                additionalProperties: false,
            });
            assert.equal(result.text, '{"ready":true}');
            assert.equal(
                (result.response?.body as { id?: string } | undefined)?.id,
                'resp_conformance_structured'
            );
            assert.equal('id' in (result.response ?? {}), false);
        }
    );
});

test('real VoltAgent executor requires the configured Responses search tool', async () => {
    await withMockedResponses(
        responsesBody({
            text: 'A retrieved conformance response.',
            model: 'gpt-5.6-luna',
            responseId: 'resp_conformance_search',
        }),
        async (captured) => {
            await createExecutor().generateText(
                [{ role: 'user', content: 'What is current?' }],
                {
                    search: {
                        query: 'current repository status',
                        contextSize: 'low',
                        intent: 'current_facts',
                    },
                }
            );

            const request = captured[0];
            assert.ok(request);
            assert.equal(request.url, 'https://api.openai.com/v1/responses');
            assert.equal(request.body.tool_choice, 'required');
            assert.ok(Array.isArray(request.body.tools));
            assert.equal(request.body.tools.length, 1);
            const searchTool = request.body.tools[0] as Record<string, unknown>;
            assert.equal(searchTool.type, 'web_search');
            assert.equal(searchTool.search_context_size, 'low');
        }
    );
});
