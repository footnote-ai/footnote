/**
 * @description: Runs the trusted internal image task through the shared backend image runtime.
 * @footnote-scope: core
 * @footnote-module: InternalImageTaskService
 * @footnote-risk: high - Invalid task wiring here can break image generation or return malformed artifacts to trusted callers.
 * @footnote-ethics: medium - Backend-owned image execution affects cost visibility and image-generation transparency.
 */
import type {
    ImageGenerationPartialImage,
    ImageGenerationRuntime,
    ImageGenerationResult,
} from '@footnote/agent-runtime';
import type {
    InternalImagePartialImageEvent,
    PostInternalImageGenerateRequest,
    PostInternalImageGenerateResponse,
} from '@footnote/contracts/web';
import type { ResponseMetadata } from '@footnote/contracts/policy';
import {
    internalImageRenderModels,
    internalImageTextModels,
} from '@footnote/contracts/providers';
import { PostInternalImageGenerateResponseSchema } from '@footnote/contracts/web/schemas';
import {
    recordBackendLLMUsage,
    type BackendLLMCostRecord,
} from './llmCostRecorder.js';
import { composeImagePrompts } from './prompts/imagePromptComposer.js';
import { buildInternalImageTraceMetadata } from './internalImageTraceMetadata.js';
import { logger } from '../utils/logger.js';

/**
 * @footnote-logger: internalImageTaskService
 * @logs: Image generation request metadata, usage summaries, and cost recording failures.
 * @footnote-risk: high - Missing logs hide backend image outages or cost spikes.
 * @footnote-ethics: medium - Image prompts can include user content, so logs stay metadata-only.
 */
const imageTaskLogger =
    typeof logger.child === 'function'
        ? logger.child({ module: 'internalImageTaskService' })
        : logger;

const MAX_DECODED_FINAL_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_DECODED_PREVIEW_IMAGE_BYTES = 4 * 1024 * 1024;

const estimateDecodedBase64Bytes = (value: string): number => {
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    return Math.floor((value.length * 3) / 4) - padding;
};

const assertImagePayloadLimit = (
    value: string,
    limit: number,
    label: 'final image' | 'partial preview'
): void => {
    if (estimateDecodedBase64Bytes(value) > limit) {
        throw new Error(
            `Internal image ${label} exceeded the decoded byte safety limit (${limit}).`
        );
    }
};

const logImageMemoryCheckpoint = (
    stage:
        | 'provider-partial-received'
        | 'provider-result-received'
        | 'provider-result-released',
    imageBytes: number
): void => {
    const memory = process.memoryUsage();
    imageTaskLogger.info('Image delivery memory checkpoint.', {
        stage,
        imageBytes,
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
    });
};

export type CreateInternalImageTaskServiceOptions = {
    imageGenerationRuntime: ImageGenerationRuntime;
    recordUsage?: (record: BackendLLMCostRecord) => void;
    storeTrace?: (metadata: ResponseMetadata) => Promise<void>;
};

export type RunInternalImageTaskOptions = {
    signal?: AbortSignal;
    onPartialImage?: (
        payload: InternalImagePartialImageEvent
    ) => Promise<void> | void;
};

export type InternalImageTaskService = {
    runImageTask(
        request: PostInternalImageGenerateRequest,
        options?: RunInternalImageTaskOptions
    ): Promise<PostInternalImageGenerateResponse>;
};

const isSupportedTextModel = (
    model: string
): model is PostInternalImageGenerateResponse['result']['textModel'] =>
    internalImageTextModels.includes(
        model as PostInternalImageGenerateResponse['result']['textModel']
    );

const isSupportedImageModel = (
    model: string
): model is PostInternalImageGenerateResponse['result']['imageModel'] =>
    internalImageRenderModels.includes(
        model as PostInternalImageGenerateResponse['result']['imageModel']
    );

const validateResponseTextModel = (
    model: string
): PostInternalImageGenerateResponse['result']['textModel'] => {
    if (!isSupportedTextModel(model)) {
        throw new Error(
            `Internal image task returned unsupported textModel: ${model}`
        );
    }

    return model;
};

const validateResponseImageModel = (
    model: string
): PostInternalImageGenerateResponse['result']['imageModel'] => {
    if (!isSupportedImageModel(model)) {
        throw new Error(
            `Internal image task returned unsupported imageModel: ${model}`
        );
    }

    return model;
};

const toInternalImageResponse = (
    result: ImageGenerationResult
): PostInternalImageGenerateResponse => ({
    task: 'generate',
    result: {
        responseId: result.responseId,
        textModel: validateResponseTextModel(result.textModel),
        imageModel: validateResponseImageModel(result.imageModel),
        revisedPrompt: result.revisedPrompt,
        finalStyle: result.finalStyle,
        annotations: result.annotations,
        finalImageBase64: result.finalImageBase64,
        outputFormat: result.outputFormat,
        outputCompression: result.outputCompression,
        usage: result.usage,
        costs: result.costs,
        generationTimeMs: result.generationTimeMs,
    },
});

