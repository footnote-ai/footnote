/**
 * @description: Provides one non-streaming OpenRouter text route without agent or SDK diagnostic capture.
 * @footnote-scope: core
 * @footnote-module: EphemeralOpenRouterRuntime
 * @footnote-risk: high - Routing or instrumentation mistakes can expose ephemeral conversation content.
 * @footnote-ethics: high - Local privacy qualification does not establish upstream retention policy.
 */
import { z } from 'zod';
import type { GenerationRuntime } from './index.js';
import { GenerationRuntimeError } from './index.js';
import {
    createVoltAgentRuntime,
    mergeOpenRouterRequestBody,
} from './voltagentRuntime.js';

const MODEL = 'openai/gpt-5-mini';
const completionSchema = z.object({
    model: z.literal(MODEL).optional(),
    choices: z
        .array(
            z.object({
                message: z.object({
                    content: z.string(),
                    tool_calls: z.array(z.unknown()).max(0).optional(),
                    refusal: z.null().optional(),
                }),
                finish_reason: z.enum(['stop', 'length']),
            })
        )
        .length(1),
    usage: z.unknown().optional(),
});

/** Uses the existing executor seam for mapping, but never constructs a VoltAgent Agent. */
export const createEphemeralOpenRouterRuntime = ({
    apiKey,
}: {
    apiKey: string;
}): GenerationRuntime => {
    if (!apiKey.trim()) throw new Error('OpenRouter API key is required.');
    const runtime = createVoltAgentRuntime({
        kind: 'ephemeral-openrouter',
        defaultModel: `openrouter/${MODEL}`,
        openrouter: { apiKey },
        createExecutor: () => ({
            async generateText(messages, options) {
                const hints = options.providerOptions?.providerHints
                    ?.openrouter as
                    | {
                          provider?: Record<string, unknown>;
                          reasoning?: { effort: string };
                      }
                    | undefined;
                try {
                    const response = await fetch(
                        'https://openrouter.ai/api/v1/chat/completions',
                        {
                            method: 'POST',
                            redirect: 'error',
                            headers: {
                                Authorization: `Bearer ${apiKey}`,
                                'Content-Type': 'application/json',
                            },
                            signal: options.signal,
                            body: JSON.stringify(
                                mergeOpenRouterRequestBody(
                                    {
                                        model: MODEL,
                                        messages: messages.map(
                                            ({ role, content }) => ({
                                                role,
                                                content,
                                            })
                                        ),
                                        max_tokens: options.maxOutputTokens,
                                        temperature: options.temperature,
                                        top_p: options.topP,
                                        reasoning: hints?.reasoning,
                                        provider: { allow_fallbacks: false },
                                        ...(options.structuredOutput !==
                                        undefined
                                            ? {
                                                  response_format: {
                                                      type: 'json_schema',
                                                      json_schema: {
                                                          name:
                                                              options
                                                                  .structuredOutput
                                                                  .name ??
                                                              'response',
                                                          strict: true,
                                                          schema: options
                                                              .structuredOutput
                                                              .schema,
                                                      },
                                                  },
                                              }
                                            : options.jsonMode
                                              ? {
                                                    response_format: {
                                                        type: 'json_object',
                                                    },
                                                }
                                              : {}),
                                        stream: false,
                                        plugins: [],
                                    },
                                    hints?.provider
                                )
                            ),
                        }
                    );
                    if (!response.ok) {
                        await response.body?.cancel();
                        if (
                            response.status === 402 ||
                            response.status === 401 ||
                            response.status === 403
                        )
                            throw new GenerationRuntimeError(
                                'OpenRouter account is unavailable.',
                                {
                                    classification:
                                        'provider_temporary_unavailable',
                                    availabilityReason:
                                        response.status === 402
                                            ? 'billing_or_quota'
                                            : 'account_unavailable',
                                }
                            );
                        if (response.status === 429 || response.status >= 500)
                            throw new GenerationRuntimeError(
                                'OpenRouter request temporarily failed.',
                                { classification: 'transient' }
                            );
                        throw new Error('OpenRouter request failed.');
                    }
                    const payload: unknown = await response.json();
                    const result = completionSchema.parse(payload);
                    if (
                        options.structuredOutput !== undefined ||
                        options.jsonMode
                    )
                        JSON.parse(result.choices[0].message.content);
                    return {
                        text: result.choices[0].message.content,
                        finishReason: result.choices[0].finish_reason,
                        response: {
                            modelId: `openrouter/${MODEL}`,
                            body: { usage: result.usage },
                        },
                        // Endpoint attribution is unqualified free text and may echo call content.
                    };
                } catch (error) {
                    if (options.signal?.aborted)
                        throw new globalThis.DOMException(
                            'Ephemeral generation aborted.',
                            'AbortError'
                        );
                    if (error instanceof GenerationRuntimeError) throw error;
                    // Raw provider errors, JSON parser messages and causes may echo private content.
                    // eslint-disable-next-line preserve-caught-error -- Retaining the cause would retain private provider content.
                    throw new Error('Ephemeral OpenRouter generation failed.');
                }
            },
        }),
    });
    return {
        ...runtime,
        supportsEphemeralContent: true,
        async generate(request) {
            // Pinned AI SDK 6 exposes content callbacks independently of its tracing flag.
            const instrumentation = Object.getOwnPropertyDescriptor(
                globalThis,
                'AI_SDK_TELEMETRY_INTEGRATIONS'
            );
            if (
                instrumentation &&
                (instrumentation.get ||
                    (instrumentation.value !== undefined &&
                        (!Array.isArray(instrumentation.value) ||
                            instrumentation.value.length > 0)))
            )
                throw Object.assign(
                    new Error(
                        'Ephemeral generation rejects unsafe instrumentation.'
                    ),
                    { preProviderCallFailure: true }
                );
            if (
                request.provider !== 'openrouter' ||
                (request.model !== MODEL &&
                    request.model !== `openrouter/${MODEL}`) ||
                request.search !== undefined ||
                request.userId !== undefined ||
                request.providerRouting?.openrouter?.allowFallbacks === true ||
                request.promptCache?.enabled === true
            )
                throw Object.assign(
                    new Error(
                        'Generation route or controls are not qualified for ephemeral content.'
                    ),
                    { preProviderCallFailure: true }
                );
            if (request.signal?.aborted)
                throw Object.assign(
                    new globalThis.DOMException(
                        'Ephemeral generation aborted.',
                        'AbortError'
                    ),
                    { preProviderCallFailure: true }
                );
            return runtime.generate(request);
        },
    };
};
