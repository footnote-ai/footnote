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
import type {
    InternalVoiceRealtimeServerEvent,
    InternalVoiceSessionContext,
} from '@footnote/contracts/voice';
import type { WorkflowRecord } from '@footnote/contracts/policy';
import { ResponseMetadataSchema } from '@footnote/contracts/web/schemas';
import type { BotProfileConfig } from '../src/config/profile.js';
import type {
    RealtimeVoiceRuntime,
    RealtimeVoiceSession,
} from '@footnote/agent-runtime';
import type { BackendLLMCostRecord } from '../src/services/llmCostRecorder.js';
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
    lastSession: () => StubRealtimeSession | null;
    lastLiveSession: () => StubOpenAiLiveVoiceSession | null;
    recordedUsage: BackendLLMCostRecord[];
    recordedExecutions: Array<{ responseId: string; workflow: WorkflowRecord }>;
    requests: Array<{
        instructions: string;
        context: InternalVoiceSessionContext;
        options?: {
            model?: string;
            voice?: string;
            temperature?: number;
            maxResponseOutputTokens?: number;
        };
    }>;
};

const createRealtimeHandlerHarness = async (
    overrides: {
        profile?: typeof testProfile;
        supportsModel?: (model: string) => boolean;
        supportsVoice?: (voice: string) => boolean;
        recordExecution?: (
            responseId: string,
            workflow: WorkflowRecord
        ) => void;
        setTimer?: typeof setTimeout;
        clearTimer?: typeof clearTimeout;
        openRouterVoiceService?: OpenRouterVoiceService | null;
        workflowRunner?: RealtimeWorkflowRunner | null;
        developerUserId?: string | null;
        defaultMode?: 'standard' | 'live';
        openAiLiveVoiceSessionFactory?: OpenAiLiveVoiceSessionFactory | null;
    } = {}
): Promise<RealtimeHandlerHarness> => {
    const requests: RealtimeHandlerHarness['requests'] = [];
    const recordedUsage: BackendLLMCostRecord[] = [];
    const recordedExecutions: RealtimeHandlerHarness['recordedExecutions'] = [];
    let currentSession: StubRealtimeSession | null = null;
    let currentLiveSession: StubOpenAiLiveVoiceSession | null = null;
    let lastContext: InternalVoiceSessionContext = {
        participants: [],
    };
    const runtime: RealtimeVoiceRuntime = {
        kind: 'stub-realtime-runtime',
        provider: 'openai',
        supportsModel: overrides.supportsModel ?? (() => true),
        supportsVoice: overrides.supportsVoice ?? (() => true),
        async createSession(request) {
            currentSession = new StubRealtimeSession();
            requests.push({
                instructions: request.instructions,
                context: lastContext,
                options: request.options,
            });
            return currentSession;
        },
    };

    const { handleUpgrade } = createInternalVoiceRealtimeHandler({
        realtimeVoiceRuntime: runtime,
        defaultMode: overrides.defaultMode ?? 'live',
        openAiLiveVoiceSessionFactory: overrides.openAiLiveVoiceSessionFactory
            ? async (request) => {
                  const created =
                      await overrides.openAiLiveVoiceSessionFactory!(request);
                  currentLiveSession = created as StubOpenAiLiveVoiceSession;
                  return created;
              }
            : null,
        openRouterVoiceService: overrides.openRouterVoiceService,
        workflowRunner: overrides.workflowRunner,
        developerUserId: overrides.developerUserId,
        profile: overrides.profile ?? testProfile,
        fallbackOptions: { model: 'gpt-realtime-mini', voice: 'echo' },
        traceApiToken: 'trace-token',
        serviceToken: 'service-token',
        serviceRateLimiter: new SimpleRateLimiter({
            limit: 10,
            window: 60000,
        }),
        buildInstructions: (context) => {
            lastContext = context;
            return `participants=${context.participants.length}`;
        },
        recordUsage: (record) => {
            recordedUsage.push(record);
        },
        recordExecution:
            overrides.recordExecution ??
            ((responseId, workflow) => {
                recordedExecutions.push({ responseId, workflow });
            }),
        setTimer: overrides.setTimer,
        clearTimer: overrides.clearTimer,
    });

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
        lastSession: () => currentSession,
        lastLiveSession: () => currentLiveSession,
        recordedUsage,
        recordedExecutions,
        requests,
    };
};

