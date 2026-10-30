/**
 * @description: Verifies voice execution restrictions and persistence through the real chat Workflow.
 * @footnote-scope: test
 * @footnote-module: RealtimeWorkflowOrchestratorTests
 * @footnote-risk: high - Planner bypass or persistence mistakes can execute unauthorized work or retain voice content.
 * @footnote-ethics: high - Synthetic providers exercise consent-scoped content without paid calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { GenerationRuntime } from '@footnote/agent-runtime';
import type { ResponseMetadata } from '@footnote/contracts/policy';
import { createChatOrchestrator } from '../src/services/chatOrchestrator.js';
import { RealtimeConversationState } from '../src/services/realtimeConversationState.js';
import { buildResponseMetadata } from '../src/services/responseMetadata.js';
import { runtimeConfig } from '../src/config.js';
import { Writable } from 'node:stream';
import { transports } from 'winston';
import { logger } from '../src/utils/logger.js';
import type { WeatherForecastTool } from '../src/services/contextIntegrations/weather/index.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SqliteTraceStore } from '../src/storage/traces/sqliteTraceStore.js';
import { storeTrace } from '../src/services/traceStore.js';
import { ResponseMetadataSchema } from '@footnote/contracts/web/schemas';

test.beforeEach((t) => {
    if (!('mock' in t)) throw new Error('Test context is required.');
    t.mock.method(globalThis, 'fetch', async () => {
        throw new Error('Unexpected network access in synthetic test');
    });
});

const snapshot = (content = 'VOICE_SECRET') => {
    const state = new RealtimeConversationState('private-call');
    state.setAudience([
        { id: 'human', displayName: 'Private Name', processingConsent: true },
    ]);
    state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'human',
        content,
        intent: 'question',
    });
    return state.snapshot();
};
const answerPlan = (generation: object = {}) => ({
    action: 'message',
    modality: 'text',
    requestedCapabilityProfile: 'balanced-general',
    safetyTier: 'Low',
    reasoning: 'VOICE_SECRET',
    generation: {
        temperament: {
            tightness: 3,
            rationale: 3,
            attribution: 3,
            caution: 3,
            extent: 3,
        },
        ...generation,
    },
});

test('voice denies planner terminal actions before execution and retains canonical evidence only', async () => {
    for (const action of ['react', 'image', 'ignore']) {
        let calls = 0;
        let stored: ResponseMetadata | undefined;
        const runtime: GenerationRuntime = {
            kind: 'synthetic',
            generate: async (request) => {
                calls += 1;
                return {
                    text: JSON.stringify({
                        action,
                        modality: 'text',
                        safetyTier: 'Low',
                        reasoning: 'VOICE_SECRET',
                        ...(action === 'react' ? { reaction: '👍' } : {}),
                        ...(action === 'image'
                            ? { imageRequest: { prompt: 'VOICE_SECRET' } }
                            : {}),
                        generation: {},
                    }),
                    model: request.model,
                };
            },
        };
        const orchestrator = createChatOrchestrator({
            generationRuntime: runtime,
            storeTrace: async (metadata, candidates, publication, debug) => {
                stored = metadata;
                assert.equal(candidates, undefined);
                assert.equal(publication, undefined);
                assert.equal(debug, undefined);
            },
            buildResponseMetadata,
            defaultModel: 'gpt-5-mini',
            recordUsage: () => undefined,
        });
        const result = await orchestrator.runRealtimeConversation(snapshot(), {
            signal: new AbortController().signal,
            onRunStarted: () => undefined,
        });
        assert.equal(result.status, 'rejected');
        assert.equal(calls, 1);
        assert.ok(stored?.workflow?.runId);
        assert.equal(result.runId, stored.workflow.runId);
        assert.equal(result.responseId, stored.responseId);
        assert.equal(JSON.stringify(stored).includes('VOICE_SECRET'), false);
        assert.equal(JSON.stringify(result).includes('VOICE_SECRET'), false);
    }
});

test('allowlisted weather clarification still records content-free canonical execution', async () => {
    let tools = 0;
    let calls = 0;
    let stored: ResponseMetadata | undefined;
    const weatherForecastTool: WeatherForecastTool = {
        fetchForecast: async (request) => {
            tools += 1;
            return {
                toolName: 'weather_forecast',
                status: 'needs_clarification',
                request,
                clarification: {
                    reasonCode: 'ambiguous_location',
                    question: 'VOICE_SECRET',
                    options: [],
                },
                provenance: {
                    provider: 'open-meteo',
                    endpoint: 'https://example.test',
                    citationUrl: 'https://example.test',
                    citationLabel: 'VOICE_SECRET',
                    requestedAt: new Date().toISOString(),
                },
            };
        },
    };
    const orchestrator = createChatOrchestrator({
        generationRuntime: {
            kind: 'synthetic',
            generate: async (request) => ({
                model: request.model,
                text:
                    calls++ === 0
                        ? JSON.stringify(
                              answerPlan({
                                  toolIntent: {
                                      toolName: 'weather_forecast',
                                      requested: true,
                                      input: {
                                          location: {
                                              type: 'place_query',
                                              query: 'VOICE_SECRET',
                                          },
                                      },
                                  },
                              })
                          )
                        : 'VOICE_SECRET',
            }),
        },
        weatherForecastTool,
        storeTrace: async (metadata) => {
            stored = metadata;
        },
        buildResponseMetadata,
        defaultModel: 'gpt-5-mini',
        recordUsage: () => undefined,
    });
    const result = await orchestrator.runRealtimeConversation(snapshot(), {
        signal: new AbortController().signal,
        onRunStarted: () => undefined,
    });
    assert.equal(tools, 1);
    assert.ok(result.runId);
    assert.equal(result.responseId, stored?.responseId);
    assert.equal(stored?.workflow?.sessionCorrelationId, 'private-call');
    assert.equal(JSON.stringify(stored).includes('VOICE_SECRET'), false);
});

test('voice provider errors cannot enter persistent logs even with model debug capture enabled', async () => {
    const output: string[] = [];
    const transport = new transports.Stream({
        stream: new Writable({
            write(chunk, _encoding, done) {
                output.push(String(chunk));
                done();
            },
        }),
    });
    logger.add(transport);
    const previous = process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO;
    process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO = 'true';
    try {
        const orchestrator = createChatOrchestrator({
            generationRuntime: {
                kind: 'synthetic',
                generate: async () => {
                    throw new Error('VOICE_SECRET');
                },
            },
            storeTrace: async (metadata, candidates, publication, debug) => {
                assert.equal(
                    JSON.stringify(metadata).includes('VOICE_SECRET'),
                    false
                );
                assert.equal(candidates, undefined);
                assert.equal(publication, undefined);
                assert.equal(debug, undefined);
            },
            buildResponseMetadata,
            defaultModel: 'gpt-5-mini',
            recordUsage: () => {
                throw new Error('VOICE_SECRET');
            },
        });
        await orchestrator.runRealtimeConversation(snapshot(), {
            signal: new AbortController().signal,
            onRunStarted: () => undefined,
        });
        logger.warn('TEXT_LOG_VISIBLE');
        assert.equal(output.join('').includes('VOICE_SECRET'), false);
        assert.equal(output.join('').includes('TEXT_LOG_VISIBLE'), true);
    } finally {
        logger.remove(transport);
        if (previous === undefined)
            delete process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO;
        else process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO = previous;
    }
});

test('planner-requested GitHub context is unavailable at the executor boundary for voice', async (t) => {
    const remote = t.mock.method(
        globalThis,
        'fetch',
        async () => new Response('{}', { status: 404 })
    );
    const originalEnabled =
        runtimeConfig.chatWorkflow.contextIntegrations.github.enabled;
    runtimeConfig.chatWorkflow.contextIntegrations.github.enabled = true;
    let calls = 0;
    let stored: ResponseMetadata | undefined;
    try {
        const orchestrator = createChatOrchestrator({
            generationRuntime: {
                kind: 'synthetic',
                generate: async (request) => ({
                    model: request.model,
                    text:
                        calls++ === 0
                            ? JSON.stringify({
                                  action: 'message',
                                  modality: 'text',
                                  requestedCapabilityProfile:
                                      'balanced-general',
                                  safetyTier: 'Low',
                                  reasoning: 'Look up repository',
                                  generation: {
                                      temperament: {
                                          tightness: 3,
                                          rationale: 3,
                                          attribution: 3,
                                          caution: 3,
                                          extent: 3,
                                      },
                                      githubContext: {
                                          repository: 'footnote-ai/footnote',
                                          sections: ['repository'],
                                      },
                                  },
                              })
                            : 'VOICE_SECRET answer',
                }),
            },
            storeTrace: async (metadata) => {
                stored = metadata;
            },
            buildResponseMetadata,
            defaultModel: 'gpt-5-mini',
            recordUsage: () => undefined,
        });
        await orchestrator.runRealtimeConversation(
            snapshot('VOICE_SECRET Explain footnote-ai/footnote'),
            {
                signal: new AbortController().signal,
                onRunStarted: () => undefined,
            }
        );
        assert.equal(
            stored?.workflow?.steps.find((step) => step.stepKind === 'plan')
                ?.outcome.status,
            'executed'
        );
        assert.equal(remote.mock.callCount(), 0);
        assert.ok(calls > 1);
    } finally {
        runtimeConfig.chatWorkflow.contextIntegrations.github.enabled =
            originalEnabled;
    }
});

test('allowlisted web search cannot escalate its hints into provider-native tool execution', async (t) => {
    const originalProfiles = runtimeConfig.modelProfiles;
    const webSearch = runtimeConfig.chatWorkflow.contextIntegrations.webSearch;
    const originalSearch = { ...webSearch };
    const profile = originalProfiles.catalog.find(
        (candidate) => candidate.provider === 'openai'
    );
    assert.ok(profile);
    const mutable = runtimeConfig as unknown as {
        modelProfiles: typeof originalProfiles;
    };
    mutable.modelProfiles = {
        ...originalProfiles,
        catalog: [{ ...profile, enabled: true }],
        defaultProfileId: profile.id,
        plannerProfileId: profile.id,
    };
    Object.assign(webSearch, {
        enabled: true,
        providerPriority: ['searxng'],
        searxngBaseUrl: 'https://search.example.test',
        openAiNativeSearchFromHintsEnabled: true,
    });
    const remote = t.mock.method(
        globalThis,
        'fetch',
        async () =>
            new Response(
                JSON.stringify({
                    results: [
                        {
                            title: 'VOICE_SECRET SOURCE',
                            url: 'https://example.test',
                            content: 'VOICE_SECRET EVIDENCE',
                        },
                    ],
                }),
                { status: 200 }
            )
    );
    let calls = 0;
    let nativeSearchObserved = false;
    let stored: ResponseMetadata | undefined;
    try {
        const orchestrator = createChatOrchestrator({
            generationRuntime: {
                kind: 'test-runtime',
                generate: async (request) => {
                    if (calls++ === 0)
                        return {
                            model: request.model,
                            text: JSON.stringify(
                                answerPlan({
                                    search: {
                                        query: 'VOICE_SECRET',
                                        intent: 'current_facts',
                                        contextSize: 'low',
                                        topicHints: ['additional'],
                                    },
                                })
                            ),
                        };
                    nativeSearchObserved ||= request.search !== undefined;
                    return {
                        model: request.model,
                        text: 'VOICE_SECRET ANSWER',
                        usage: {
                            promptTokens: 10,
                            completionTokens: 5,
                            totalTokens: 15,
                        },
                    };
                },
            },
            storeTrace: async (metadata, candidates, publication, debug) => {
                stored = metadata;
                assert.equal(candidates, undefined);
                assert.equal(publication, undefined);
                assert.equal(debug, undefined);
            },
            buildResponseMetadata,
            defaultModel: profile.id,
            recordUsage: () => undefined,
        });
        const result = await orchestrator.runRealtimeConversation(snapshot(), {
            signal: new AbortController().signal,
            onRunStarted: () => undefined,
        });
        assert.ok(remote.mock.callCount() > 0);
        assert.ok(calls > 1);
        assert.equal(nativeSearchObserved, false);
        assert.equal(JSON.stringify(stored).includes('VOICE_SECRET'), false);
        assert.ok(result.runId);
        assert.equal(
            stored?.workflow?.steps.some((step) => step.stepKind === 'tool'),
            true
        );
    } finally {
        mutable.modelProfiles = originalProfiles;
        Object.assign(webSearch, originalSearch);
    }
});

test('real storage retains reviewed execution structure while withholding voice bodies and public call identity', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-workflow-'));
    const store = new SqliteTraceStore({ dbPath: path.join(root, 'trace.db') });
    const previousMode = runtimeConfig.chatWorkflow.modeId;
    const previousReview = runtimeConfig.chatWorkflow.reviewLoopEnabled;
    runtimeConfig.chatWorkflow.modeId = 'grounded';
    runtimeConfig.chatWorkflow.reviewLoopEnabled = true;
    const previousDebug = process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO;
    process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO = 'true';
    let calls = 0;
    try {
        const orchestrator = createChatOrchestrator({
            generationRuntime: {
                kind: 'test-runtime',
                generate: async (request) => ({
                    model: request.model,
                    text:
                        calls++ === 0
                            ? JSON.stringify(answerPlan())
                            : JSON.stringify({
                                  reviewDecision: 'finalize',
                                  reviewReason: 'VOICE_SECRET',
                                  traceAlignment: 'aligned',
                              }),
                    usage: {
                        promptTokens: 10,
                        completionTokens: 5,
                        totalTokens: 15,
                    },
                }),
            },
            storeTrace: (metadata, ...rest) => {
                const checked = ResponseMetadataSchema.safeParse(metadata);
                if (!checked.success)
                    assert.fail(JSON.stringify(checked.error.issues));
                return storeTrace(store, metadata, ...rest);
            },
            buildResponseMetadata,
            defaultModel: 'gpt-5-mini',
            recordUsage: () => undefined,
        });
        const accepted = snapshot();
        const result = await orchestrator.runRealtimeConversation(accepted, {
            signal: new AbortController().signal,
            onRunStarted: () => undefined,
        });
        assert.ok(result.responseId);
        const metadata = await store.retrieve(result.responseId);
        assert.ok(metadata?.workflow);
        assert.equal(ResponseMetadataSchema.safeParse(metadata).success, true);
        assert.equal(metadata.workflow.runId, result.runId);
        assert.equal(
            metadata.workflow.initiatingTurnId,
            accepted.intent?.turnId
        );
        assert.equal(
            metadata.workflow.steps.some(
                (step) =>
                    step.stepKind === 'assess' &&
                    step.outcome.signals?.reviewDecision === 'finalize'
            ),
            true
        );
        assert.equal(
            metadata.workflow.steps.some(
                (step) => (step.attempts?.length ?? 0) > 0
            ),
            true
        );
        assert.equal(
            (await store.retrieveResponseCandidates(result.responseId)).length,
            0
        );
        assert.equal(
            (await store.retrieveModelDebugCaptures(result.responseId)).length,
            0
        );
        const publicTrace = await store.retrieveForDisplay(result.responseId);
        assert.equal(publicTrace?.workflow?.sessionCorrelationId, undefined);
        assert.equal(publicTrace?.workflow?.initiatingTurnId, undefined);
        assert.doesNotMatch(
            JSON.stringify([metadata, publicTrace, result]),
            /VOICE_SECRET|Private Name/u
        );
    } finally {
        store.close();
        await fs.rm(root, { recursive: true, force: true });
        runtimeConfig.chatWorkflow.modeId = previousMode;
        runtimeConfig.chatWorkflow.reviewLoopEnabled = previousReview;
        if (previousDebug === undefined)
            delete process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO;
        else process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO = previousDebug;
    }
});

test('a cancelled real Workflow records failed attempts without retrying the aborted provider', async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
        markStarted = resolve;
    });
    const controller = new AbortController();
    let calls = 0;
    let stored: ResponseMetadata | undefined;
    let canonicalRunId: string | undefined;
    let observedSignal: AbortSignal | undefined;
    const orchestrator = createChatOrchestrator({
        generationRuntime: {
            kind: 'test-runtime',
            generate: async (request) => {
                if (calls++ === 0)
                    return {
                        model: request.model,
                        text: JSON.stringify(answerPlan()),
                    };
                markStarted();
                observedSignal = request.signal;
                if (request.signal === undefined)
                    throw new Error('Cancellation signal is missing');
                await new Promise<void>((_resolve, reject) => {
                    const abort = () => reject(controller.signal.reason);
                    if (request.signal?.aborted) abort();
                    else
                        request.signal?.addEventListener('abort', abort, {
                            once: true,
                        });
                });
                throw new Error('Cancelled generation must not finish');
            },
        },
        storeTrace: async (metadata) => {
            stored = metadata;
        },
        buildResponseMetadata,
        defaultModel: 'gpt-5-mini',
        recordUsage: () => undefined,
    });
    const result = orchestrator.runRealtimeConversation(snapshot(), {
        signal: controller.signal,
        onRunStarted: (id) => {
            canonicalRunId = id;
        },
    });
    await started;
    controller.abort();
    const settled = await result;
    assert.equal(observedSignal, controller.signal);
    assert.ok(canonicalRunId);
    assert.equal(settled.runId, canonicalRunId);
    assert.equal(stored?.workflow?.runId, canonicalRunId);
    assert.equal(
        stored?.workflow?.steps.some((step) =>
            step.attempts?.some((attempt) => attempt.status === 'failed')
        ),
        true
    );
    assert.equal(calls, 2);
    assert.doesNotMatch(JSON.stringify([stored, settled]), /VOICE_SECRET/u);
});
