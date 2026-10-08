/**
 * @description: Handles trusted internal realtime voice WebSocket sessions for backend-owned voice runtime.
 * @footnote-scope: interface
 * @footnote-module: InternalVoiceRealtimeHandler
 * @footnote-risk: high - Auth or websocket handling mistakes here can leak realtime sessions or drop audio.
 * @footnote-ethics: high - Realtime audio sessions are privacy-sensitive and must remain within trusted boundaries.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import type {
    InternalVoiceRealtimeClientEvent,
    InternalVoiceRealtimeServerEvent,
    InternalVoiceSessionContext,
    SpeechSelectionMetadata,
    InternalVoiceRealtimeUsage,
} from '@footnote/contracts/voice';
import type { WorkflowRecord } from '@footnote/contracts/policy';
import { resolveOpenAIRealtimePricingModel } from '@footnote/contracts/pricing';
import {
    InternalVoiceRealtimeClientEventSchema,
    InternalVoiceRealtimeServerEventSchema,
} from '@footnote/contracts/voice';
import type {
    RealtimeVoiceRuntime,
    RealtimeVoiceSession,
} from '@footnote/agent-runtime';
import type { BackendLLMCostRecord } from '../services/llmCostRecorder.js';
import type { BotProfileConfig } from '../config/profile.js';
import { resolveSpeechSelection } from '../services/speechPresentation.js';
import {
    estimateBackendVoiceRealtimeCost,
    recordBackendLLMUsage,
} from '../services/llmCostRecorder.js';
import { logger } from '../utils/logger.js';
import { SimpleRateLimiter } from '../services/rateLimiter.js';
import { PROVIDER_UNAVAILABLE_DETAILS } from './chatResponses.js';
import { parseTrustedServiceAuth } from './trustedServiceRequest.js';

/**
 * @footnote-logger: internalVoiceRealtimeHandler
 * @logs: Websocket upgrades, session lifecycle, and schema validation outcomes for realtime voice.
 * @footnote-risk: high - Missing logs hide dropped sessions or auth failures.
 * @footnote-ethics: high - Realtime audio is privacy sensitive, so logs stay metadata-only.
 */
const realtimeLogger =
    typeof logger.child === 'function'
        ? logger.child({ module: 'internalVoiceRealtimeHandler' })
        : logger;

type CreateInternalVoiceRealtimeHandlerOptions = {
    realtimeVoiceRuntime: RealtimeVoiceRuntime | null;
    traceApiToken: string | null;
    serviceToken: string | null;
    serviceRateLimiter: SimpleRateLimiter;
    buildInstructions: (context: InternalVoiceSessionContext) => string;
    profile: BotProfileConfig;
    fallbackOptions: { model: string; voice: string };
    recordUsage?: (record: BackendLLMCostRecord) => void;
    recordExecution?: (
        responseId: string,
        workflow: WorkflowRecord
    ) => Promise<void> | void;
};

type RealtimeResponseStatus =
    'completed' | 'cancelled' | 'failed' | 'incomplete';

const STATUS_MESSAGES: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    405: 'Method Not Allowed',
    429: 'Too Many Requests',
    503: 'Service Unavailable',
};

const rejectUpgrade = (
    socket: Duplex,
    statusCode: number,
    payload: { error: string; details?: string }
): void => {
    const statusMessage = STATUS_MESSAGES[statusCode] ?? 'Bad Request';
    const body = JSON.stringify(payload);
    const headers = [
        `HTTP/1.1 ${statusCode} ${statusMessage}`,
        'Connection: close',
        'Content-Type: application/json; charset=utf-8',
        `Content-Length: ${Buffer.byteLength(body)}`,
        '',
        body,
    ].join('\r\n');
    socket.end(headers);
};

const sendServerEvent = (
    ws: WebSocket,
    event: InternalVoiceRealtimeServerEvent
): void => {
    const parsed = InternalVoiceRealtimeServerEventSchema.safeParse(event);
    if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        throw new Error(
            `Invalid internal voice realtime event: ${
                firstIssue?.path.join('.') ?? 'body'
            } ${firstIssue?.message ?? 'Invalid event'}`
        );
    }

    ws.send(JSON.stringify(parsed.data));
};

/**
 * @description: Creates the websocket upgrade handler for the internal realtime voice boundary.
 * @footnote-scope: interface
 * @footnote-module: InternalVoiceRealtimeHandlerFactory
 * @footnote-risk: high - Incorrect auth or websocket handling can drop sessions or leak trusted traffic.
 * @footnote-ethics: high - Realtime audio is privacy sensitive and must stay within trusted services.
 * @api.operationId: openInternalVoiceRealtime
 * @api.path: GET /api/internal/voice/realtime
 */