const waitForRealtimeSession = (
    harness: RealtimeHandlerHarness,
    previous?: StubRealtimeSession
): Promise<StubRealtimeSession> =>
    new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const poll = () => {
            const current = harness.lastSession();
            if (current && current !== previous) {
                resolve(current);
                return;
            }
            if (Date.now() - startedAt > 1000) {
                reject(
                    new Error(
                        previous
                            ? 'Second Realtime session was not created.'
                            : 'Realtime session was not created.'
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

test('Realtime call limit starts after provider readiness and closes at 60 seconds', async () => {
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
                context: { participants: [] },
            })
        );
        const session = await waitForRealtimeSession(harness);
        clock.tick(10_000);
        session.emitServerEvent({ type: 'session.ready' });
        await waitForJsonMessage(ws);
        const closedMessage = waitForJsonMessage(ws);
        clock.tick(59_999);
        assert.deepEqual(session.closedReasons, []);

        clock.tick(1);
        assert.deepEqual(session.closedReasons, ['call_limit_exceeded']);
        assert.deepEqual(await closedMessage, {
            type: 'session.closed',
            reason: 'call_limit_exceeded',
        });
        await closeWebSocket(ws);
    } finally {
        if (ws) await closeWebSocket(ws);
        await harness.close();
    }
});

test('Realtime provider setup times out if the session never becomes ready', async () => {
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
                context: { participants: [] },
            })
        );
        const session = await waitForRealtimeSession(harness);
        const notReadyMessage = waitForJsonMessage(ws);
        ws.send(JSON.stringify({ type: 'input_audio.commit' }));
        assert.deepEqual(await notReadyMessage, {
            type: 'error',
            message: 'Realtime provider session is not ready.',
            code: 'session_not_ready',
        });
        const closedMessage = waitForJsonMessage(ws);

        clock.tick(15_000);

        assert.deepEqual(session.closedReasons, ['setup_timeout']);
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

