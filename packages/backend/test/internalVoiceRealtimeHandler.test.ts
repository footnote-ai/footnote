/**
 * @description: Covers trusted realtime voice websocket upgrade behavior at the backend boundary.
 * @footnote-scope: test
 * @footnote-module: InternalVoiceRealtimeHandlerTests
 * @footnote-risk: medium - Missing tests could hide auth or upgrade regressions for live voice sessions.
 * @footnote-ethics: high - These checks protect a privacy-sensitive internal voice boundary from accidental exposure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import type { InternalVoiceRealtimeServerEvent } from '@footnote/contracts/voice';
import type { BotProfileConfig } from '../src/config/profile.js';
import type {
    RealtimeVoiceRuntime,
    RealtimeVoiceSession,
} from '@footnote/agent-runtime';
import type { OpenRouterVoiceService } from '../src/services/openRouterVoice.js';
import type {
    OpenAiLiveVoiceEvent,
    OpenAiLiveVoiceSession,
    OpenAiLiveVoiceSessionFactory,
} from '../src/services/openAiLiveVoice.js';
import type { RealtimeWorkflowRunner } from '../src/services/realtimeConversationState.js';

import { createInternalVoiceRealtimeHandler } from '../src/handlers/internalVoiceRealtime.js';
import { SimpleRateLimiter } from '../src/services/rateLimiter.js';

const testProfile: BotProfileConfig = {
    id: 'winter',
    displayName: 'Winter',
    mentionAliases: [],
    promptOverlay: {
        source: 'none' as const,
        text: null,
        path: null,
        length: 0,
    },
    speechPresentation: { realtimeDelivery: 'dry and direct' },
};

class FakeUpgradeSocket extends Duplex {
    public written = '';
    public destroyedByHandler = false;
    public endedByHandler = false;

    public _read(): void {}

    public _write(
        chunk: string | Buffer,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void
    ): void {
        this.written += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
        callback();
    }

    public override destroy(error?: Error): this {
        this.destroyedByHandler = true;
        return super.destroy(error);
    }

    public override end(cb?: () => void): this;
    public override end(chunk: string | Buffer, cb?: () => void): this;
    public override end(
        chunk: string | Buffer,
        encoding: BufferEncoding,
        cb?: () => void
    ): this;
    public override end(
        chunk?: string | Buffer | (() => void),
        encoding?: BufferEncoding | (() => void),
        cb?: () => void
    ): this {
        this.endedByHandler = true;
        if (typeof chunk === 'function') {
            return super.end(chunk);
        }
        if (typeof encoding === 'function') {
            return super.end(chunk, encoding);
        }
        if (typeof encoding === 'string') {
            return super.end(chunk, encoding, cb);
        }
        return super.end(chunk, cb);
    }
}

class StubRealtimeSession implements RealtimeVoiceSession {
    public readonly sentClientEvents: Array<{ type: string }> = [];
    public readonly closedReasons: string[] = [];
    private readonly listeners: Array<
        (event: InternalVoiceRealtimeServerEvent) => void
    > = [];

    public async send(event: { type: string }): Promise<void> {
        this.sentClientEvents.push(event);
    }

    public onEvent(
        listener: (event: InternalVoiceRealtimeServerEvent) => void
    ): void {
        this.listeners.push(listener);
    }

    public close(reason = 'client_close'): void {
        this.closedReasons.push(reason);
        this.emitServerEvent({ type: 'session.closed', reason });
    }

    public emitServerEvent(event: InternalVoiceRealtimeServerEvent): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }
}

class StubOpenAiLiveVoiceSession implements OpenAiLiveVoiceSession {
    public readonly audio: Buffer[] = [];
    public readonly commentary: Array<{
        text: string;
        delegationId: string | null;
    }> = [];
    public closed = false;
    private readonly listeners = new Set<
        (event: OpenAiLiveVoiceEvent) => void
    >();

    public sendAudio(audio: Buffer): void {
        this.audio.push(audio);
    }

    public appendCommentary(text: string, delegationId: string | null): void {
        this.commentary.push({ text, delegationId });
    }

    public close(): void {
        this.closed = true;
        this.emit({ type: 'session.closed', usage: { seconds: 0 } });
    }

    public onEvent(
        listener: (event: OpenAiLiveVoiceEvent) => void
    ): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public emit(event: OpenAiLiveVoiceEvent): void {
        for (const listener of this.listeners) listener(event);
    }
}

type RealtimeHandlerHarness = {
    close: () => Promise<void>;
    connect: (headers?: Record<string, string>) => Promise<WebSocket>;
    lastLiveSession: () => StubOpenAiLiveVoiceSession | null;
    legacySessionCreations: () => number;
};

const createRealtimeHandlerHarness = async (
    overrides: {
        profile?: typeof testProfile;
        setTimer?: typeof setTimeout;
        clearTimer?: typeof clearTimeout;
        openRouterVoiceService?: OpenRouterVoiceService | null;
        workflowRunner?: RealtimeWorkflowRunner | null;
        developerUserId?: string | null;
        defaultMode?: 'standard' | 'live';
        maxAnswerTokens?: number;
        openAiLiveVoiceSessionFactory?: OpenAiLiveVoiceSessionFactory | null;
    } = {}
): Promise<RealtimeHandlerHarness> => {
    let currentLiveSession: StubOpenAiLiveVoiceSession | null = null;
    let legacySessionCreations = 0;
    const liveFactory =
        overrides.openAiLiveVoiceSessionFactory === undefined
            ? async () => new StubOpenAiLiveVoiceSession()
            : overrides.openAiLiveVoiceSessionFactory;
    const workflowRunner: RealtimeWorkflowRunner | null =
        overrides.workflowRunner === undefined
            ? {
                  async runRealtimeConversation(_snapshot, context) {
                      context.onRunStarted('test-run');
                      return {
                          responseId: 'test-response',
                          runId: 'test-run',
                          status: 'completed',
                          finalResponse: {
                              disposition: 'approved' as const,
                              responseId: 'test-response',
                              runId: 'test-run',
                              candidateId: 'candidate',
                              generationStepId: 'answer',
                              assessmentStepId: 'review',
                              text: 'Test answer.',
                          },
                      };
                  },
              }
            : overrides.workflowRunner;
    const runtime: RealtimeVoiceRuntime = {
        kind: 'stub-realtime-runtime',
        provider: 'openai',
        supportsModel: () => true,
        supportsVoice: () => true,
        async createSession() {
            legacySessionCreations += 1;
            return new StubRealtimeSession();
        },
    };

    const handlerOptions: Parameters<
        typeof createInternalVoiceRealtimeHandler
    >[0] = {
        defaultMode: overrides.defaultMode ?? 'live',
        maxAnswerTokens: overrides.maxAnswerTokens ?? 160,
        openAiLiveVoiceSessionFactory: liveFactory
            ? async (request) => {
                  const created = await liveFactory(request);
                  currentLiveSession = created as StubOpenAiLiveVoiceSession;
                  return created;
              }
            : null,
        openRouterVoiceService: overrides.openRouterVoiceService,
        workflowRunner,
        developerUserId: overrides.developerUserId,
        profile: overrides.profile ?? testProfile,
        traceApiToken: 'trace-token',
        serviceToken: 'service-token',
        serviceRateLimiter: new SimpleRateLimiter({
            limit: 10,
            window: 60000,
        }),
        setTimer: overrides.setTimer,
        clearTimer: overrides.clearTimer,
    };
    const { handleUpgrade } = createInternalVoiceRealtimeHandler(
        Object.assign(handlerOptions, {
            realtimeVoiceRuntime: runtime,
        }) as Parameters<typeof createInternalVoiceRealtimeHandler>[0]
    );

    const server = http.createServer((_req, res) => {
        res.statusCode = 404;
        res.end();
    });

    server.on('upgrade', (req, socket, head) => {
        handleUpgrade(req, socket, head);
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    return {
        close: () =>
            new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            }),
        connect: (headers = {}) =>
            new Promise((resolve, reject) => {
                const ws = new WebSocket(
                    `ws://127.0.0.1:${address.port}/api/internal/voice/realtime`,
                    {
                        headers: {
                            'X-Trace-Token': 'trace-token',
                            ...headers,
                        },
                    }
                );
                ws.once('open', () => resolve(ws));
                ws.once('error', reject);
            }),
        lastLiveSession: () => currentLiveSession,
        legacySessionCreations: () => legacySessionCreations,
    };
};

const waitForLiveSession = (
    harness: RealtimeHandlerHarness,
    previous?: StubOpenAiLiveVoiceSession
): Promise<StubOpenAiLiveVoiceSession> =>
    new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const poll = () => {
            const current = harness.lastLiveSession();
            if (current && current !== previous) {
                resolve(current);
                return;
            }
            if (Date.now() - startedAt > 1000) {
                reject(
                    new Error(
                        previous
                            ? 'Second Live session was not created.'
                            : 'Live session was not created.'
                    )
                );
                return;
            }
            setImmediate(poll);
        };
        poll();
    });

const createFakeClock = () => {
    let now = 0;
    let nextId = 0;
    const timers = new Map<number, { dueAt: number; callback: () => void }>();
    const setTimer = ((callback: () => void, delay = 0) => {
        const id = ++nextId;
        timers.set(id, { dueAt: now + delay, callback });
        return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    const clearTimer = ((handle?: ReturnType<typeof setTimeout>) => {
        if (handle !== undefined) timers.delete(handle as unknown as number);
    }) as typeof clearTimeout;

    return {
        setTimer,
        clearTimer,
        tick(ms: number) {
            const target = now + ms;
            while (true) {
                const next = [...timers.entries()]
                    .filter(([, timer]) => timer.dueAt <= target)
                    .sort((a, b) => a[1].dueAt - b[1].dueAt)[0];
                if (!next) break;
                const [id, timer] = next;
                timers.delete(id);
                now = timer.dueAt;
                timer.callback();
            }
            now = target;
        },
    };
};

test('backend closes a Live call after its 60-second limit', async () => {
    const clock = createFakeClock();
    const harness = await createRealtimeHandlerHarness({
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
    });
    let ws: WebSocket | undefined;

    try {
        ws = await harness.connect();
        ws.send(
            JSON.stringify({
                type: 'session.start',
                mode: 'live',
                initiatorId: 'user-1',
                context: {
                    participants: [
                        { id: 'user-1', displayName: 'Alice', isBot: false },
                    ],
                },
            })
        );
        const session = await waitForLiveSession(harness);
        await waitForJsonMessage(ws);
        const closedMessage = waitForJsonMessage(ws);
        clock.tick(59_999);
        assert.equal(session.closed, false);

        clock.tick(1);
        assert.deepEqual(await closedMessage, {
            type: 'session.closed',
            reason: 'call_limit_exceeded',
        });
        assert.equal(session.closed, true);
        await closeWebSocket(ws);
    } finally {
        if (ws) await closeWebSocket(ws);
        await harness.close();
    }
});

test('backend closes a Live call when provider setup exceeds its timeout', async () => {
    const clock = createFakeClock();
    const harness = await createRealtimeHandlerHarness({
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
        openAiLiveVoiceSessionFactory: () => new Promise(() => undefined),
    });
    let ws: WebSocket | undefined;

    try {
        ws = await harness.connect();
        ws.send(
            JSON.stringify({
                type: 'session.start',
                mode: 'live',
                initiatorId: 'user-1',
                context: {
                    participants: [
                        { id: 'user-1', displayName: 'Alice', isBot: false },
                    ],
                },
            })
        );
        const notReadyMessage = waitForJsonMessage(ws);
        ws.send(JSON.stringify({ type: 'input_audio.commit' }));
        assert.deepEqual(await notReadyMessage, {
            type: 'error',
            message: 'Realtime provider session is not ready.',
            code: 'session_not_ready',
        });
        const closedMessage = waitForJsonMessage(ws);

        clock.tick(15_000);

        assert.deepEqual(await closedMessage, {
            type: 'session.closed',
            reason: 'setup_timeout',
        });
        await closeWebSocket(ws);
    } finally {
        if (ws) await closeWebSocket(ws);
        await harness.close();
    }
});

test('only one authenticated Live call can hold backend session capacity', async () => {
    const harness = await createRealtimeHandlerHarness();
    let firstSocket: WebSocket | undefined;
    let secondSocket: WebSocket | undefined;

    try {
        firstSocket = await harness.connect();
        firstSocket.send(
            JSON.stringify({
                type: 'session.start',
                mode: 'live',
                initiatorId: 'user-1',
                context: {
                    participants: [
                        { id: 'user-1', displayName: 'Alice', isBot: false },
                    ],
                },
            })
        );
        const firstSession = await waitForLiveSession(harness);
        await waitForJsonMessage(firstSocket);

        secondSocket = await harness.connect();
        secondSocket.send(
            JSON.stringify({
                type: 'session.start',
                mode: 'live',
                initiatorId: 'user-1',
                context: {
                    participants: [
                        { id: 'user-1', displayName: 'Alice', isBot: false },
                    ],
                },
            })
        );
        assert.deepEqual(await waitForJsonMessage(secondSocket, 100), {
            type: 'error',
            message: 'A voice call is already active.',
            code: 'voice_session_occupied',
        });
        assert.equal(harness.legacySessionCreations(), 0);

        const firstClosedMessage = waitForJsonMessage(firstSocket);
        firstSocket.send(JSON.stringify({ type: 'session.close' }));
        assert.deepEqual(await firstClosedMessage, {
            type: 'session.closed',
            reason: 'client_close',
        });
        secondSocket.send(
            JSON.stringify({
                type: 'session.start',
                mode: 'live',
                initiatorId: 'user-1',
                context: {
                    participants: [
                        { id: 'user-1', displayName: 'Alice', isBot: false },
                    ],
                },
            })
        );
        const secondSession = await waitForLiveSession(harness, firstSession);
        assert.equal(firstSession.closed, true);
        assert.equal(secondSession.closed, false);
        await waitForJsonMessage(secondSocket);
        await closeWebSocket(secondSocket);
    } finally {
        if (firstSocket) await closeWebSocket(firstSocket);
        if (secondSocket) await closeWebSocket(secondSocket);
        await harness.close();
    }
});

const waitForJsonMessage = async (
    ws: WebSocket,
    timeoutMs?: number
): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
        const timer =
            timeoutMs === undefined
                ? undefined
                : setTimeout(() => {
                      cleanup();
                      reject(new Error('Timed out waiting for a voice event.'));
                  }, timeoutMs);
        const onMessage = (data: WebSocket.RawData) => {
            cleanup();
            try {
                resolve(JSON.parse(data.toString()) as Record<string, unknown>);
            } catch (error) {
                reject(error);
            }
        };
        const onError = (error: Error) => {
            cleanup();
            reject(error);
        };
        const cleanup = () => {
            if (timer) clearTimeout(timer);
            ws.off('message', onMessage);
            ws.off('error', onError);
        };
        ws.on('message', onMessage);
        ws.on('error', onError);
    });

const closeWebSocket = async (ws: WebSocket): Promise<void> =>
    new Promise((resolve) => {
        if (
            ws.readyState === WebSocket.CLOSED ||
            ws.readyState === WebSocket.CLOSING
        ) {
            resolve();
            return;
        }

        ws.once('close', () => resolve());
        ws.close();
    });

test('internal realtime handler rejects websocket upgrades without trusted auth', () => {
    const { handleUpgrade } = createInternalVoiceRealtimeHandler({
        maxAnswerTokens: 160,
        profile: testProfile,
        traceApiToken: 'trace-token',
        serviceToken: 'service-token',
        serviceRateLimiter: new SimpleRateLimiter({ limit: 10, window: 60000 }),
    });
    const socket = new FakeUpgradeSocket();
    const request = {
        method: 'GET',
        headers: {},
    } as unknown as IncomingMessage;

    handleUpgrade(request, socket, Buffer.alloc(0));

    assert.match(socket.written, /401 Unauthorized/);
    assert.match(socket.written, /Missing trusted service credentials/);
    assert.equal(socket.endedByHandler, true);
});

test('internal realtime handler returns provider_unavailable when runtime is missing', () => {
    const { handleUpgrade } = createInternalVoiceRealtimeHandler({
        maxAnswerTokens: 160,
        profile: testProfile,
        traceApiToken: 'trace-token',
        serviceToken: null,
        serviceRateLimiter: new SimpleRateLimiter({ limit: 10, window: 60000 }),
    });
    const socket = new FakeUpgradeSocket();
    const request = {
        method: 'GET',
        headers: {
            'x-trace-token': 'trace-token',
        },
    } as unknown as IncomingMessage;

    handleUpgrade(request, socket, Buffer.alloc(0));

    assert.match(socket.written, /503 Service Unavailable/);
    assert.match(
        socket.written,
        /Internal voice realtime provider unavailable/
    );
    assert.match(socket.written, /provider_unavailable/);
    assert.equal(socket.endedByHandler, true);
});

test('Live fails closed when GPT-Live is missing even if the legacy runtime exists', async () => {
    const harness = await createRealtimeHandlerHarness({
        openAiLiveVoiceSessionFactory: null,
        openRouterVoiceService: {
            async transcribe() {
                return { text: 'question' };
            },
            async synthesize() {
                return { audio: Buffer.from([0, 0]) };
            },
        },
    });
    let ws: WebSocket | undefined;

    try {
        ws = await harness.connect();
        ws.send(
            JSON.stringify({
                type: 'session.start',
                mode: 'live',
                initiatorId: 'user-1',
                context: {
                    participants: [
                        { id: 'user-1', displayName: 'Alice', isBot: false },
                    ],
                },
            })
        );

        assert.deepEqual(await waitForJsonMessage(ws), {
            type: 'error',
            message: 'Live voice provider is unavailable.',
            code: 'live_voice_unavailable',
        });
        assert.equal(harness.legacySessionCreations(), 0);
    } finally {
        if (ws) await closeWebSocket(ws);
        await harness.close();
    }
});

test('Standard can start when GPT-Live is not configured', async () => {
    const harness = await createRealtimeHandlerHarness({
        defaultMode: 'standard',
        openAiLiveVoiceSessionFactory: null,
        openRouterVoiceService: {
            async transcribe() {
                return { text: 'question' };
            },
            async synthesize() {
                return { audio: Buffer.from([0, 0]) };
            },
        },
    });
    let ws: WebSocket | undefined;

    try {
        ws = await harness.connect();
        ws.send(
            JSON.stringify({
                type: 'session.start',
                initiatorId: 'user-1',
                context: {
                    participants: [
                        { id: 'user-1', displayName: 'Alice', isBot: false },
                    ],
                },
            })
        );

        const ready = await waitForJsonMessage(ws);
        assert.equal(ready.type, 'session.ready');
        assert.equal(ready.mode, 'standard');
        assert.equal(harness.legacySessionCreations(), 0);
        ws.send(JSON.stringify({ type: 'session.close' }));
        await closeWebSocket(ws);
    } finally {
        if (ws) await closeWebSocket(ws);
        await harness.close();
    }
});

test('internal realtime handler rejects invalid realtime payloads after websocket upgrade', async () => {
    const harness = await createRealtimeHandlerHarness();

    try {
        const ws = await harness.connect();
        ws.send(
            JSON.stringify({
                type: 'session.start',
                context: {
                    participants: [{ id: 'user-1' }],
                },
            })
        );

        const message = await waitForJsonMessage(ws);
        assert.equal(message.type, 'error');
        assert.match(String(message.message), /Invalid realtime event/);
        await closeWebSocket(ws);
    } finally {
        await harness.close();
    }
});

test('Standard transcribes one attributed utterance and synthesizes only the approved Workflow answer', async () => {
    const inputAudio = Buffer.from([0, 0, 1, 0]);
    const synthesized: string[] = [];
    const snapshots: string[] = [];
    const profile: BotProfileConfig = {
        ...testProfile,
        id: 'custom',
        displayName: 'Custom operator',
        personaExpressionStrength: 'subtle',
        promptOverlay: {
            source: 'inline',
            text: 'PRIVATE_OVERLAY',
            path: null,
            length: 15,
        },
    };
    const harness = await createRealtimeHandlerHarness({
        profile,
        defaultMode: 'standard',
        openRouterVoiceService: {
            async transcribe(audio) {
                assert.deepEqual(audio, inputAudio);
                return { text: 'What is the answer?' };
            },
            async synthesize(text, options) {
                synthesized.push(text);
                assert.equal(
                    options.model,
                    'openai/gpt-4o-mini-tts-2025-12-15'
                );
                assert.equal(options.voice, 'alloy');
                return { audio: Buffer.from([0, 0, 1, 0]) };
            },
        },
        workflowRunner: {
            async runRealtimeConversation(snapshot, context) {
                assert.equal(context.voiceMode, 'standard');
                assert.equal(context.maxAnswerTokens, 160);
                assert.equal(context.persona?.profile.id, 'custom');
                assert.equal(
                    context.persona?.profile.promptOverlay.text,
                    'PRIVATE_OVERLAY'
                );
                assert.equal(context.persona?.expression.strength, 'subtle');
                context.onRunStarted('workflow-run');
                snapshots.push(JSON.stringify(snapshot));
                return {
                    responseId: 'workflow-response',
                    runId: 'workflow-run',
                    status: 'completed',
                    finalResponse: {
                        disposition: 'approved',
                        responseId: 'workflow-response',
                        runId: 'workflow-run',
                        candidateId: 'candidate',
                        generationStepId: 'answer',
                        assessmentStepId: 'review',
                        text: 'The reviewed answer.',
                    },
                };
            },
        },
    });

    let ws: WebSocket | undefined;
    try {
        ws = await harness.connect();
        ws.send(
            JSON.stringify({
                type: 'session.start',
                initiatorId: 'user-1',
                context: {
                    participants: [
                        { id: 'user-1', displayName: 'Alice', isBot: false },
                    ],
                },
            })
        );
        const ready = await waitForJsonMessage(ws, 1000);
        assert.equal(ready.type, 'session.ready');
        profile.id = 'changed-after-admission';
        profile.promptOverlay.text = 'changed-after-admission';
        profile.personaExpressionStrength = 'strong';
        ws.send(
            JSON.stringify({
                type: 'input_audio.append',
                audioBase64: inputAudio.toString('base64'),
                speakerLabel: 'Alice',
                speakerId: 'user-1',
            })
        );
        ws.send(JSON.stringify({ type: 'input_audio.commit' }));
        const audio = await waitForJsonMessage(ws, 1000);
        assert.equal(audio.type, 'output_audio.delta');
        assert.equal(
            audio.audioBase64,
            Buffer.from([0, 0, 1, 0]).toString('base64')
        );
        assert.equal(typeof audio.deliveryId, 'string');
        assert.equal(synthesized[0], 'The reviewed answer.');
        assert.equal(snapshots.length, 1);
        assert.match(snapshots[0], /What is the answer\?/);
        ws.send(JSON.stringify({ type: 'session.close' }));
        await closeWebSocket(ws);
    } finally {
        if (ws) await closeWebSocket(ws);
        await harness.close();
    }
});

test('over-limit answers and Workflow limits never reach Standard TTS or Live commentary', async () => {
    const inputAudio = Buffer.from([0, 0, 1, 0]);
    const answer = '答'.repeat(100);
    for (const mode of ['standard', 'live'] as const) {
        for (const failureKind of [
            'answer_too_long',
            'workflow_limit_reached',
        ] as const) {
            const synthesized: string[] = [];
            const liveSession = new StubOpenAiLiveVoiceSession();
            let workflowCalls = 0;
            const harness = await createRealtimeHandlerHarness({
                defaultMode: mode,
                maxAnswerTokens: 4,
                openAiLiveVoiceSessionFactory: async () => liveSession,
                openRouterVoiceService:
                    mode === 'standard'
                        ? {
                              async transcribe() {
                                  return { text: 'What is the answer?' };
                              },
                              async synthesize(text) {
                                  synthesized.push(text);
                                  return { audio: Buffer.from([0, 0]) };
                              },
                          }
                        : undefined,
                workflowRunner: {
                    async runRealtimeConversation(_snapshot, context) {
                        workflowCalls += 1;
                        context.onRunStarted('workflow-run');
                        return {
                            responseId: 'response',
                            runId: 'workflow-run',
                            status: 'completed',
                            finalResponse: {
                                ...(failureKind === 'answer_too_long'
                                    ? {
                                          disposition: 'approved',
                                          responseId: 'response',
                                          runId: 'workflow-run',
                                          candidateId: 'candidate',
                                          generationStepId: 'answer',
                                          assessmentStepId: 'review',
                                          text: answer,
                                      }
                                    : {
                                          disposition: 'workflow_limit_reached',
                                          limitReason: 'budget_exhausted_steps',
                                      }),
                            },
                        };
                    },
                },
            });
            let ws: WebSocket | undefined;
            try {
                ws = await harness.connect();
                ws.send(
                    JSON.stringify({
                        type: 'session.start',
                        mode,
                        initiatorId: 'user-1',
                        context: {
                            participants: [
                                {
                                    id: 'user-1',
                                    displayName: 'Alice',
                                    isBot: false,
                                },
                            ],
                        },
                    })
                );
                assert.equal(
                    (await waitForJsonMessage(ws)).type,
                    'session.ready'
                );
                const failurePromise = waitForJsonMessage(ws, 3_000);
                ws.send(
                    JSON.stringify({
                        type: 'input_audio.append',
                        audioBase64: inputAudio.toString('base64'),
                        speakerLabel: 'Alice',
                        speakerId: 'user-1',
                    })
                );
                ws.send(JSON.stringify({ type: 'input_audio.commit' }));

                if (mode === 'live') {
                    const session = await waitForLiveSession(harness);
                    await new Promise((resolve) => setTimeout(resolve, 600));
                    session.emit({
                        type: 'session.input_transcript.delta',
                        event_id: 'transcript-1',
                        delta: 'What is the answer?',
                        start_ms: 0,
                        end_ms: 500,
                    });
                    session.emit({
                        type: 'session.delegation.created',
                        event_id: 'delegation-1',
                        offset_ms: 600,
                        delegation: {
                            id: 'delegation-1',
                            target: 'client',
                            type: 'delegation',
                        },
                    });
                    await new Promise((resolve) => setTimeout(resolve, 600));
                    assert.deepEqual(session.commentary, []);
                }

                const failure = await failurePromise;
                assert.equal(failure.type, 'error');
                assert.equal(
                    failure.code,
                    failureKind === 'answer_too_long'
                        ? 'answer_too_long'
                        : 'workflow_limit_reached'
                );
                if (failureKind === 'workflow_limit_reached')
                    assert.equal(
                        failure.message,
                        'The Voice answer could not be safely prepared within the Workflow step limit.'
                    );
                assert.equal(workflowCalls, 1);
                assert.deepEqual(synthesized, []);
            } finally {
                if (ws) await closeWebSocket(ws);
                await harness.close();
            }
        }
    }
});

test('Live streams only caller audio, delegates the caller transcript, and returns the approved Workflow answer as commentary', async () => {
    const inputAudio = Buffer.from([0, 0, 1, 0]);
    const snapshots: string[] = [];
    const reviewedAnswer =
        'The reviewed answer keeps its explanation and source.';
    const stubLiveSession = new StubOpenAiLiveVoiceSession();
    let startRequest: { instructions: string; voice: string } | undefined;
    const harness = await createRealtimeHandlerHarness({
        openAiLiveVoiceSessionFactory: async (request) => {
            startRequest = request;
            return stubLiveSession;
        },
        workflowRunner: {
            async runRealtimeConversation(snapshot, context) {
                assert.equal(context.voiceMode, 'live');
                assert.equal(context.maxAnswerTokens, 160);
                assert.equal(context.persona?.profile.id, 'winter');
                assert.match(
                    context.persona?.profile.promptOverlay.text ?? '',
                    /The active persona is Winter/
                );
                assert.equal(context.persona?.expression.strength, 'strong');
                context.onRunStarted('live-workflow-run');
                snapshots.push(JSON.stringify(snapshot));
                return {
                    responseId: 'live-workflow-response',
                    runId: 'live-workflow-run',
                    status: 'completed',
                    finalResponse: {
                        disposition: 'approved',
                        responseId: 'live-workflow-response',
                        runId: 'live-workflow-run',
                        candidateId: 'candidate',
                        generationStepId: 'answer',
                        assessmentStepId: 'review',
                        text: reviewedAnswer,
                    },
                };
            },
        },
    });

    let ws: WebSocket | undefined;
    try {
        ws = await harness.connect();
        ws.send(
            JSON.stringify({
                type: 'session.start',
                mode: 'live',
                initiatorId: 'user-1',
                context: {
                    participants: [
                        { id: 'user-1', displayName: 'Alice', isBot: false },
                    ],
                },
            })
        );
        const ready = await waitForJsonMessage(ws, 1000);
        assert.equal(ready.type, 'session.ready');
        assert.equal(ready.mode, 'live');
        assert.equal(startRequest?.voice, 'marin');
        assert.match(startRequest?.instructions ?? '', /delegate/i);

        ws.send(
            JSON.stringify({
                type: 'input_audio.append',
                audioBase64: inputAudio.toString('base64'),
                speakerLabel: 'Alice',
                speakerId: 'user-1',
            })
        );
        ws.send(JSON.stringify({ type: 'input_audio.commit' }));
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.deepEqual(stubLiveSession.audio, [inputAudio]);
        await new Promise((resolve) => setTimeout(resolve, 600));

        stubLiveSession.emit({
            type: 'session.input_transcript.delta',
            event_id: 'transcript-1',
            delta: 'What is the answer?',
            start_ms: 0,
            end_ms: 500,
        });
        stubLiveSession.emit({
            type: 'session.delegation.created',
            event_id: 'delegation-event-1',
            offset_ms: 600,
            delegation: {
                id: 'delegation-1',
                target: 'client',
                type: 'delegation',
            },
        });
        await new Promise((resolve) => setTimeout(resolve, 600));

        assert.equal(snapshots.length, 1);
        assert.match(snapshots[0] ?? '', /What is the answer\?/);
        assert.deepEqual(stubLiveSession.commentary, [
            {
                text: reviewedAnswer,
                delegationId: 'delegation-1',
            },
        ]);

        stubLiveSession.emit({
            type: 'session.output_audio.delta',
            delta: Buffer.from([0, 0]).toString('base64'),
        });
        const audio = await waitForJsonMessage(ws, 1000);
        assert.deepEqual(audio, {
            type: 'output_audio.delta',
            audioBase64: Buffer.from([0, 0]).toString('base64'),
        });
        ws.send(JSON.stringify({ type: 'session.close' }));
        await closeWebSocket(ws);
    } finally {
        if (ws) await closeWebSocket(ws);
        await harness.close();
    }
});

for (const mode of ['standard', 'live'] as const) {
    test(`${mode} rejects an unavailable configured persona before provider startup and allows corrected admission`, async () => {
        const profile: BotProfileConfig = {
            ...testProfile,
            id: 'custom',
            promptOverlay: {
                source: 'none',
                text: null,
                path: 'PRIVATE_MISSING_PATH',
                length: 0,
            },
        };
        let providerCalls = 0;
        const harness = await createRealtimeHandlerHarness({
            profile,
            openAiLiveVoiceSessionFactory: async () => {
                providerCalls++;
                return new StubOpenAiLiveVoiceSession();
            },
            openRouterVoiceService: {
                async transcribe() {
                    providerCalls++;
                    return { text: '' };
                },
                async synthesize() {
                    providerCalls++;
                    return { audio: Buffer.from([0, 0]) };
                },
            },
        });
        let ws: WebSocket | undefined;
        try {
            ws = await harness.connect();
            const start = {
                type: 'session.start',
                mode,
                initiatorId: 'user-1',
                context: {
                    participants: [
                        { id: 'user-1', displayName: 'Alice', isBot: false },
                    ],
                },
            };
            ws.send(JSON.stringify(start));
            const error = await waitForJsonMessage(ws);
            assert.equal(error.code, 'voice_persona_unavailable');
            assert.doesNotMatch(JSON.stringify(error), /PRIVATE_MISSING_PATH/);
            assert.equal(providerCalls, 0);
            profile.id = 'footnote';
            profile.promptOverlay.path = null;
            ws.send(JSON.stringify(start));
            assert.equal((await waitForJsonMessage(ws)).type, 'session.ready');
            ws.send(JSON.stringify({ type: 'session.close' }));
        } finally {
            if (ws) await closeWebSocket(ws);
            await harness.close();
        }
    });
}

test('Live closes when audio comes from anyone except the consenting initiator', async () => {
    const stubLiveSession = new StubOpenAiLiveVoiceSession();
    const harness = await createRealtimeHandlerHarness({
        openAiLiveVoiceSessionFactory: async () => stubLiveSession,
        workflowRunner: {
            async runRealtimeConversation() {
                return {};
            },
        },
    });
    let ws: WebSocket | undefined;
    try {
        ws = await harness.connect();
        ws.send(
            JSON.stringify({
                type: 'session.start',
                mode: 'live',
                initiatorId: 'user-1',
                context: {
                    participants: [
                        { id: 'user-1', displayName: 'Alice', isBot: false },
                    ],
                },
            })
        );
        await waitForJsonMessage(ws, 1000);
        const errorMessage = waitForJsonMessage(ws, 1000);
        ws.send(
            JSON.stringify({
                type: 'input_audio.append',
                audioBase64: Buffer.from([0, 0]).toString('base64'),
                speakerLabel: 'Bob',
                speakerId: 'user-2',
            })
        );
        const received = await errorMessage;
        assert.ok(
            (received.type === 'error' &&
                received.code === 'unknown_speaker') ||
                (received.type === 'session.closed' &&
                    received.reason === 'unknown_speaker'),
            JSON.stringify(received)
        );
        assert.deepEqual(stubLiveSession.audio, []);
        assert.equal(stubLiveSession.closed, true);
        await closeWebSocket(ws);
    } finally {
        if (ws) await closeWebSocket(ws);
        await harness.close();
    }
});

test('an unconfigured caller cannot request the extended voice duration', async () => {
    const harness = await createRealtimeHandlerHarness({
        developerUserId: 'developer-1',
    });
    let ws: WebSocket | undefined;
    try {
        ws = await harness.connect();
        ws.send(
            JSON.stringify({
                type: 'session.start',
                mode: 'live',
                initiatorId: 'user-1',
                requestExtendedDuration: true,
                context: {
                    participants: [
                        { id: 'user-1', displayName: 'Alice', isBot: false },
                    ],
                },
            })
        );
        assert.deepEqual(await waitForJsonMessage(ws, 1000), {
            type: 'error',
            message:
                'Only the configured developer can request the extended call limit.',
            code: 'duration_override_unauthorized',
        });
        assert.equal(harness.legacySessionCreations(), 0);
    } finally {
        if (ws) await closeWebSocket(ws);
        await harness.close();
    }
});

test('the configured developer can use a five-minute Live call limit', async () => {
    const clock = createFakeClock();
    const harness = await createRealtimeHandlerHarness({
        developerUserId: 'user-1',
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
    });
    let ws: WebSocket | undefined;
    try {
        ws = await harness.connect();
        ws.send(
            JSON.stringify({
                type: 'session.start',
                mode: 'live',
                initiatorId: 'user-1',
                requestExtendedDuration: true,
                context: {
                    participants: [
                        { id: 'user-1', displayName: 'Alice', isBot: false },
                    ],
                },
            })
        );
        const session = await waitForLiveSession(harness);
        await waitForJsonMessage(ws, 1000);
        clock.tick(60_000);
        assert.equal(session.closed, false);
        const closed = waitForJsonMessage(ws, 1000);
        clock.tick(239_999);
        assert.equal(session.closed, false);
        clock.tick(1);
        assert.deepEqual(await closed, {
            type: 'session.closed',
            reason: 'call_limit_exceeded',
        });
        assert.equal(session.closed, true);
    } finally {
        if (ws) await closeWebSocket(ws);
        await harness.close();
    }
});
