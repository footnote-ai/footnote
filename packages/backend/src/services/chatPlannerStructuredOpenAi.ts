/**
 * @description: Executes the planner via OpenAI Responses function calling to enforce a structured planner decision payload.
 * @footnote-scope: core
 * @footnote-module: ChatPlannerStructuredOpenAI
 * @footnote-risk: high - API contract mistakes here can hard-fail planner execution.
 * @footnote-ethics: high - Structured planner correctness affects grounding and response behavior.
 */
import {
    GenerationRuntimeError,
    type GenerationUsage,
    type RuntimeMessage,
} from '@footnote/agent-runtime';
import type { SupportedReasoningEffort } from '@footnote/contracts';
import {
    CHAT_PLANNER_TOOL_NAME,
    chatPlannerDecisionTool,
} from './chatPlannerDecisionContract.js';

type ChatPlannerStructuredExecutionRequest = {
    messages: RuntimeMessage[];
    model: string;
    maxOutputTokens: number;
    reasoningEffort?: SupportedReasoningEffort;
    verbosity?: 'low' | 'medium' | 'high';
    safetyIdentifier?: string;
    signal?: AbortSignal;
};

type PlannerToolCallOutputItem = {
    type?: string;
    name?: string;
    arguments?: string;
    status?: string;
};

type ChatPlannerStructuredExecutionResult = {
    decision: unknown;
    model?: string;
    usage?: GenerationUsage;
    rawArguments?: string;
};

type CreateOpenAiChatPlannerStructuredExecutorOptions = {
    apiKey: string;
    retryAttempts?: number;
};

type ResponsesInputMessage = {
    role: string;
    type: 'message';
    content:
        | string
        | Array<{
              type: 'input_text';
              text: string;
          }>;
};

type ResponsesUsage = {
    input_tokens?: number;
    input_tokens_details?: {
        cached_tokens?: number;
        cache_write_tokens?: number;
    };
    output_tokens?: number;
    total_tokens?: number;
};

const STRUCTURED_OUTPUT_UNAVAILABLE_ERROR_CODES = new Set([
    'json_schema_not_supported',
    'response_format_not_supported',
    'schema_not_supported',
    'structured_output_not_supported',
    'unsupported_response_format',
]);

const readProviderErrorCode = (value: unknown): string | undefined => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    const nestedError = record.error;
    if (
        typeof nestedError === 'object' &&
        nestedError !== null &&
        !Array.isArray(nestedError)
    ) {
        const nestedCode = (nestedError as Record<string, unknown>).code;
        if (typeof nestedCode === 'string') {
            return nestedCode.trim().toLowerCase();
        }
    }
    return typeof record.code === 'string'
        ? record.code.trim().toLowerCase()
        : undefined;
};

const readNonNegativeInteger = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : undefined;