test('only one authenticated Realtime call can hold backend session capacity', async () => {
    const harness = await createRealtimeHandlerHarness();
    let firstSocket: WebSocket | undefined;
    let secondSocket: WebSocket | undefined;

    try {
        firstSocket = await harness.connect();
        firstSocket.send(
            JSON.stringify({
                type: 'session.start',
                context: { participants: [] },
            })
        );
        const firstSession = await waitForRealtimeSession(harness);
        firstSession.emitServerEvent({ type: 'session.ready' });
        await waitForJsonMessage(firstSocket);

        secondSocket = await harness.connect();
        secondSocket.send(
            JSON.stringify({
                type: 'session.start',
                context: { participants: [] },
            })
        );
        assert.deepEqual(await waitForJsonMessage(secondSocket, 100), {
            type: 'error',
            message: 'A voice call is already active.',
            code: 'voice_session_occupied',
        });
        assert.equal(harness.requests.length, 1);

        const firstClosedMessage = waitForJsonMessage(firstSocket);
        firstSocket.send(JSON.stringify({ type: 'session.close' }));
        assert.deepEqual(await firstClosedMessage, {
            type: 'session.closed',
            reason: 'client_close',
        });
        secondSocket.send(
            JSON.stringify({
                type: 'session.start',
                context: { participants: [] },
            })
        );
        const secondSession = await waitForRealtimeSession(
            harness,
            firstSession
        );
        assert.equal(harness.requests.length, 2);
        secondSession.emitServerEvent({ type: 'session.ready' });
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
        realtimeVoiceRuntime: null,
        profile: testProfile,
        fallbackOptions: { model: 'gpt-realtime-mini', voice: 'echo' },
        traceApiToken: 'trace-token',
        serviceToken: 'service-token',
        serviceRateLimiter: new SimpleRateLimiter({ limit: 10, window: 60000 }),
        buildInstructions: () => 'test instructions',
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

test('Realtime records one private canonical Run per response with shared session correlation', async () => {
    const harness = await createRealtimeHandlerHarness();

    let ws: WebSocket | undefined;
    try {
        ws = await harness.connect();
        ws.send(
            JSON.stringify({
                type: 'session.start',
                context: { participants: [] },
            })
        );
        const session = await waitForRealtimeSession(harness);

        session.emitServerEvent({
            type: 'response.started',
            responseId: 'provider-a',
        });
        session.emitServerEvent({
            type: 'response.done',
            responseId: 'provider-a',
            status: 'completed',
            usage: {
                tokensPrompt: 20,
                tokensCompletion: 10,
                model: 'gpt-realtime',
            },
        });
        session.emitServerEvent({
            type: 'response.started',
            responseId: 'provider-b',
        });
        session.emitServerEvent({
            type: 'response.done',
            responseId: 'provider-b',
            status: 'completed',
        });

        assert.equal(harness.recordedExecutions.length, 2);
        const [first, second] = harness.recordedExecutions;
        assert.ok(first && second);
        assert.notEqual(first.workflow.runId, second.workflow.runId);
        assert.equal(first.responseId, first.workflow.runId);
        assert.equal(
            first.workflow.sessionCorrelationId,
            second.workflow.sessionCorrelationId
        );
        assert.equal(first.workflow.steps[0]?.stepKind, 'generate');
        assert.equal(
            first.workflow.steps[0]?.attempts?.[0]?.profileId,
            'winter'
        );
        assert.equal(
            first.workflow.steps[0]?.attempts?.[0]?.actualProvider,
            'openai'
        );
        assert.equal(
            first.workflow.steps[0]?.attempts?.[0]?.actualModel,
            'gpt-realtime'
        );
        assert.equal(
            first.workflow.steps[0]?.attempts?.[0]?.settings?.applied
                ?.effectiveVoice,
            'echo'
        );
        assert.equal(
            first.workflow.steps[0]?.attempts?.[0]?.usage?.promptTokens,
            20
        );
        assert.equal(second.workflow.steps[0]?.attempts?.[0]?.usage, undefined);
        assert.equal(
            second.workflow.steps[0]?.cost?.costCompleteness,
            'unknown'
        );
        assert.equal(second.workflow.steps[0]?.cost?.totalCostUsd, 0);
        assert.equal(
            JSON.stringify(harness.recordedExecutions).includes('output_text'),
            false
        );
        const firstRun = first.workflow;
        const storedMetadata = ResponseMetadataSchema.safeParse({
            responseId: first.responseId,
            provenance: 'Inferred',
            safetyTier: 'Low',
            tradeoffCount: 0,
            chainHash: first.responseId,
            licenseContext: 'MIT + HL3',
            modelVersion: 'gpt-realtime',
            staleAfter: new Date(
                Date.now() + 90 * 24 * 60 * 60 * 1000
            ).toISOString(),
            citations: [],
            workflow: firstRun,
            trace_target: {},
            trace_final: {},
        });
        assert.equal(storedMetadata.success, true);

        session.emitServerEvent({
            type: 'response.started',
            responseId: 'provider-c',
        });
        session.emitServerEvent({
            type: 'response.done',
            responseId: 'provider-c',
            status: 'completed',
            usage: {
                tokensPrompt: 0,
                tokensCompletion: 0,
                model: 'gpt-realtime',
            },
        });
        assert.equal(
            harness.recordedExecutions[2]?.workflow.steps[0]?.cost
                ?.totalCostUsd,
            0
        );
        assert.equal(
            harness.recordedExecutions[2]?.workflow.steps[0]?.cost
                ?.costCompleteness,
            'complete'
        );

        session.emitServerEvent({
            type: 'response.started',
            responseId: 'provider-d',
        });
        session.emitServerEvent({
            type: 'response.done',
            responseId: 'provider-d',
            status: 'cancelled',
            terminationReason: 'client_cancelled',
        });
        const failed = harness.recordedExecutions[3];
        assert.equal(failed?.workflow.runStatus, 'failed');
        assert.equal(failed?.workflow.terminationReason, 'provider_cancelled');

        await closeWebSocket(ws);

        const secondWs = await harness.connect();
        secondWs.send(
            JSON.stringify({
                type: 'session.start',
                context: { participants: [] },
            })
        );
        const secondSession = await waitForRealtimeSession(harness, session);
        secondSession.emitServerEvent({
            type: 'response.started',
            responseId: 'other-session-response',
        });
        secondSession.emitServerEvent({
            type: 'response.done',
            responseId: 'other-session-response',
            status: 'completed',
        });
        assert.notEqual(
            harness.recordedExecutions[0]?.workflow.sessionCorrelationId,
            harness.recordedExecutions[4]?.workflow.sessionCorrelationId
        );
        await closeWebSocket(secondWs);
    } finally {
        await harness.close();
    }
});

test('Realtime records unfinished responses once when the client socket closes', async () => {
    const harness = await createRealtimeHandlerHarness();

    try {
        const ws = await harness.connect();
        ws.send(
            JSON.stringify({
                type: 'session.start',
                context: { participants: [] },
            })
        );
        const session = await waitForRealtimeSession(harness);
        session.emitServerEvent({
            type: 'response.started',
            responseId: 'unfinished-response',
        });

        await closeWebSocket(ws);
        await new Promise((resolve) => setTimeout(resolve, 20));

        assert.equal(harness.recordedExecutions.length, 1);
        assert.equal(
            harness.recordedExecutions[0]?.workflow.runStatus,
            'failed'
        );
        assert.equal(
            harness.recordedExecutions[0]?.workflow.steps[0]?.attempts?.[0]
                ?.terminationReason,
            'client_close'
        );
        session.emitServerEvent({
            type: 'session.closed',
            reason: 'client_close',
        });
        assert.equal(harness.recordedExecutions.length, 1);
    } finally {
        await harness.close();
    }
});

test('Realtime execution-record persistence failure does not block the response', async () => {
    const harness = await createRealtimeHandlerHarness({
        recordExecution: () => {
            throw new Error('test persistence failure');
        },
    });

    try {
        const ws = await harness.connect();
        ws.send(
            JSON.stringify({
                type: 'session.start',
                context: { participants: [] },
            })
        );
        const session = await waitForRealtimeSession(harness);
        const response = waitForJsonMessage(ws);
        session.emitServerEvent({
            type: 'response.started',
            responseId: 'provider-response',
        });
        session.emitServerEvent({
            type: 'response.done',
            responseId: 'provider-response',
            status: 'completed',
        });
        assert.deepEqual(await response, {
            type: 'response.done',
            responseId: 'provider-response',
            status: 'completed',
        });
        await closeWebSocket(ws);
    } finally {
        await harness.close();
    }
});

test('internal realtime handler returns provider_unavailable when runtime is missing', () => {
    const { handleUpgrade } = createInternalVoiceRealtimeHandler({
        realtimeVoiceRuntime: null,
        profile: testProfile,
        fallbackOptions: { model: 'gpt-realtime-mini', voice: 'echo' },
        traceApiToken: 'trace-token',
        serviceToken: null,
        serviceRateLimiter: new SimpleRateLimiter({ limit: 10, window: 60000 }),
        buildInstructions: () => 'test instructions',
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

test('internal realtime handler starts a session and forwards session.ready to the client', async () => {
    const harness = await createRealtimeHandlerHarness();

    try {
        const ws = await harness.connect();
        ws.send(
            JSON.stringify({
                type: 'session.start',
                context: {
                    participants: [
                        {
                            id: 'user-1',
                            displayName: 'Alice',
                        },
                    ],
                },
                options: {
                    model: 'gpt-realtime',
                    voice: 'alloy',
                },
            })
        );

        const session = await waitForRealtimeSession(harness);

        assert.equal(harness.requests.length, 1);
        assert.equal(harness.requests[0].options?.model, 'gpt-realtime');
        assert.equal(harness.requests[0].options?.voice, 'alloy');
        assert.equal(
            harness.requests[0].instructions,
            'participants=1\n\nSpeech delivery guidance: dry and direct'
        );
        assert.deepEqual(harness.requests[0].context.participants, [
            {
                id: 'user-1',
                displayName: 'Alice',
            },
        ]);

        session.emitServerEvent({ type: 'session.ready' });
        const readyMessage = await waitForJsonMessage(ws);
        assert.deepEqual(readyMessage, {
            type: 'session.ready',
            mode: 'live',
            speechSelection: {
                profileId: 'winter',
                modality: 'realtime',
                provider: 'openai',
                model: 'gpt-realtime',
                voice: 'alloy',
                delivery: 'dry and direct',
                requestedVoice: 'alloy',
                selectionSource: {
                    model: 'request_or_session',
                    voice: 'request_or_session',
                    delivery: 'operator_profile',
                },
                fallbackReason: null,
            },
        });

        const completeUsageResponse = waitForJsonMessage(ws);
        session.emitServerEvent({
            type: 'response.done',
            responseId: 'resp_123',
            usage: {
                tokensPrompt: 50,
                tokensCompletion: 25,
                model: 'gpt-realtime',
            },
        });
        assert.deepEqual(await completeUsageResponse, {
            type: 'response.done',
            responseId: 'resp_123',
            usage: {
                tokensPrompt: 50,
                tokensCompletion: 25,
                model: 'gpt-realtime',
            },
        });

        assert.equal(harness.recordedUsage.length, 1);
        assert.equal(harness.recordedUsage[0].feature, 'voice_realtime');
        assert.equal(harness.recordedUsage[0].model, 'gpt-realtime');
        assert.equal(harness.recordedUsage[0].promptTokens, 50);
        assert.equal(harness.recordedUsage[0].completionTokens, 25);

        const incompleteUsageResponse = waitForJsonMessage(ws);
        session.emitServerEvent({
            type: 'response.done',
            responseId: 'resp_missing_output_usage',
            usage: {
                tokensPrompt: 0,
                model: 'gpt-realtime',
            },
        });

        assert.deepEqual(await incompleteUsageResponse, {
            type: 'response.done',
            responseId: 'resp_missing_output_usage',
            usage: {
                tokensPrompt: 0,
                model: 'gpt-realtime',
            },
        });
        assert.equal(harness.recordedUsage.length, 1);

        const unavailableUsageResponse = waitForJsonMessage(ws);
        session.emitServerEvent({
            type: 'response.done',
            responseId: 'resp_usage_unavailable',
        });

        assert.deepEqual(await unavailableUsageResponse, {
            type: 'response.done',
            responseId: 'resp_usage_unavailable',
        });
        assert.equal(harness.recordedUsage.length, 1);

        const zeroUsageResponse = waitForJsonMessage(ws);
        session.emitServerEvent({
            type: 'response.done',
            responseId: 'resp_reported_zero_usage',
            usage: {
                tokensPrompt: 0,
                tokensCompletion: 0,
                model: 'gpt-realtime',
            },
        });

        assert.deepEqual(await zeroUsageResponse, {
            type: 'response.done',
            responseId: 'resp_reported_zero_usage',
            usage: {
                tokensPrompt: 0,
                tokensCompletion: 0,
                model: 'gpt-realtime',
            },
        });
        assert.equal(harness.recordedUsage.length, 2);
        assert.equal(harness.recordedUsage[1].promptTokens, 0);
        assert.equal(harness.recordedUsage[1].completionTokens, 0);

        await closeWebSocket(ws);
    } finally {
        await harness.close();
    }
});

test('Realtime falls back only the unsupported profile model and keeps an explicit voice', async () => {
    const harness = await createRealtimeHandlerHarness({
        profile: {
            ...testProfile,
            speechPresentation: {
                ...testProfile.speechPresentation,
                realtimeModel: 'unsupported-model',
            },
        },
        supportsModel: (model) => model === 'gpt-realtime-mini',
    });

    try {
        const ws = await harness.connect();
        ws.send(
            JSON.stringify({
                type: 'session.start',
                context: { participants: [] },
                options: { voice: 'alloy' },
            })
        );

        const session = await waitForRealtimeSession(harness);

        assert.equal(harness.requests[0].options?.model, 'gpt-realtime-mini');
        assert.equal(harness.requests[0].options?.voice, 'alloy');
        session.emitServerEvent({ type: 'session.ready' });
        const readyMessage = await waitForJsonMessage(ws);
        const metadata = readyMessage.speechSelection as Record<
            string,
            unknown
        >;
        assert.equal(metadata.model, 'gpt-realtime-mini');
        assert.equal(metadata.voice, 'alloy');
        assert.equal(
            metadata.fallbackReason,
            'Configured profile model is unsupported; using deployment fallback for that setting.'
        );
        await closeWebSocket(ws);
    } finally {
        await harness.close();
    }
});

test('Standard transcribes one attributed utterance and synthesizes only the approved Workflow answer', async () => {
    const inputAudio = Buffer.from([0, 0, 1, 0]);
    const synthesized: string[] = [];
    const snapshots: string[] = [];
    const harness = await createRealtimeHandlerHarness({
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
        assert.doesNotMatch(
            JSON.stringify(harness.recordedExecutions),
            /What is the answer\?/
        );
        ws.send(JSON.stringify({ type: 'session.close' }));
        await closeWebSocket(ws);
    } finally {
        if (ws) await closeWebSocket(ws);
        await harness.close();
    }
});

test('Live streams only caller audio, delegates the caller transcript, and returns the approved Workflow answer as commentary', async () => {
    const inputAudio = Buffer.from([0, 0, 1, 0]);
    const snapshots: string[] = [];
    const stubLiveSession = new StubOpenAiLiveVoiceSession();
    let startRequest: { instructions: string; voice: string } | undefined;
    const harness = await createRealtimeHandlerHarness({
        openAiLiveVoiceSessionFactory: async (request) => {
            startRequest = request;
            return stubLiveSession;
        },
        workflowRunner: {
            async runRealtimeConversation(snapshot, context) {
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
                        text: 'The reviewed Live answer.',
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
                text: 'The reviewed Live answer.',
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
        assert.equal(harness.requests.length, 0);
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
        const session = await waitForRealtimeSession(harness);
        session.emitServerEvent({ type: 'session.ready' });
        await waitForJsonMessage(ws, 1000);
        clock.tick(60_000);
        assert.deepEqual(session.closedReasons, []);
        const closed = waitForJsonMessage(ws, 1000);
        clock.tick(239_999);
        assert.deepEqual(session.closedReasons, []);
        clock.tick(1);
        assert.deepEqual(session.closedReasons, ['call_limit_exceeded']);
        assert.deepEqual(await closed, {
            type: 'session.closed',
            reason: 'call_limit_exceeded',
        });
    } finally {
        if (ws) await closeWebSocket(ws);
        await harness.close();
    }
});
