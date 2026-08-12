/**
 * @description: Handles trusted internal image-task requests for backend-owned image workflows.
 * @footnote-scope: interface
 * @footnote-module: InternalImageHandler
 * @footnote-risk: high - Auth or validation mistakes here could expose internal-only image execution or allow malformed task payloads.
 * @footnote-ethics: medium - This route controls how trusted callers request backend-owned image tasks and should stay narrow by design.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
    InternalImageErrorEvent,
    InternalImagePartialImageEvent,
    PostInternalImageGenerateRequest,
    PostInternalImageGenerateResponse,
} from '@footnote/contracts/web';
import {
    InternalImageStreamEventSchema,
    PostInternalImageRequestSchema,
} from '@footnote/contracts/web/schemas';
import type { InternalImageTaskService } from '../services/internalImage.js';
import { SimpleRateLimiter } from '../services/rateLimiter.js';
import { logger } from '../utils/logger.js';
import { buildProviderUnavailableError, sendJson } from './chatResponses.js';
import {
    parseTrustedBodyWithSchema,
    parseTrustedServiceAuth,
    type TrustedRouteLogRequest,
} from './trustedServiceRequest.js';

/**
 * @footnote-logger: internalImageHandler
 * @logs: Auth decisions, request acceptance, and execution failures for internal image tasks.
 * @footnote-risk: high - Missing logs hide backend image outages or abuse.
 * @footnote-ethics: medium - Image prompts can include user content, so logs stay metadata-only.
 */
const imageLogger =
    typeof logger.child === 'function'
        ? logger.child({ module: 'internalImageHandler' })
        : logger;

const logImageMemoryCheckpoint = (
    stage:
        | 'stream-partial-write'
        | 'stream-result-write'
        | 'stream-cancelled'
        | 'stream-closed',
    imageBytes: number
): void => {
    const memory = process.memoryUsage();
    imageLogger.info('Image delivery memory checkpoint.', {
        stage,
        imageBytes,
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
    });
};

type CreateInternalImageHandlerOptions = {
    internalImageTaskService: InternalImageTaskService | null;
    logRequest: TrustedRouteLogRequest;
    maxBodyBytes: number;
    traceApiToken: string | null;
    serviceToken: string | null;
    serviceRateLimiter: SimpleRateLimiter;
};

const writeImageResult = (
    res: ServerResponse,
    prefix: string,
    result: PostInternalImageGenerateResponse['result'],
    suffix: string
): void => {
    const { finalImageBase64, ...resultMetadata } = result;
    const serializedMetadata = JSON.stringify(resultMetadata);
    res.write(prefix);
    res.write(serializedMetadata.slice(0, -1));
    res.write(',"finalImageBase64":"');
    if (/^[A-Za-z0-9+/]*={0,2}$/.test(finalImageBase64)) {
        res.write(finalImageBase64);
        res.write('"');
        res.write(suffix);
        return;
    }

    // Runtime adapters produce base64. Preserve the trusted route's existing
    // behavior for a malformed adapter result without making a second copy of
    // valid large payloads.
    res.write(JSON.stringify(finalImageBase64).slice(1));
    res.write(suffix);
};

const sendImageResponse = (
    res: ServerResponse,
    response: PostInternalImageGenerateResponse
): void => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    writeImageResult(
        res,
        '{"task":"generate","result":',
        response.result,
        '}}'
    );
    res.end();
};

const writeStreamEvent = (
    res: ServerResponse,
    event:
        | InternalImagePartialImageEvent
        | InternalImageErrorEvent
        | {
              type: 'result';
              task: 'generate';
              result: Awaited<
                  ReturnType<InternalImageTaskService['runImageTask']>
              >['result'];
          }
): void => {
    const parsed = InternalImageStreamEventSchema.safeParse(event);
    if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        throw new Error(
            `Invalid internal image stream event: ${firstIssue?.path.join('.') ?? 'body'} ${firstIssue?.message ?? 'Invalid event'}`
        );
    }

    if (parsed.data.type === 'result') {
        writeImageResult(
            res,
            '{"type":"result","task":"generate","result":',
            parsed.data.result,
            '}}\n'
        );
        return;
    }

    res.write(`${JSON.stringify(parsed.data)}\n`);
};

