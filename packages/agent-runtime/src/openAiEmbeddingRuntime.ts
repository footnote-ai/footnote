/**
 * @description: Calls the OpenAI embeddings API behind Footnote's shared embedding runtime boundary.
 * Keeps embedding failures observable so the project-context integration decides fail-open continuation.
 * @footnote-scope: core
 * @footnote-module: OpenAiEmbeddingRuntime
 * @footnote-risk: high - Incorrect request or result mapping can leak or misattribute embedded evidence.
 * @footnote-ethics: medium - Embedding content touches user text; failures must not silently look like empty results.
 */
import OpenAI from 'openai';
import type {
    EmbeddingRequest,
    EmbeddingRuntime,
    EmbeddingRuntimeResult,
} from './index.js';

type OpenAiEmbeddingResponseData = Array<{ embedding: number[] }>;

export type OpenAiEmbeddingRuntimeClient = {
    createEmbeddings: (request: {
        model: string;
        input: string[];
        signal?: AbortSignal;
    }) => Promise<{
        data: OpenAiEmbeddingResponseData;
        usage?: {
            prompt_tokens?: number;
            total_tokens?: number;
        };
    }>;
};

export interface OpenAiEmbeddingRuntimeLogger {
    warn?: (message: string, data?: Record<string, unknown>) => void;
    error?: (message: string, data?: Record<string, unknown>) => void;
}

export interface CreateOpenAiEmbeddingRuntimeOptions {
    apiKey?: string;
    /** Optional OpenAI-compatible endpoint for explicitly configured providers. */
    baseURL?: string;
    client?: OpenAiEmbeddingRuntimeClient;
    logger?: OpenAiEmbeddingRuntimeLogger;
    kind?: string;
}

const createDefaultClient = (
    apiKey: string,
    baseURL?: string
): OpenAiEmbeddingRuntimeClient => {
    const openai = new OpenAI({
        apiKey,
        ...(baseURL !== undefined && { baseURL }),
    });
    return {
        createEmbeddings: async (request) =>
            openai.embeddings.create(
                {
                    model: request.model,
                    input: request.input,
                },
                request.signal === undefined
                    ? undefined
                    : {
                          signal: request.signal,
                      }
            ),
    };
};

const emptyListResult = (
    model: string | undefined,
    provider: string | undefined
): EmbeddingRuntimeResult => ({
    status: 'error',
    reason: 'Embedding request requires at least one text.',
    ...(model !== undefined && { model }),
    ...(provider !== undefined && { provider }),
});

export const createOpenAiEmbeddingRuntime = ({
    apiKey,
    baseURL,
    client,
    logger,
    kind = 'openai-embedding',
}: CreateOpenAiEmbeddingRuntimeOptions): EmbeddingRuntime => {
    const embeddingClient =
        client ??
        (apiKey
            ? createDefaultClient(apiKey, baseURL)
            : (() => {
                  throw new Error(
                      'OpenAI embedding runtime requires either apiKey or client.'
                  );
              })());

    return {
        kind,
        async embed(
            request: EmbeddingRequest
        ): Promise<EmbeddingRuntimeResult> {
            if (request.texts.length === 0) {
                return emptyListResult(request.model, request.provider);
            }

            const startedAt = Date.now();
            try {
                // OpenAI embeddings keeps response data aligned with the input
                // array, so pass the whole array and map by index.
                const response = await embeddingClient.createEmbeddings({
                    model: request.model,
                    input: request.texts,
                    ...(request.signal !== undefined && {
                        signal: request.signal,
                    }),
                });
                if (response.data.length !== request.texts.length) {
                    throw new Error(
                        `Embedding response returned ${response.data.length} vectors for ${request.texts.length} texts.`
                    );
                }
                const embeddings = response.data.map((item) => item.embedding);

                logger?.warn?.('Embedding runtime request succeeded.', {
                    model: request.model,
                    provider: request.provider,
                    textCount: request.texts.length,
                });

                return {
                    status: 'success',
                    embeddings,
                    model: request.model,
                    provider: request.provider,
                    texts: request.texts,
                    ...(response.usage?.prompt_tokens !== undefined && {
                        promptTokens: response.usage.prompt_tokens,
                    }),
                    ...(response.usage?.total_tokens !== undefined && {
                        totalTokens: response.usage.total_tokens,
                    }),
                    generationTimeMs: Date.now() - startedAt,
                };
            } catch (error) {
                const reason =
                    error instanceof Error ? error.message : String(error);
                logger?.error?.('Embedding request failed.', {
                    reason,
                    model: request.model,
                    provider: request.provider,
                });
                return {
                    status: 'error',
                    reason: `Embedding request failed: ${reason}`,
                    model: request.model,
                    provider: request.provider,
                };
            }
        },
    };
};