export const createInternalImageTaskService = ({
    imageGenerationRuntime,
    recordUsage = recordBackendLLMUsage,
    storeTrace,
}: CreateInternalImageTaskServiceOptions): InternalImageTaskService => {
    const runImageTask = async (
        request: PostInternalImageGenerateRequest,
        options: RunInternalImageTaskOptions = {}
    ): Promise<PostInternalImageGenerateResponse> => {
        imageTaskLogger.debug('Internal image task starting.', {
            textModel: request.textModel,
            imageModel: request.imageModel,
            quality: request.quality,
            size: request.size,
            style: request.style,
            background: request.background,
            outputFormat: request.outputFormat,
            outputCompression: request.outputCompression,
            allowPromptAdjustment: Boolean(request.allowPromptAdjustment),
            stream: Boolean(request.stream),
            hasFollowUpResponseId: Boolean(request.followUpResponseId),
            promptLength: request.prompt.length,
        });
        const { systemPrompt, developerPrompt } = composeImagePrompts({
            prompt: request.prompt,
            allowPromptAdjustment: request.allowPromptAdjustment,
            size: request.size,
            quality: request.quality,
            background: request.background,
            style: request.style,
            user: request.user,
        });

        const result = await imageGenerationRuntime.generateImage({
            prompt: request.prompt,
            systemPrompt,
            developerPrompt,
            textModel: request.textModel,
            imageModel: request.imageModel,
            quality: request.quality,
            size: request.size,
            background: request.background,
            style: request.style,
            allowPromptAdjustment: request.allowPromptAdjustment,
            outputFormat: request.outputFormat,
            outputCompression: request.outputCompression,
            followUpResponseId: request.followUpResponseId,
            signal: options.signal,
            stream: request.stream,
            onPartialImage: options.onPartialImage
                ? async (payload: ImageGenerationPartialImage) => {
                      logImageMemoryCheckpoint(
                          'provider-partial-received',
                          payload.base64.length
                      );
                      assertImagePayloadLimit(
                          payload.base64,
                          MAX_DECODED_PREVIEW_IMAGE_BYTES,
                          'partial preview'
                      );
                      await options.onPartialImage?.({
                          type: 'partial_image',
                          index: payload.index,
                          base64: payload.base64,
                      });
                  }
                : undefined,
        });
        logImageMemoryCheckpoint(
            'provider-result-received',
            result.finalImageBase64.length
        );

        try {
            recordUsage({
                feature: 'image',
                model: result.imageModel,
                promptTokens: result.usage.inputTokens,
                completionTokens: result.usage.outputTokens,
                totalTokens: result.usage.totalTokens,
                inputCostUsd: result.costs.text,
                outputCostUsd: result.costs.image,
                totalCostUsd: result.costs.total,
                timestamp: Date.now(),
            });
        } catch (error) {
            imageTaskLogger.warn(
                `Internal image task usage recording failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        assertImagePayloadLimit(
            result.finalImageBase64,
            MAX_DECODED_FINAL_IMAGE_BYTES,
            'final image'
        );

        imageTaskLogger.info('Internal image task complete.', {
            imageModel: result.imageModel,
            textModel: result.textModel,
            outputFormat: result.outputFormat,
            outputCompression: result.outputCompression,
            generationTimeMs: result.generationTimeMs,
            usage: result.usage,
            costs: result.costs,
        });

        const response = toInternalImageResponse(result);
        result.finalImageBase64 = '';
        logImageMemoryCheckpoint('provider-result-released', 0);
        const parsed =
            PostInternalImageGenerateResponseSchema.safeParse(response);
        if (!parsed.success) {
            const firstIssue = parsed.error.issues[0];
            throw new Error(
                `Internal image task returned invalid artifact output: ${firstIssue?.path.join('.') ?? 'body'} ${firstIssue?.message ?? 'Invalid response'}`
            );
        }

        const traceMetadata = buildInternalImageTraceMetadata({
            request,
            response: parsed.data,
        });
        if (traceMetadata && storeTrace) {
            // Keep image generation fail-open even if trace persistence fails.
            try {
                const traceWritePromise = storeTrace(traceMetadata);
                if (
                    traceWritePromise &&
                    typeof traceWritePromise.catch === 'function'
                ) {
                    traceWritePromise.catch((error) => {
                        imageTaskLogger.warn(
                            `Internal image trace storage failed for response ${traceMetadata.responseId}: ${error instanceof Error ? error.message : String(error)}`
                        );
                    });
                }
            } catch (error) {
                imageTaskLogger.warn(
                    `Internal image trace storage failed for response ${traceMetadata.responseId}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        return parsed.data;
    };

    return {
        runImageTask,
    };
};
