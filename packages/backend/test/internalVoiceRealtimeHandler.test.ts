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

    public close(_reason?: string): void {}

    public emitServerEvent(event: InternalVoiceRealtimeServerEvent): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }
}

type RealtimeHandlerHarness = {
    close: () => Promise<void>;
    connect: (headers?: Record<string, string>) => Promise<WebSocket>;
    lastSession: () => StubRealtimeSession | null;
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
    } = {}
): Promise<RealtimeHandlerHarness> => {
    const requests: RealtimeHandlerHarness['requests'] = [];
    const recordedUsage: BackendLLMCostRecord[] = [];
    const recordedExecutions: RealtimeHandlerHarness['recordedExecutions'] = [];
    let currentSession: StubRealtimeSession | null = null;
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
            setTimeout(poll, 10);
        };
        poll();
    });

const waitForJsonMessage = async (
    ws: WebSocket
): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
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
