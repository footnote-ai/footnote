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
    SpeechSelectionMetadata,
} from '@footnote/contracts/voice';
import {
    InternalVoiceRealtimeClientEventSchema,
    InternalVoiceRealtimeServerEventSchema,
} from '@footnote/contracts/voice';
import type { BotProfileConfig } from '../config/profile.js';
import {
    resolveVoicePersona,
    type ResolvedVoicePersona,
} from '../services/chatProfileOverlay.js';
import type {
    RealtimeFreshnessHandle,
    RealtimeWorkflowRunner,
} from '../services/realtimeConversationState.js';
import type { RealtimeWorkflowLimitReason } from '../services/realtimeWorkflowScope.js';
import { RealtimeConversationState } from '../services/realtimeConversationState.js';
import type { OpenRouterVoiceService } from '../services/openRouterVoice.js';
import type {
    OpenAiLiveVoiceEvent,
    OpenAiLiveVoiceSession,
    OpenAiLiveVoiceSessionFactory,
} from '../services/openAiLiveVoice.js';
import { resolveSpeechSelection } from '../services/speechPresentation.js';
import { fitsVoiceAnswerDelivery } from '../services/voiceAnswerBudget.js';
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

const CALL_LIMIT_MS = 60_000;
const EXTENDED_CALL_LIMIT_MS = 5 * 60_000;
const SESSION_SETUP_TIMEOUT_MS = 15_000;
const LIVE_TRANSCRIPT_SETTLE_MS = 500;
const LIVE_CLOSE_GRACE_MS = 2_500;
const STANDARD_TTS_MODEL = 'openai/gpt-4o-mini-tts-2025-12-15';
const STANDARD_TTS_VOICE = 'alloy';
const MAX_STANDARD_UTTERANCE_BYTES = 2_880_000;
let activeVoiceCall: symbol | undefined;