export const createInternalVoiceRealtimeHandler = ({
    realtimeVoiceRuntime,
    traceApiToken,
    serviceToken,
    serviceRateLimiter,
    buildInstructions,
    profile,
    fallbackOptions,
    recordUsage = recordBackendLLMUsage,
    recordExecution,
}: CreateInternalVoiceRealtimeHandlerOptions) => {
    const wss = new WebSocketServer({ noServer: true });

    wss.on('connection', (ws) => {
        if (!realtimeVoiceRuntime) {
            ws.close(1011, 'service_unavailable');
            return;
        }

        realtimeLogger.info('Internal voice realtime websocket connected.');

        let session: RealtimeVoiceSession | null = null;
        let sessionStarted = false;
        let closed = false;
        let socketClosed = false;
        let speechSelection: SpeechSelectionMetadata | undefined;
        const sessionCorrelationId = randomUUID();
        const activeResponses = new Map<
            string,
            { startedAt: string; runId: string }
        >();

        const recordResponseRun = (
            response: { startedAt: string; runId: string },
            status: RealtimeResponseStatus,
            usage: InternalVoiceRealtimeUsage | undefined,
            terminationReason?: string
        ): void => {
            if (!recordExecution || !speechSelection) return;
            const finishedAt = new Date().toISOString();
            const durationMs = Math.max(
                0,
                Date.parse(finishedAt) - Date.parse(response.startedAt)
            );
            const successful = status === 'completed';
            const model = usage?.model ?? speechSelection.model;
            const hasCompleteUsage =
                usage?.tokensPrompt !== undefined &&
                usage.tokensCompletion !== undefined;
            const pricingKnown =
                resolveOpenAIRealtimePricingModel(model).matchedModel !== null;
            const estimatedCost = hasCompleteUsage
                ? estimateBackendVoiceRealtimeCost(
                      model,
                      usage?.tokensPrompt ?? 0,
                      usage?.tokensCompletion ?? 0
                  )
                : {
                      inputCostUsd: 0,
                      outputCostUsd: 0,
                      totalCostUsd: 0,
                      costCompleteness: 'unknown' as const,
                      costIncompleteReasons: [
                          'provider_usage_unavailable' as const,
                      ],
                  };
            const costEvidence = {
                ...estimatedCost,
                ...(hasCompleteUsage && pricingKnown
                    ? { costCompleteness: 'complete' as const }
                    : hasCompleteUsage
                      ? {
                            costCompleteness: 'unknown' as const,
                            costIncompleteReasons: ['unpriced_model' as const],
                        }
                      : {}),
            };
            const attemptUsage = {
                ...(usage?.tokensPrompt !== undefined && {
                    promptTokens: usage.tokensPrompt,
                }),
                ...(usage?.tokensCompletion !== undefined && {
                    completionTokens: usage.tokensCompletion,
                }),
                ...(usage?.tokensPrompt !== undefined &&
                    usage.tokensCompletion !== undefined && {
                        totalTokens:
                            usage.tokensPrompt + usage.tokensCompletion,
                    }),
            };
            const appliedSettings = {
                effectiveVoice: speechSelection.voice,
                modality: 'realtime',
                modelSelectionSource: speechSelection.selectionSource.model,
                voiceSelectionSource: speechSelection.selectionSource.voice,
                deliverySelectionSource:
                    speechSelection.selectionSource.delivery,
                ...(speechSelection.fallbackReason && {
                    fallbackReason: speechSelection.fallbackReason,
                }),
            };
            const stepId = `${response.runId}:realtime`;
            const workflow: WorkflowRecord = {
                runId: response.runId,
                sessionCorrelationId,
                runStatus: successful ? 'completed' : 'failed',
                startedAt: response.startedAt,
                finishedAt,
                durationMs,
                workflowId: 'realtime_response',
                workflowName: 'Realtime response',
                status: successful ? 'completed' : 'degraded',
                terminationReason: successful
                    ? 'goal_satisfied'
                    : terminationReason === 'session_closed'
                      ? 'session_closed'
                      : status === 'cancelled'
                        ? 'provider_cancelled'
                        : status === 'incomplete'
                          ? 'provider_incomplete'
                          : 'provider_failed',
                stepCount: 1,
                maxSteps: 1,
                results: [
                    {
                        resultId: `${response.runId}:result`,
                        name: 'Realtime response',
                        status: successful ? 'produced' : 'unavailable',
                        producedByStepId: stepId,
                        producedByAttempt: 1,
                    },
                ],
                steps: [
                    {
                        stepId,
                        attempt: 1,
                        stepKind: 'generate',
                        startedAt: response.startedAt,
                        finishedAt,
                        durationMs,
                        model,
                        usage:
                            Object.keys(attemptUsage).length > 0
                                ? attemptUsage
                                : undefined,
                        cost: costEvidence,
                        resultRefs: [
                            {
                                resultId: `${response.runId}:result`,
                                name: 'Realtime response',
                            },
                        ],
                        attempts: [
                            {
                                attempt: 1,
                                status: successful ? 'succeeded' : 'failed',
                                startedAt: response.startedAt,
                                finishedAt,
                                durationMs,
                                profileId: speechSelection.profileId,
                                actualProvider: speechSelection.provider,
                                actualModel: model,
                                settings: { applied: appliedSettings },
                                ...(Object.keys(attemptUsage).length > 0 && {
                                    usage: attemptUsage,
                                }),
                                cost: costEvidence,
                                ...(terminationReason && {
                                    reasonCode: terminationReason,
                                    terminationReason,
                                }),
                            },
                        ],
                        outcome: {
                            status: successful ? 'executed' : 'failed',
                            summary: successful
                                ? 'Realtime response completed.'
                                : 'Realtime response did not complete.',
                            ...(terminationReason && {
                                signals: { terminationReason },
                            }),
                        },
                    },
                ],
            };
            try {
                void Promise.resolve(
                    recordExecution(response.runId, workflow)
                ).catch((error: unknown) => {
                    realtimeLogger.warn(
                        'Internal voice realtime execution recording failed.',
                        {
                            responseId: response.runId,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        }
                    );
                });
            } catch (error) {
                realtimeLogger.warn(
                    'Internal voice realtime execution recording failed.',
                    {
                        responseId: response.runId,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    }
                );
            }
        };

        const isSocketOpen = () =>
            !socketClosed && ws.readyState === WebSocket.OPEN;

        const closeSocket = (code = 1000, reason?: string) => {
            if (closed) {
                return;
            }
            closed = true;
            ws.close(code, reason);
        };

        const forwardRuntimeEvent = (
            event: InternalVoiceRealtimeServerEvent
        ) => {
            if (event.type === 'response.started') {
                activeResponses.set(event.responseId, {
                    startedAt: new Date().toISOString(),
                    runId: randomUUID(),
                });
            }
            if (event.type === 'response.done') {
                const usage = event.usage;
                if (
                    usage?.tokensPrompt !== undefined &&
                    usage.tokensCompletion !== undefined
                ) {
                    const model = usage.model ?? 'unknown';
                    const promptTokens = usage.tokensPrompt;
                    const completionTokens = usage.tokensCompletion;
                    const estimatedCost = estimateBackendVoiceRealtimeCost(
                        model,
                        promptTokens,
                        completionTokens
                    );

                    try {
                        recordUsage({
                            feature: 'voice_realtime',
                            model,
                            promptTokens,
                            completionTokens,
                            totalTokens: promptTokens + completionTokens,
                            ...estimatedCost,
                            timestamp: Date.now(),
                        });
                    } catch (error) {
                        realtimeLogger.warn(
                            `Internal voice realtime usage recording failed: ${
                                error instanceof Error
                                    ? error.message
                                    : String(error)
                            }`
                        );
                    }
                }
                const providerResponseId = event.responseId;
                const activeResponse = providerResponseId
                    ? activeResponses.get(providerResponseId)
                    : undefined;
                if (providerResponseId && activeResponse) {
                    activeResponses.delete(providerResponseId);
                    recordResponseRun(
                        activeResponse,
                        event.status ?? 'completed',
                        usage,
                        event.terminationReason
                    );
                }
            }
            if (event.type === 'session.closed' && activeResponses.size > 0) {
                for (const response of activeResponses.values()) {
                    recordResponseRun(
                        response,
                        'failed',
                        undefined,
                        'session_closed'
                    );
                }
                activeResponses.clear();
            }

            try {
                if (event.type !== 'response.started') {
                    sendServerEvent(
                        ws,
                        event.type === 'session.ready' && speechSelection
                            ? { ...event, speechSelection }
                            : event
                    );
                }
            } catch (error) {
                realtimeLogger.warn(
                    `Failed to send internal voice realtime event: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }

            if (event.type === 'session.closed') {
                realtimeLogger.info('Internal voice realtime session closed.', {
                    reason: event.reason ?? 'session_closed',
                    code: event.code,
                });
                closeSocket(1000, event.reason ?? 'session_closed');
            }
        };

        ws.on('message', async (data) => {
            let payload: InternalVoiceRealtimeClientEvent;
            try {
                payload = JSON.parse(
                    data.toString()
                ) as InternalVoiceRealtimeClientEvent;
            } catch (_error) {
                realtimeLogger.warn(
                    'Internal voice realtime payload rejected: invalid JSON.'
                );
                sendServerEvent(ws, {
                    type: 'error',
                    message: 'Realtime payload was not valid JSON.',
                });
                return;
            }

            const parsed =
                InternalVoiceRealtimeClientEventSchema.safeParse(payload);
            if (!parsed.success) {
                const firstIssue = parsed.error.issues[0];
                realtimeLogger.warn(
                    'Internal voice realtime payload rejected: invalid shape.',
                    {
                        issuePath: firstIssue?.path.join('.') ?? 'body',
                        issueMessage: firstIssue?.message ?? 'Invalid event',
                    }
                );
                sendServerEvent(ws, {
                    type: 'error',
                    message: `Invalid realtime event: ${
                        firstIssue?.path.join('.') ?? 'body'
                    } ${firstIssue?.message ?? 'Invalid event'}`,
                });
                return;
            }

            const event = parsed.data;

            if (event.type === 'session.start') {
                realtimeLogger.debug(
                    'Realtime session start payload received.',
                    {
                        participantCount: event.context.participants.length,
                        botCount: event.context.participants.filter(
                            (participant) => participant.isBot
                        ).length,
                        hasTranscripts: Boolean(
                            event.context.transcripts?.length
                        ),
                        options: event.options,
                    }
                );
                if (sessionStarted) {
                    sendServerEvent(ws, {
                        type: 'error',
                        message: 'Realtime session already started.',
                    });
                    return;
                }

                sessionStarted = true;
                speechSelection = resolveSpeechSelection({
                    profile,
                    provider: realtimeVoiceRuntime.provider,
                    modality: 'realtime',
                    request: {
                        model: event.options?.model,
                        voice: event.options?.voice,
                        delivery: event.options?.delivery,
                    },
                    fallback: fallbackOptions,
                });
                const unsupportedModel = !realtimeVoiceRuntime.supportsModel(
                    speechSelection.model
                );
                const unsupportedVoice = !realtimeVoiceRuntime.supportsVoice(
                    speechSelection.voice
                );
                if (unsupportedModel || unsupportedVoice) {
                    if (
                        (unsupportedModel &&
                            speechSelection.selectionSource.model ===
                                'request_or_session') ||
                        (unsupportedVoice &&
                            speechSelection.selectionSource.voice ===
                                'request_or_session')
                    ) {
                        sessionStarted = false;
                        speechSelection = undefined;
                        sendServerEvent(ws, {
                            type: 'error',
                            message:
                                'Requested Realtime model or voice is not supported by the configured provider.',
                            code: 'unsupported_speech_selection',
                        });
                        return;
                    }
                    const ignoreOperatorModel =
                        unsupportedModel &&
                        speechSelection.selectionSource.model ===
                            'operator_profile';
                    const ignoreOperatorVoice =
                        unsupportedVoice &&
                        speechSelection.selectionSource.voice ===
                            'operator_profile';
                    const unsupportedSettings = [
                        ...(ignoreOperatorModel ? ['model'] : []),
                        ...(ignoreOperatorVoice ? ['voice'] : []),
                    ];
                    speechSelection = resolveSpeechSelection({
                        profile,
                        provider: realtimeVoiceRuntime.provider,
                        modality: 'realtime',
                        request: {
                            model: event.options?.model,
                            voice: event.options?.voice,
                            delivery: event.options?.delivery,
                        },
                        ignoreOperatorModel,
                        ignoreOperatorVoice,
                        fallbackReason: `Configured profile ${unsupportedSettings.join(' and ')} is unsupported; using deployment fallback for that setting.`,
                        fallback: fallbackOptions,
                    });
                }
                realtimeLogger.info(
                    'Internal voice realtime session starting.',
                    {
                        model: speechSelection.model,
                        voice: speechSelection.voice,
                        profileId: profile.id,
                        speechSelection,
                    }
                );
                let createdSession: RealtimeVoiceSession | null = null;
                try {
                    createdSession = await realtimeVoiceRuntime.createSession({
                        instructions: [
                            buildInstructions(event.context),
                            ...(speechSelection.delivery
                                ? [
                                      `Speech delivery guidance: ${speechSelection.delivery}`,
                                  ]
                                : []),
                        ].join('\n\n'),
                        options: {
                            ...event.options,
                            model: speechSelection.model,
                            voice: speechSelection.voice,
                        },
                    });
                    if (!isSocketOpen()) {
                        createdSession.close('client_close');
                        return;
                    }
                    session = createdSession;
                    session.onEvent(forwardRuntimeEvent);
                    return;
                } catch (error) {
                    sessionStarted = false;
                    createdSession?.close('client_close');
                    realtimeLogger.error(
                        'Internal voice realtime session start failed.',
                        {
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        }
                    );
                    if (isSocketOpen()) {
                        sendServerEvent(ws, {
                            type: 'error',
                            message:
                                error instanceof Error
                                    ? error.message
                                    : 'Failed to start realtime session.',
                        });
                    }
                    return;
                }
            }

            if (!session) {
                sendServerEvent(ws, {
                    type: 'error',
                    message: 'Realtime session not initialized.',
                });
                return;
            }

            if (event.type === 'session.close') {
                realtimeLogger.debug(
                    'Internal voice realtime session close requested by client.'
                );
                realtimeLogger.info(
                    'Internal voice realtime session close requested by client.'
                );
                session.close('client_close');
                closeSocket(1000, 'client_close');
                return;
            }

            if (event.type === 'input_audio.append') {
                // Skip per-chunk logging to keep realtime logs readable.
            } else if (event.type === 'input_audio.commit') {
                realtimeLogger.debug('Internal voice realtime audio commit.');
            } else if (event.type === 'input_audio.clear') {
                realtimeLogger.debug('Internal voice realtime audio clear.');
            } else if (event.type === 'input_text.create') {
                realtimeLogger.debug('Internal voice realtime input text.', {
                    textLength: event.text.length,
                    speakerLabelLength: event.speakerLabel?.length,
                    speakerId: event.speakerId,
                });
            } else if (event.type === 'response.create') {
                realtimeLogger.debug(
                    'Internal voice realtime response create.'
                );
            } else {
                realtimeLogger.debug('Internal voice realtime client event.');
            }

            try {
                await session.send(event);
            } catch (error) {
                realtimeLogger.error(
                    'Internal voice realtime event forwarding failed.',
                    {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        eventType: event.type,
                    }
                );
                sendServerEvent(ws, {
                    type: 'error',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Failed to forward realtime event.',
                });
            }
        });

        ws.on('close', () => {
            socketClosed = true;
            closed = true;
            session?.close('client_close');
        });

        ws.on('error', (error) => {
            socketClosed = true;
            realtimeLogger.error('Internal voice realtime websocket error.', {
                error: error instanceof Error ? error.message : String(error),
            });
            session?.close('socket_error');
        });
    });

    const handleUpgrade = (
        req: IncomingMessage,
        // Node exposes HTTP upgrade sockets as Duplex streams. Treat that as
        // the boundary type here so server.ts can forward the upgrade socket
        // directly without unsafe casts.
        socket: Duplex,
        head: Buffer
    ): void => {
        // Upgrade flow is intentionally explicit; generic HTTP middleware should not intercept this path.
        if (req.method !== 'GET') {
            rejectUpgrade(socket, 405, { error: 'Method not allowed' });
            return;
        }

        const auth = parseTrustedServiceAuth(
            req,
            {
                traceApiToken,
                serviceToken,
            },
            {
                missing: 'internal voice realtime missing-trusted-auth',
                invalid: 'internal voice realtime invalid-trusted-auth',
            }
        );
        if (!auth.ok) {
            realtimeLogger.warn(
                'Internal voice realtime rejected: auth failed.',
                {
                    statusCode: auth.statusCode,
                }
            );
            rejectUpgrade(socket, auth.statusCode, auth.payload);
            return;
        }

        const serviceRateLimitResult = serviceRateLimiter.check(
            `${auth.source}:${auth.rateLimitKey}`
        );
        if (!serviceRateLimitResult.allowed) {
            realtimeLogger.warn(
                'Internal voice realtime rejected: rate limited.',
                {
                    source: auth.source,
                    retryAfter: serviceRateLimitResult.retryAfter,
                }
            );
            rejectUpgrade(socket, 429, {
                error: 'Too many requests from this trusted service',
                details: `retryAfter=${serviceRateLimitResult.retryAfter}`,
            });
            return;
        }

        if (!realtimeVoiceRuntime) {
            realtimeLogger.warn(
                'Internal voice realtime rejected: service unavailable.'
            );
            rejectUpgrade(socket, 503, {
                error: 'Internal voice realtime provider unavailable',
                details: PROVIDER_UNAVAILABLE_DETAILS,
            });
            return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    };

    return {
        handleUpgrade,
    };
};