export const createInternalImageHandler = ({
    internalImageTaskService,
    logRequest,
    maxBodyBytes,
    traceApiToken,
    serviceToken,
    serviceRateLimiter,
}: CreateInternalImageHandlerOptions) => {
    /**
     * @api.operationId: postInternalImageTask
     * @api.path: POST /api/internal/image
     */
    const handleInternalImageRequest = async (
        req: IncomingMessage,
        res: ServerResponse
    ): Promise<void> => {
        let streamStarted = false;
        try {
            if (req.method !== 'POST') {
                sendJson(res, 405, { error: 'Method not allowed' });
                logRequest(req, res, 'internal image method-not-allowed');
                return;
            }

            const auth = parseTrustedServiceAuth(
                req,
                {
                    traceApiToken,
                    serviceToken,
                },
                {
                    missing: 'internal image missing-trusted-auth',
                    invalid: 'internal image invalid-trusted-auth',
                }
            );
            if (!auth.ok) {
                imageLogger.warn('Internal image rejected: auth failed.', {
                    statusCode: auth.statusCode,
                });
                sendJson(res, auth.statusCode, auth.payload);
                logRequest(req, res, auth.logLabel);
                return;
            }

            const serviceRateLimitResult = serviceRateLimiter.check(
                `${auth.source}:${auth.rateLimitKey}`
            );
            if (!serviceRateLimitResult.allowed) {
                imageLogger.warn('Internal image rate limited.', {
                    source: auth.source,
                    retryAfter: serviceRateLimitResult.retryAfter,
                });
                sendJson(
                    res,
                    429,
                    {
                        error: 'Too many requests from this trusted service',
                        retryAfter: serviceRateLimitResult.retryAfter,
                    },
                    {
                        'Retry-After':
                            serviceRateLimitResult.retryAfter.toString(),
                    }
                );
                logRequest(
                    req,
                    res,
                    `internal image rate-limited source=${auth.source} retryAfter=${serviceRateLimitResult.retryAfter}`
                );
                return;
            }

            if (!internalImageTaskService) {
                imageLogger.warn('Internal image service unavailable.');
                sendJson(
                    res,
                    503,
                    buildProviderUnavailableError(
                        'Internal image generation provider unavailable'
                    )
                );
                logRequest(req, res, 'internal image service-unavailable');
                return;
            }

            const parsedRequest = await parseTrustedBodyWithSchema(req, res, {
                logRequest,
                routeLabel: 'internal image',
                maxBodyBytes,
                safeParse: (value) =>
                    PostInternalImageRequestSchema.safeParse(value),
            });
            if (parsedRequest === null) {
                return;
            }

            if (parsedRequest.task === 'generate') {
                const imageRequest: PostInternalImageGenerateRequest =
                    parsedRequest;
                imageLogger.info('Internal image task accepted.', {
                    source: auth.source,
                    stream: Boolean(imageRequest.stream),
                    textModel: imageRequest.textModel,
                    imageModel: imageRequest.imageModel,
                    size: imageRequest.size,
                    quality: imageRequest.quality,
                    outputFormat: imageRequest.outputFormat,
                    outputCompression: imageRequest.outputCompression,
                    allowPromptAdjustment: Boolean(
                        imageRequest.allowPromptAdjustment
                    ),
                    hasFollowUpResponseId: Boolean(
                        imageRequest.followUpResponseId
                    ),
                    recoverableTaskId: imageRequest.recoverableTaskId,
                });
                if (imageRequest.stream) {
                    streamStarted = true;
                    const abortController = new AbortController();
                    let streamEnded = false;
                    const abortImageStream = () => {
                        if (streamEnded || abortController.signal.aborted) {
                            return;
                        }
                        abortController.abort();
                        logImageMemoryCheckpoint('stream-cancelled', 0);
                    };
                    req.once('aborted', abortImageStream);
                    res.once('close', abortImageStream);
                    // NDJSON streaming is a transport contract for trusted image callers.
                    // Keep this path isolated from buffering middleware so partial events flush immediately.
                    res.statusCode = 200;
                    res.setHeader(
                        'Content-Type',
                        'application/x-ndjson; charset=utf-8'
                    );
                    res.setHeader('Cache-Control', 'no-store');
                    res.setHeader('X-Accel-Buffering', 'no');
                    if (typeof res.flushHeaders === 'function') {
                        res.flushHeaders();
                    }

                    imageLogger.info('Internal image stream started.', {
                        source: auth.source,
                        textModel: imageRequest.textModel,
                        imageModel: imageRequest.imageModel,
                        size: imageRequest.size,
                        quality: imageRequest.quality,
                    });

                    const response =
                        await internalImageTaskService.runImageTask(
                            imageRequest,
                            {
                                signal: abortController.signal,
                                onPartialImage: async (event) => {
                                    logImageMemoryCheckpoint(
                                        'stream-partial-write',
                                        event.base64.length
                                    );
                                    writeStreamEvent(res, event);
                                },
                            }
                        );
                    logImageMemoryCheckpoint(
                        'stream-result-write',
                        response.result.finalImageBase64.length
                    );
                    writeStreamEvent(res, {
                        type: 'result',
                        task: response.task,
                        result: response.result,
                    });
                    streamEnded = true;
                    res.end();
                    logImageMemoryCheckpoint('stream-closed', 0);
                    imageLogger.info('Internal image stream completed.', {
                        task: response.task,
                    });
                    logRequest(
                        req,
                        res,
                        `internal image stream-success task=${response.task}`
                    );
                    return;
                }

                const response =
                    await internalImageTaskService.runImageTask(imageRequest);
                sendImageResponse(res, response);
                imageLogger.info('Internal image task completed.', {
                    task: response.task,
                });
                logRequest(
                    req,
                    res,
                    `internal image success task=${response.task}`
                );
                return;
            }

            imageLogger.warn('Internal image unsupported task.', {
                task: parsedRequest.task,
            });
            sendJson(res, 400, {
                error: `Unsupported task: ${parsedRequest.task}`,
            });
            logRequest(
                req,
                res,
                `internal image unsupported-task task=${parsedRequest.task}`
            );
        } catch (error) {
            imageLogger.error('Internal image task execution failed.', {
                error: error instanceof Error ? error.message : String(error),
            });
            if (streamStarted) {
                try {
                    writeStreamEvent(res, {
                        type: 'error',
                        error: 'Failed to execute internal image task',
                    });
                } catch (streamWriteError) {
                    imageLogger.error(
                        'Internal image stream error write failed.',
                        {
                            error:
                                streamWriteError instanceof Error
                                    ? streamWriteError.message
                                    : String(streamWriteError),
                        }
                    );
                }
                res.end();
                logRequest(req, res, 'internal image stream-error');
                return;
            }
            sendJson(res, 502, {
                error: 'Failed to execute internal image task',
            });
            logRequest(
                req,
                res,
                `internal image error ${error instanceof Error ? error.message : String(error)}`
            );
        }
    };

    return {
        handleInternalImageRequest,
    };
};