const normalizeResponsesUsage = (
    usage: ResponsesUsage | undefined
): GenerationUsage | undefined => {
    const promptTokens = readNonNegativeInteger(usage?.input_tokens);
    const cachedInputTokens = readNonNegativeInteger(
        usage?.input_tokens_details?.cached_tokens
    );
    const cacheWriteTokens = readNonNegativeInteger(
        usage?.input_tokens_details?.cache_write_tokens
    );
    const completionTokens = readNonNegativeInteger(usage?.output_tokens);
    const reportedTotalTokens = readNonNegativeInteger(usage?.total_tokens);
    const hasComponentTokens =
        promptTokens !== undefined || completionTokens !== undefined;
    const totalTokens =
        reportedTotalTokens ??
        (hasComponentTokens
            ? (promptTokens ?? 0) + (completionTokens ?? 0)
            : undefined);
    const normalized: GenerationUsage = {
        ...(promptTokens !== undefined && { promptTokens }),
        ...(cachedInputTokens !== undefined && { cachedInputTokens }),
        ...(cacheWriteTokens !== undefined && { cacheWriteTokens }),
        ...(completionTokens !== undefined && { completionTokens }),
        ...(totalTokens !== undefined && { totalTokens }),
    };
    return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeVerbosity = (
    value: ChatPlannerStructuredExecutionRequest['verbosity']
): 'low' | 'medium' | 'high' => {
    if (value === 'medium' || value === 'high') {
        return value;
    }
    return 'low';
};

const toResponsesInputMessages = (
    messages: RuntimeMessage[]
): ResponsesInputMessage[] =>
    messages.map((message) => ({
        role: message.role,
        type: 'message',
        content:
            message.role === 'assistant'
                ? message.content
                : [
                      {
                          type: 'input_text',
                          text: message.content,
                      },
                  ],
    }));

export const createOpenAiChatPlannerStructuredExecutor = ({
    apiKey,
    retryAttempts = 1,
}: CreateOpenAiChatPlannerStructuredExecutorOptions) => {
    return async (
        request: ChatPlannerStructuredExecutionRequest
    ): Promise<ChatPlannerStructuredExecutionResult> => {
        const requestBody = JSON.stringify({
            model: request.model,
            input: toResponsesInputMessages(request.messages),
            max_output_tokens: request.maxOutputTokens,
            ...(request.reasoningEffort !== undefined && {
                reasoning: {
                    effort: request.reasoningEffort,
                },
            }),
            ...(request.safetyIdentifier !== undefined && {
                safety_identifier: request.safetyIdentifier,
            }),
            ...(request.verbosity !== undefined && {
                text: {
                    verbosity: normalizeVerbosity(request.verbosity),
                },
            }),
            tools: [chatPlannerDecisionTool],
            tool_choice: {
                type: 'function',
                name: CHAT_PLANNER_TOOL_NAME,
            },
        });

        const performRequest = async (attempt: number): Promise<Response> => {
            try {
                return await fetch('https://api.openai.com/v1/responses', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: requestBody,
                    signal: request.signal,
                });
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    throw new Error('Planner structured call was aborted', {
                        cause: error,
                    });
                }

                if (attempt < retryAttempts) {
                    const backoffMs = 300 * (attempt + 1);
                    await new Promise((resolve) =>
                        setTimeout(resolve, backoffMs)
                    );
                    return performRequest(attempt + 1);
                }

                throw error;
            }
        };

        const response = await performRequest(0);
        if (!response.ok) {
            const errorText = await response.text();
            let payload: unknown;
            try {
                payload = JSON.parse(errorText) as unknown;
            } catch {
                payload = undefined;
            }
            const providerErrorCode = readProviderErrorCode(payload);
            if (
                providerErrorCode !== undefined &&
                STRUCTURED_OUTPUT_UNAVAILABLE_ERROR_CODES.has(providerErrorCode)
            ) {
                throw new GenerationRuntimeError(
                    'Planner structured transport is unavailable.',
                    { classification: 'structured_output_unavailable' }
                );
            }
            throw new Error(
                `Planner structured API error: ${response.status} ${response.statusText} - ${errorText}`
            );
        }

        const data = (await response.json()) as {
            model?: string;
            usage?: ResponsesUsage;
            output?: PlannerToolCallOutputItem[];
        };

        const responseModel = data.model ?? request.model;
        const usage = normalizeResponsesUsage(data.usage);

        const outputItems = Array.isArray(data.output) ? data.output : [];
        const functionCallItem = outputItems.find(
            (item) =>
                item.type === 'function_call' &&
                item.name === CHAT_PLANNER_TOOL_NAME
        );

        if (
            !functionCallItem?.arguments ||
            (functionCallItem.status !== undefined &&
                functionCallItem.status !== 'completed')
        ) {
            const plannerFailureOutcome =
                functionCallItem?.status === 'incomplete'
                    ? 'incomplete'
                    : functionCallItem?.status === 'refusal' ||
                        functionCallItem?.status === 'refused'
                      ? 'refusal'
                      : functionCallItem?.status === 'failed'
                        ? 'runtime_failure'
                        : 'no_output';
            throw Object.assign(
                new SyntaxError(
                    'Planner structured call did not return a completed function_call payload.'
                ),
                {
                    plannerFailureOutcome,
                    plannerModel: responseModel,
                    plannerUsage: usage,
                }
            );
        }

        let parsedDecision: unknown;
        try {
            parsedDecision = JSON.parse(functionCallItem.arguments) as unknown;
        } catch (error) {
            const parserMessage =
                error instanceof Error ? error.message : String(error);
            const argumentPreview = functionCallItem.arguments
                .replace(/\s+/g, ' ')
                .slice(0, 280);
            throw Object.assign(
                new SyntaxError(
                    `Failed structured planner argument parsing (length=${functionCallItem.arguments.length}): ${parserMessage}. preview=${argumentPreview}`,
                    { cause: error }
                ),
                {
                    plannerFailureOutcome: 'parse_failure',
                    plannerModel: responseModel,
                    plannerUsage: usage,
                }
            );
        }
        return {
            decision: parsedDecision,
            model: responseModel,
            usage,
            rawArguments: functionCallItem.arguments,
        };
    };
};