type CreateInternalVoiceRealtimeHandlerOptions = {
    defaultMode?: 'standard' | 'live';
    maxAnswerTokens: number;
    openAiLiveVoiceSessionFactory?: OpenAiLiveVoiceSessionFactory | null;
    openRouterVoiceService?: OpenRouterVoiceService | null;
    workflowRunner?: RealtimeWorkflowRunner | null;
    developerUserId?: string | null;
    traceApiToken: string | null;
    serviceToken: string | null;
    serviceRateLimiter: SimpleRateLimiter;
    profile: BotProfileConfig;
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
};

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
    defaultMode = 'standard',
    maxAnswerTokens,
    openAiLiveVoiceSessionFactory = null,
    openRouterVoiceService = null,
    workflowRunner = null,
    developerUserId = null,
    traceApiToken,
    serviceToken,
    serviceRateLimiter,
    profile,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
}: CreateInternalVoiceRealtimeHandlerOptions) => {
    const wss = new WebSocketServer({ noServer: true });

    wss.on('connection', (ws) => {
        realtimeLogger.info('Internal voice realtime websocket connected.');

        let liveSession: OpenAiLiveVoiceSession | null = null;
        let liveUnsubscribe: (() => void) | undefined;
        let mode: 'standard' | 'live' | undefined;
        let initiatorId: string | undefined;
        let conversationState: RealtimeConversationState | undefined;
        let conversationUnsubscribe: (() => void) | undefined;
        let transcriptionController: AbortController | undefined;
        let synthesisController: AbortController | undefined;
        let currentDeliveryId: string | undefined;
        let currentDeliveryText: string | undefined;
        let audioChunks: Buffer[] = [];
        let audioBytes = 0;
        let sessionStarted = false;
        let sessionReady = false;
        let closed = false;
        let socketClosed = false;
        let callReservation: symbol | undefined;
        let callLimitMs = CALL_LIMIT_MS;
        let setupTimeout: ReturnType<typeof setTimeout> | undefined;
        let callTimeout: ReturnType<typeof setTimeout> | undefined;
        let providerFinalizationTimeout:
            ReturnType<typeof setTimeout> | undefined;
        let providerSetupController: AbortController | undefined;
        let speechSelection: SpeechSelectionMetadata | undefined;
        let persona: ResolvedVoicePersona | undefined;
        const sessionCorrelationId = randomUUID();
        const liveTranscriptEvents: Array<{
            eventId: string;
            text: string;
            startMs: number;
            endMs: number;
        }> = [];
        const liveDelegations: Array<{ id: string; offsetMs: number }> = [];
        const seenLiveTranscriptEvents = new Set<string>();
        const seenLiveDelegations = new Set<string>();
        let liveAudioBytes = 0;
        let liveCurrentUtteranceBytes = 0;
        let liveInputOpen = false;
        let liveTranscriptBytes = 0;
        let liveTranscriptOverflow = false;
        let liveBoundaryPending = false;
        let liveBoundaryExpiresAt = 0;
        let liveTranscriptCursorMs = 0;
        let liveDelegationTimer: ReturnType<typeof setTimeout> | undefined;
        let currentLiveDeliveryDelegationId: string | undefined;

        const reportAnswerTooLong = (): void => {
            if (!closed && !socketClosed && ws.readyState === WebSocket.OPEN)
                sendServerEvent(ws, {
                    type: 'error',
                    message:
                        'The answer is longer than the Voice delivery limit.',
                    code: 'answer_too_long',
                });
        };
        const reportWorkflowLimitReached = (
            limitReason: RealtimeWorkflowLimitReason
        ): void => {
            const messages: Record<RealtimeWorkflowLimitReason, string> = {
                budget_exhausted_steps:
                    'The Voice answer could not be safely prepared within the Workflow step limit.',
                budget_exhausted_tokens:
                    'The Voice answer could not be safely prepared within the Workflow token limit.',
                budget_exhausted_time:
                    'The Voice answer could not be safely prepared within the Workflow time limit.',
                max_deliberation_calls_reached:
                    'The Voice answer could not be safely prepared within the Workflow review limit.',
            };
            if (!closed && !socketClosed && ws.readyState === WebSocket.OPEN)
                sendServerEvent(ws, {
                    type: 'error',
                    message: messages[limitReason],
                    code: 'workflow_limit_reached',
                });
        };
        const boundedWorkflowRunner: RealtimeWorkflowRunner | null =
            workflowRunner === null
                ? null
                : {
                      runRealtimeConversation: async (snapshot, context) => {
                          if (!mode || !persona)
                              throw new Error('Voice mode is unavailable.');
                          const result =
                              await workflowRunner.runRealtimeConversation(
                                  snapshot,
                                  {
                                      ...context,
                                      voiceMode: mode,
                                      maxAnswerTokens,
                                      persona,
                                  }
                              );
                          const answer = result.finalResponse;
                          if (
                              answer?.disposition === 'workflow_limit_reached'
                          ) {
                              if (!context.signal.aborted)
                                  reportWorkflowLimitReached(
                                      answer.limitReason
                                  );
                              return result;
                          }
                          const tooLong =
                              answer?.disposition === 'answer_too_long' ||
                              (answer?.disposition === 'approved' &&
                                  !fitsVoiceAnswerDelivery(
                                      answer.text,
                                      mode,
                                      maxAnswerTokens
                                  ));
                          if (!tooLong) return result;
                          if (!context.signal.aborted) reportAnswerTooLong();
                          return {
                              ...result,
                              finalResponse: {
                                  disposition: 'answer_too_long',
                              },
                          };
                      },
                  };

        const recordAudioUsage = (
            feature: 'voice_transcription',
            model: string,
            usage: {
                seconds?: number;
                inputTokens?: number;
                outputTokens?: number;
                totalTokens?: number;
                costUsd?: number;
            }
        ): void => {
            realtimeLogger.info('OpenRouter voice usage reported.', {
                feature,
                model,
                ...usage,
            });
        };

        const synthesizeApprovedDelivery = async (
            handle: RealtimeFreshnessHandle
        ): Promise<void> => {
            const state = conversationState;
            if (
                closed ||
                mode !== 'standard' ||
                !state ||
                !openRouterVoiceService ||
                !speechSelection ||
                !state.isCurrent(handle)
            )
                return;
            const ready = state.deliveryStatus();
            if (ready?.status !== 'ready') return;
            const request = state.requestDelivery(handle);
            if (!request) return;
            const delivery = state.startDelivery(request.deliveryId);
            if (!delivery) return;

            if (
                !fitsVoiceAnswerDelivery(
                    delivery.text,
                    'standard',
                    maxAnswerTokens
                )
            ) {
                state.reportPlayback(delivery.deliveryId, 'failed');
                reportAnswerTooLong();
                return;
            }

            synthesisController?.abort('superseded');
            const controller = new AbortController();
            synthesisController = controller;
            currentDeliveryId = delivery.deliveryId;
            currentDeliveryText = delivery.text;
            try {
                const result = await openRouterVoiceService.synthesize(
                    delivery.text,
                    {
                        model: speechSelection.model,
                        voice: speechSelection.voice,
                        instructions: speechSelection.delivery,
                    },
                    controller.signal
                );
                if (
                    closed ||
                    controller.signal.aborted ||
                    currentDeliveryId !== delivery.deliveryId ||
                    !state.isCurrent(delivery.handle) ||
                    state.deliveryStatus()?.status !== 'handed_off'
                )
                    return;
                sendServerEvent(ws, {
                    type: 'output_audio.delta',
                    audioBase64: result.audio.toString('base64'),
                    deliveryId: delivery.deliveryId,
                });
            } catch (error) {
                if (!controller.signal.aborted && !closed) {
                    state.reportPlayback(delivery.deliveryId, 'failed');
                    sendServerEvent(ws, {
                        type: 'error',
                        message:
                            'Approved answer speech could not be generated.',
                        code: 'speech_synthesis_failed',
                    });
                    realtimeLogger.warn('OpenRouter voice synthesis failed.', {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                }
            } finally {
                if (synthesisController === controller)
                    synthesisController = undefined;
            }
        };

        const transcribeStandardUtterance = (audio: Buffer): void => {
            if (
                closed ||
                mode !== 'standard' ||
                !conversationState ||
                !boundedWorkflowRunner ||
                !openRouterVoiceService ||
                !initiatorId
            )
                return;
            const controller = new AbortController();
            const attributedSpeakerId = initiatorId;
            if (!attributedSpeakerId) return;
            transcriptionController?.abort('superseded');
            transcriptionController = controller;
            void openRouterVoiceService
                .transcribe(audio, controller.signal)
                .then(({ text, usage }) => {
                    if (
                        closed ||
                        controller.signal.aborted ||
                        !conversationState
                    )
                        return;
                    if (usage)
                        recordAudioUsage(
                            'voice_transcription',
                            'openai/whisper-1',
                            usage
                        );
                    const turn = conversationState.appendFinalizedTurn({
                        role: 'user',
                        speakerId: attributedSpeakerId,
                        content: text,
                        intent: 'question',
                    });
                    if (!turn.accepted) {
                        sendServerEvent(ws, {
                            type: 'error',
                            message: 'The voice turn could not be accepted.',
                            code: turn.reason,
                        });
                        return;
                    }
                    const result = conversationState.startExecution(
                        boundedWorkflowRunner
                    );
                    if (!result.accepted) {
                        sendServerEvent(ws, {
                            type: 'error',
                            message: 'The voice turn could not start Workflow.',
                            code: result.reason,
                        });
                    }
                })
                .catch((error: unknown) => {
                    if (!controller.signal.aborted && !closed) {
                        sendServerEvent(ws, {
                            type: 'error',
                            message:
                                'The voice utterance could not be transcribed.',
                            code: 'transcription_failed',
                        });
                        realtimeLogger.warn(
                            'OpenRouter voice transcription failed.',
                            {
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : String(error),
                            }
                        );
                    }
                })
                .finally(() => {
                    if (transcriptionController === controller)
                        transcriptionController = undefined;
                });
        };

        const isSocketOpen = () =>
            !socketClosed && ws.readyState === WebSocket.OPEN;

        const releaseCallReservation = (): void => {
            clearTimer(setupTimeout);
            clearTimer(callTimeout);
            clearTimer(providerFinalizationTimeout);
            setupTimeout = undefined;
            callTimeout = undefined;
            providerFinalizationTimeout = undefined;
            liveUnsubscribe?.();
            liveUnsubscribe = undefined;
            if (callReservation && activeVoiceCall === callReservation)
                activeVoiceCall = undefined;
            callReservation = undefined;
        };

        const finishCall = (
            reason: string,
            closeProvider: boolean,
            reportClosed: boolean,
            providerCode?: string
        ): void => {
            if (closed) return;
            closed = true;
            const waitForLiveFinalization =
                closeProvider && liveSession !== null;
            clearTimer(setupTimeout);
            clearTimer(callTimeout);
            setupTimeout = undefined;
            callTimeout = undefined;
            clearTimer(liveDelegationTimer);
            liveDelegationTimer = undefined;
            providerSetupController?.abort(reason);
            providerSetupController = undefined;
            conversationUnsubscribe?.();
            conversationUnsubscribe = undefined;
            if (!waitForLiveFinalization) {
                liveUnsubscribe?.();
                liveUnsubscribe = undefined;
            }
            transcriptionController?.abort(reason);
            transcriptionController = undefined;
            synthesisController?.abort(reason);
            synthesisController = undefined;
            currentDeliveryId = undefined;
            currentDeliveryText = undefined;
            currentLiveDeliveryDelegationId = undefined;
            audioChunks = [];
            audioBytes = 0;
            conversationState?.close();
            conversationState = undefined;
            persona = undefined;
            if (waitForLiveFinalization) {
                providerFinalizationTimeout = setTimer(() => {
                    realtimeLogger.warn(
                        'OpenAI Live session finalization was not confirmed.'
                    );
                    releaseCallReservation();
                }, LIVE_CLOSE_GRACE_MS);
                providerFinalizationTimeout.unref?.();
            }
            if (closeProvider) {
                try {
                    liveSession?.close();
                } catch (error) {
                    realtimeLogger.warn(
                        'Internal voice provider close failed.',
                        {
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        }
                    );
                }
            }
            if (!waitForLiveFinalization) releaseCallReservation();
            if (reportClosed && isSocketOpen()) {
                try {
                    sendServerEvent(ws, {
                        type: 'session.closed',
                        reason,
                        ...(providerCode ? { code: providerCode } : {}),
                    });
                } catch (error) {
                    realtimeLogger.warn(
                        'Failed to report internal voice session closure.',
                        {
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        }
                    );
                }
            }
            if (isSocketOpen()) ws.close(1000, reason);
        };

        const appendLiveCommentary = (
            text: string,
            delegationId: string | null
        ): boolean => {
            try {
                if (!liveSession) return false;
                liveSession.appendCommentary(text, delegationId);
                return true;
            } catch {
                sendServerEvent(ws, {
                    type: 'error',
                    message: 'The Live voice response could not be sent.',
                    code: 'live_commentary_failed',
                });
                finishCall('live_commentary_failed', true, true);
                return false;
            }
        };

        const deliverApprovedLiveAnswer = (
            handle: RealtimeFreshnessHandle
        ): void => {
            const state = conversationState;
            if (
                closed ||
                mode !== 'live' ||
                !state ||
                !liveSession ||
                !state.isCurrent(handle)
            )
                return;
            const ready = state.deliveryStatus();
            if (ready?.status !== 'ready') return;
            const request = state.requestDelivery(handle);
            if (!request) return;
            const delivery = state.startDelivery(request.deliveryId);
            if (!delivery) return;
            if (
                !fitsVoiceAnswerDelivery(delivery.text, 'live', maxAnswerTokens)
            ) {
                state.reportPlayback(delivery.deliveryId, 'failed');
                reportAnswerTooLong();
                currentLiveDeliveryDelegationId = undefined;
                return;
            }
            const delegationId = currentLiveDeliveryDelegationId;
            if (!delegationId) {
                state.reportPlayback(delivery.deliveryId, 'failed');
                currentLiveDeliveryDelegationId = undefined;
                return;
            }
            try {
                liveSession.appendCommentary(delivery.text, delegationId);
                currentLiveDeliveryDelegationId = undefined;
            } catch {
                state.reportPlayback(delivery.deliveryId, 'failed');
                currentLiveDeliveryDelegationId = undefined;
                sendServerEvent(ws, {
                    type: 'error',
                    message:
                        'The approved result could not be sent to Live voice.',
                    code: 'live_commentary_failed',
                });
                finishCall('live_commentary_failed', true, true);
            }
        };

        const discardLiveTranscriptThrough = (offsetMs: number): void => {
            liveTranscriptCursorMs = Math.max(liveTranscriptCursorMs, offsetMs);
            const firstUnconsumedIndex = liveTranscriptEvents.findIndex(
                (item) => item.endMs > liveTranscriptCursorMs
            );
            liveTranscriptEvents.splice(
                0,
                firstUnconsumedIndex < 0
                    ? liveTranscriptEvents.length
                    : firstUnconsumedIndex
            );
            liveTranscriptBytes = liveTranscriptEvents.reduce(
                (total, item) => total + Buffer.byteLength(item.text, 'utf8'),
                0
            );
        };

        const settleLiveDelegations = (): void => {
            clearTimer(liveDelegationTimer);
            liveDelegationTimer = undefined;
            if (closed || !liveBoundaryPending || !liveSession) return;
            const delegations = liveDelegations.splice(0);
            if (Date.now() >= liveBoundaryExpiresAt) {
                liveBoundaryPending = false;
                discardLiveTranscriptThrough(
                    Math.max(
                        0,
                        ...liveTranscriptEvents.map((item) => item.endMs)
                    )
                );
                liveTranscriptOverflow = false;
                return;
            }
            if (delegations.length === 0 && !liveTranscriptOverflow) {
                scheduleLiveDelegationSettlement(
                    Math.max(1, liveBoundaryExpiresAt - Date.now())
                );
                return;
            }
            liveBoundaryPending = false;
            if (delegations.length !== 1 || liveTranscriptOverflow) {
                appendLiveCommentary(
                    'I could not confidently match your request to the words I heard. Please repeat it.',
                    delegations.length === 1 ? delegations[0]!.id : null
                );
                discardLiveTranscriptThrough(
                    Math.max(
                        0,
                        ...liveTranscriptEvents.map((item) => item.endMs),
                        ...delegations.map((item) => item.offsetMs)
                    )
                );
                liveTranscriptOverflow = false;
                return;
            }
            const delegation = delegations[0]!;
            const transcript = liveTranscriptEvents
                .filter(
                    (item) =>
                        item.startMs >= liveTranscriptCursorMs &&
                        item.endMs <= delegation.offsetMs
                )
                .sort(
                    (left, right) =>
                        left.startMs - right.startMs || left.endMs - right.endMs
                );
            const latestEndMs = Math.max(
                0,
                ...transcript.map((item) => item.endMs)
            );
            const text = transcript.map((item) => item.text).join('');
            if (
                !text.trim() ||
                latestEndMs < liveTranscriptCursorMs ||
                delegation.offsetMs - latestEndMs > 1_200
            ) {
                appendLiveCommentary(
                    'I could not confidently match your request to the words I heard. Please repeat it.',
                    delegation.id
                );
                discardLiveTranscriptThrough(delegation.offsetMs);
                return;
            }

            discardLiveTranscriptThrough(latestEndMs);
            const state = conversationState;
            if (!state || !initiatorId) {
                appendLiveCommentary(
                    'I could not safely use that request. Please repeat it.',
                    delegation.id
                );
                currentLiveDeliveryDelegationId = undefined;
                return;
            }
            currentLiveDeliveryDelegationId = delegation.id;
            const turn = state.appendFinalizedTurn({
                role: 'user',
                speakerId: initiatorId,
                content: text,
                intent: 'question',
            });
            if (!turn?.accepted) {
                appendLiveCommentary(
                    'I could not safely use that request. Please repeat it.',
                    delegation.id
                );
                currentLiveDeliveryDelegationId = undefined;
                return;
            }
            const execution = state.startExecution(boundedWorkflowRunner!);
            if (!execution?.accepted) {
                appendLiveCommentary(
                    'I could not start that task yet. Please wait briefly and try again.',
                    delegation.id
                );
                currentLiveDeliveryDelegationId = undefined;
            }
        };

        const scheduleLiveDelegationSettlement = (
            delayMs = LIVE_TRANSCRIPT_SETTLE_MS
        ): void => {
            clearTimer(liveDelegationTimer);
            liveDelegationTimer = setTimer(settleLiveDelegations, delayMs);
            liveDelegationTimer.unref?.();
        };

        const logLiveProviderUsage = (event: OpenAiLiveVoiceEvent): void => {
            if (
                event.type !== 'session.usage.updated' &&
                event.type !== 'session.closed'
            ) {
                return;
            }
            const usage = event.usage;
            if (
                typeof usage === 'object' &&
                usage !== null &&
                'seconds' in usage &&
                typeof usage.seconds === 'number' &&
                Number.isFinite(usage.seconds)
            ) {
                realtimeLogger.info('OpenAI Live voice duration reported.', {
                    seconds: usage.seconds,
                });
            }
        };

        const forwardLiveAudioDelta = (event: OpenAiLiveVoiceEvent): void => {
            if (
                event.type !== 'session.output_audio.delta' ||
                typeof event.delta !== 'string' ||
                event.delta.length === 0 ||
                !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
                    event.delta
                )
            )
                return;
            sendServerEvent(ws, {
                type: 'output_audio.delta',
                audioBase64: event.delta,
            });
        };

        const recordLiveTranscriptDelta = (
            event: OpenAiLiveVoiceEvent
        ): void => {
            if (
                event.type !== 'session.input_transcript.delta' ||
                typeof event.event_id !== 'string' ||
                typeof event.delta !== 'string' ||
                !Number.isSafeInteger(event.start_ms) ||
                !Number.isSafeInteger(event.end_ms) ||
                (event.start_ms as number) > (event.end_ms as number)
            )
                return;
            if (seenLiveTranscriptEvents.has(event.event_id)) return;
            seenLiveTranscriptEvents.add(event.event_id);
            if (seenLiveTranscriptEvents.size > 512)
                seenLiveTranscriptEvents.clear();
            const text = event.delta;
            const bytes = Buffer.byteLength(text, 'utf8');
            if (
                liveTranscriptEvents.length >= 256 ||
                liveTranscriptBytes + bytes > 16 * 1024
            ) {
                liveTranscriptOverflow = true;
            } else {
                liveTranscriptEvents.push({
                    eventId: event.event_id,
                    text,
                    startMs: event.start_ms as number,
                    endMs: event.end_ms as number,
                });
                liveTranscriptBytes += bytes;
            }
            if (liveBoundaryPending) scheduleLiveDelegationSettlement();
        };

        const recordLiveDelegation = (event: OpenAiLiveVoiceEvent): void => {
            if (
                event.type !== 'session.delegation.created' ||
                typeof event.offset_ms !== 'number' ||
                !Number.isSafeInteger(event.offset_ms) ||
                typeof event.delegation !== 'object' ||
                event.delegation === null
            )
                return;
            const delegation = event.delegation as Record<string, unknown>;
            if (
                delegation.target !== 'client' ||
                typeof delegation.id !== 'string' ||
                delegation.type !== 'delegation' ||
                event.offset_ms <= liveTranscriptCursorMs ||
                seenLiveDelegations.has(delegation.id)
            )
                return;
            seenLiveDelegations.add(delegation.id);
            if (seenLiveDelegations.size > 512) seenLiveDelegations.clear();
            if (!liveBoundaryPending) {
                appendLiveCommentary(
                    'I could not confidently match your request to the words I heard. Please repeat it.',
                    delegation.id
                );
                discardLiveTranscriptThrough(event.offset_ms);
                return;
            }
            liveDelegations.push({
                id: delegation.id,
                offsetMs: event.offset_ms,
            });
            if (liveDelegations.length > 8) liveTranscriptOverflow = true;
            if (liveBoundaryPending) scheduleLiveDelegationSettlement();
        };

        const handleLiveProviderEvent = (event: OpenAiLiveVoiceEvent): void => {
            logLiveProviderUsage(event);
            if (event.type === 'session.closed') {
                if (closed) releaseCallReservation();
                else finishCall('provider_closed', false, true);
                return;
            }
            if (closed) return;
            if (
                event.type === 'transport.closed' ||
                event.type === 'transport.error'
            ) {
                finishCall('provider_connection_lost', false, true);
                return;
            }
            if (event.type === 'error') {
                sendServerEvent(ws, {
                    type: 'error',
                    message: 'The Live voice provider reported an error.',
                    code: 'live_provider_error',
                });
                finishCall('live_provider_error', true, true);
                return;
            }
            if (event.type === 'session.output_audio.delta') {
                forwardLiveAudioDelta(event);
                return;
            }
            if (event.type === 'session.input_transcript.delta') {
                recordLiveTranscriptDelta(event);
                return;
            }
            recordLiveDelegation(event);
        };

        const forwardRuntimeEvent = (
            event: Extract<
                InternalVoiceRealtimeServerEvent,
                { type: 'session.ready' }
            >
        ) => {
            if (closed) return;
            if (event.type === 'session.ready') {
                if (sessionReady) return;
                sessionReady = true;
                clearTimer(setupTimeout);
                setupTimeout = undefined;
                callTimeout = setTimer(
                    () => finishCall('call_limit_exceeded', true, true),
                    callLimitMs
                );
                callTimeout.unref?.();
            }
            try {
                sendServerEvent(ws, {
                    ...event,
                    mode: event.mode ?? mode ?? defaultMode,
                    ...(speechSelection ? { speechSelection } : {}),
                });
            } catch (error) {
                realtimeLogger.warn(
                    `Failed to send internal voice realtime event: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
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

            if (closed) return;

            if (event.type === 'session.close') {
                finishCall('client_close', true, true);
                return;
            }

            if (mode === 'standard' && sessionReady) {
                if (event.type === 'delivery.playback') {
                    const accepted = conversationState?.reportPlayback(
                        event.deliveryId,
                        event.event
                    );
                    if (
                        accepted &&
                        currentDeliveryId === event.deliveryId &&
                        event.event === 'completed' &&
                        currentDeliveryText
                    ) {
                        conversationState?.appendFinalizedTurn({
                            role: 'assistant',
                            speakerId: 'assistant',
                            content: currentDeliveryText,
                        });
                    }
                    if (
                        accepted &&
                        currentDeliveryId === event.deliveryId &&
                        event.event !== 'started'
                    ) {
                        currentDeliveryId = undefined;
                        currentDeliveryText = undefined;
                    }
                    return;
                }

                if (event.type === 'input_audio.append') {
                    if (
                        !initiatorId ||
                        event.speakerId !== initiatorId ||
                        !conversationState
                    ) {
                        sendServerEvent(ws, {
                            type: 'error',
                            message:
                                'Audio must come from the consenting caller.',
                            code: 'unknown_speaker',
                        });
                        finishCall('unknown_speaker', true, true);
                        return;
                    }
                    const audio = Buffer.from(event.audioBase64, 'base64');
                    if (audioBytes === 0) {
                        transcriptionController?.abort('new_utterance');
                        transcriptionController = undefined;
                        synthesisController?.abort('interrupted');
                        synthesisController = undefined;
                        currentDeliveryId = undefined;
                        currentDeliveryText = undefined;
                        conversationState.interruptDelivery();
                    }
                    if (
                        audio.length === 0 ||
                        audioBytes + audio.length > MAX_STANDARD_UTTERANCE_BYTES
                    ) {
                        audioChunks = [];
                        audioBytes = 0;
                        sendServerEvent(ws, {
                            type: 'error',
                            message:
                                'Voice utterance is empty or exceeds the size limit.',
                            code: 'invalid_audio',
                        });
                        return;
                    }
                    audioChunks.push(audio);
                    audioBytes += audio.length;
                    return;
                }

                if (event.type === 'input_audio.commit') {
                    const audio = Buffer.concat(audioChunks, audioBytes);
                    audioChunks = [];
                    audioBytes = 0;
                    if (audio.length === 0) {
                        sendServerEvent(ws, {
                            type: 'error',
                            message:
                                'No voice audio was received for that turn.',
                            code: 'empty_audio',
                        });
                        return;
                    }
                    transcribeStandardUtterance(audio);
                    return;
                }

                if (event.type === 'input_audio.clear') {
                    audioChunks = [];
                    audioBytes = 0;
                    transcriptionController?.abort('audio_cleared');
                    transcriptionController = undefined;
                    return;
                }

                sendServerEvent(ws, {
                    type: 'error',
                    message: 'That event is not supported in Standard mode.',
                    code: 'unsupported_standard_event',
                });
                return;
            }

            if (mode === 'live' && sessionReady && liveSession) {
                if (event.type === 'input_audio.append') {
                    if (
                        !initiatorId ||
                        event.speakerId !== initiatorId ||
                        !conversationState
                    ) {
                        sendServerEvent(ws, {
                            type: 'error',
                            message:
                                'Audio must come from the consenting caller.',
                            code: 'unknown_speaker',
                        });
                        finishCall('unknown_speaker', true, true);
                        return;
                    }
                    const audio = Buffer.from(event.audioBase64, 'base64');
                    const maxAudioBytes =
                        Math.ceil(callLimitMs / 1000) * 48_000;
                    if (
                        audio.length === 0 ||
                        liveAudioBytes + audio.length > maxAudioBytes
                    ) {
                        sendServerEvent(ws, {
                            type: 'error',
                            message:
                                'Live voice audio is empty or exceeds the call limit.',
                            code: 'invalid_audio',
                        });
                        finishCall('invalid_audio', true, true);
                        return;
                    }
                    if (!liveInputOpen) {
                        liveInputOpen = true;
                        liveCurrentUtteranceBytes = 0;
                        conversationState.interruptDelivery();
                    }
                    try {
                        liveSession.sendAudio(audio);
                        liveAudioBytes += audio.length;
                        liveCurrentUtteranceBytes += audio.length;
                    } catch {
                        sendServerEvent(ws, {
                            type: 'error',
                            message: 'Live voice audio could not be forwarded.',
                            code: 'live_audio_forward_failed',
                        });
                        finishCall('live_audio_forward_failed', true, true);
                    }
                    return;
                }

                if (event.type === 'input_audio.commit') {
                    if (!liveInputOpen || liveCurrentUtteranceBytes === 0) {
                        sendServerEvent(ws, {
                            type: 'error',
                            message:
                                'No Live voice audio was received for that turn.',
                            code: 'empty_audio',
                        });
                        return;
                    }
                    liveInputOpen = false;
                    liveCurrentUtteranceBytes = 0;
                    liveBoundaryPending = true;
                    liveBoundaryExpiresAt = Date.now() + 4_000;
                    scheduleLiveDelegationSettlement();
                    return;
                }

                if (event.type === 'input_audio.clear') {
                    sendServerEvent(ws, {
                        type: 'error',
                        message:
                            'Live voice cannot retract audio already sent to the provider.',
                        code: 'live_audio_clear_unsupported',
                    });
                    finishCall('live_audio_clear_unsupported', true, true);
                    return;
                }

                sendServerEvent(ws, {
                    type: 'error',
                    message: 'That event is not supported in Live mode.',
                    code: 'unsupported_live_event',
                });
                return;
            }

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

                const requestedMode = event.mode ?? defaultMode;
                const humans = event.context.participants.filter(
                    (participant) => !participant.isBot
                );
                const caller = event.initiatorId
                    ? humans.find(
                          (participant) => participant.id === event.initiatorId
                      )
                    : undefined;
                if (
                    (requestedMode === 'standard' ||
                        event.mode !== undefined) &&
                    (humans.length !== 1 || !caller)
                ) {
                    sendServerEvent(ws, {
                        type: 'error',
                        message:
                            'Voice calls require exactly one consenting human caller.',
                        code: 'single_speaker_required',
                    });
                    return;
                }
                if (
                    event.requestExtendedDuration &&
                    (!developerUserId || event.initiatorId !== developerUserId)
                ) {
                    sendServerEvent(ws, {
                        type: 'error',
                        message:
                            'Only the configured developer can request the extended call limit.',
                        code: 'duration_override_unauthorized',
                    });
                    return;
                }
                if (
                    requestedMode === 'standard' &&
                    (!openRouterVoiceService || !workflowRunner)
                ) {
                    sendServerEvent(ws, {
                        type: 'error',
                        message:
                            'Standard calls require OpenRouter speech and the configured Workflow.',
                        code: 'standard_voice_unavailable',
                    });
                    return;
                }
                if (
                    requestedMode === 'live' &&
                    !openAiLiveVoiceSessionFactory
                ) {
                    sendServerEvent(ws, {
                        type: 'error',
                        message: 'Live voice provider is unavailable.',
                        code: 'live_voice_unavailable',
                    });
                    return;
                }
                if (requestedMode === 'live' && !workflowRunner) {
                    sendServerEvent(ws, {
                        type: 'error',
                        message:
                            'Live delegation requires the configured Workflow.',
                        code: 'live_workflow_unavailable',
                    });
                    return;
                }
                if (activeVoiceCall !== undefined) {
                    sendServerEvent(ws, {
                        type: 'error',
                        message: 'A voice call is already active.',
                        code: 'voice_session_occupied',
                    });
                    return;
                }
                try {
                    persona = resolveVoicePersona(profile, realtimeLogger);
                } catch {
                    sendServerEvent(ws, {
                        type: 'error',
                        message:
                            'Configured Voice persona overlay is unavailable. Check the bot profile configuration.',
                        code: 'voice_persona_unavailable',
                    });
                    return;
                }
                mode = requestedMode;
                initiatorId = event.initiatorId;
                callLimitMs =
                    event.requestExtendedDuration &&
                    developerUserId === event.initiatorId
                        ? EXTENDED_CALL_LIMIT_MS
                        : CALL_LIMIT_MS;
                sessionStarted = true;
                callReservation = Symbol('voice-call');
                activeVoiceCall = callReservation;
                setupTimeout = setTimer(
                    () => finishCall('setup_timeout', true, true),
                    SESSION_SETUP_TIMEOUT_MS
                );
                setupTimeout.unref?.();
                realtimeLogger.info('Internal voice session starting.', {
                    mode,
                    profileId: profile.id,
                });
                if (mode === 'standard') {
                    speechSelection = resolveSpeechSelection({
                        profile,
                        provider: 'openrouter',
                        modality: 'tts',
                        fallback: {
                            model: STANDARD_TTS_MODEL,
                            voice: STANDARD_TTS_VOICE,
                        },
                    });
                    try {
                        conversationState = new RealtimeConversationState(
                            sessionCorrelationId
                        );
                        conversationState.setAudience([
                            {
                                id: caller!.id,
                                displayName: caller!.displayName,
                                processingConsent: true,
                            },
                        ]);
                        conversationUnsubscribe =
                            conversationState.onDeliveryReady((handle) => {
                                void synthesizeApprovedDelivery(handle);
                            });
                        forwardRuntimeEvent({ type: 'session.ready' });
                    } catch (error) {
                        realtimeLogger.error(
                            'Internal Standard voice session setup failed.',
                            {
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : String(error),
                            }
                        );
                        finishCall('setup_failed', false, true);
                    }
                    return;
                }
                if (mode === 'live' && openAiLiveVoiceSessionFactory) {
                    if (!caller || humans.length !== 1 || !initiatorId) {
                        sendServerEvent(ws, {
                            type: 'error',
                            message:
                                'Live calls require exactly one consenting human caller.',
                            code: 'single_speaker_required',
                        });
                        finishCall('setup_failed', false, true);
                        return;
                    }
                    const requestedVoice = event.options?.voice;
                    if (
                        requestedVoice !== undefined &&
                        !['marin', 'cedar'].includes(requestedVoice)
                    ) {
                        sendServerEvent(ws, {
                            type: 'error',
                            message:
                                'Live voice supports the marin and cedar voices.',
                            code: 'unsupported_speech_selection',
                        });
                        finishCall('setup_failed', false, true);
                        return;
                    }
                    const profileVoice =
                        profile.speechPresentation?.realtimeVoice;
                    const ignoreOperatorVoice =
                        !requestedVoice &&
                        profileVoice !== undefined &&
                        !['marin', 'cedar'].includes(profileVoice);
                    speechSelection = resolveSpeechSelection({
                        profile,
                        provider: 'openai',
                        modality: 'realtime',
                        request: {
                            ...(requestedVoice
                                ? { voice: requestedVoice }
                                : {}),
                            ...(event.options?.delivery
                                ? { delivery: event.options.delivery }
                                : {}),
                        },
                        ignoreOperatorModel: true,
                        ignoreOperatorVoice,
                        fallbackReason: ignoreOperatorVoice
                            ? 'Configured profile voice is unsupported by Live; using the deployment fallback.'
                            : null,
                        fallback: { model: 'gpt-live-1', voice: 'marin' },
                    });
                    speechSelection.model = 'gpt-live-1';
                    try {
                        conversationState = new RealtimeConversationState(
                            sessionCorrelationId
                        );
                        conversationState.setAudience([
                            {
                                id: caller.id,
                                displayName: caller.displayName,
                                processingConsent: true,
                            },
                        ]);
                        conversationUnsubscribe =
                            conversationState.onDeliveryReady((handle) => {
                                deliverApprovedLiveAnswer(handle);
                            });
                        providerSetupController = new AbortController();
                        const createdSession =
                            await openAiLiveVoiceSessionFactory({
                                instructions: [
                                    `You are ${persona.profile.displayName}, Footnote's voice assistant.`,
                                    'Speak naturally and briefly. Listen for corrections and let the caller interrupt. Handle casual conversation, but delegate requests needing facts, research, decisions, or actions to Footnote. Do not invent results or announce an action before Footnote reports it. When Footnote sends a reviewed answer, communicate it naturally; your spoken wording may differ from the reviewed text.',
                                    ...(speechSelection.delivery
                                        ? [
                                              `Speech delivery guidance: ${speechSelection.delivery}`,
                                          ]
                                        : []),
                                ].join('\n\n'),
                                voice: speechSelection.voice,
                                signal: providerSetupController.signal,
                            });
                        providerSetupController = undefined;
                        if (!isSocketOpen()) {
                            createdSession.close();
                            releaseCallReservation();
                            return;
                        }
                        liveSession = createdSession;
                        liveUnsubscribe = liveSession.onEvent(
                            handleLiveProviderEvent
                        );
                        forwardRuntimeEvent({
                            type: 'session.ready',
                            mode: 'live',
                        });
                    } catch (error) {
                        providerSetupController?.abort('setup_failed');
                        providerSetupController = undefined;
                        realtimeLogger.error(
                            'Internal GPT-Live voice session start failed.',
                            {
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : String(error),
                            }
                        );
                        if (isSocketOpen())
                            sendServerEvent(ws, {
                                type: 'error',
                                message: 'Failed to start Live voice.',
                                code: 'live_voice_setup_failed',
                            });
                        finishCall('setup_failed', false, true);
                    }
                    return;
                }
            }
            if (mode && !sessionReady) {
                sendServerEvent(ws, {
                    type: 'error',
                    message: 'Realtime provider session is not ready.',
                    code: 'session_not_ready',
                });
                return;
            }

            sendServerEvent(ws, {
                type: 'error',
                message: mode
                    ? 'That event is not supported for this voice mode.'
                    : 'Realtime session not initialized.',
                ...(mode ? { code: 'unsupported_voice_event' } : {}),
            });
        });
        ws.on('close', () => {
            socketClosed = true;
            finishCall('client_close', true, false);
        });

        ws.on('error', (error) => {
            socketClosed = true;
            realtimeLogger.error('Internal voice realtime websocket error.', {
                error: error instanceof Error ? error.message : String(error),
            });
            finishCall('socket_error', true, false);
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

        if (!openRouterVoiceService && !openAiLiveVoiceSessionFactory) {
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
