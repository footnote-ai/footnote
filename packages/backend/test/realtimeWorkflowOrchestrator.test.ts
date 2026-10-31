/**
 * @description: Verifies voice execution restrictions and persistence through the real chat Workflow.
 * @footnote-scope: test
 * @footnote-module: RealtimeWorkflowOrchestratorTests
 * @footnote-risk: high - Planner bypass or persistence mistakes can execute unauthorized work or retain voice content.
 * @footnote-ethics: high - Synthetic providers exercise consent-scoped content without paid calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createEphemeralOpenRouterRuntime,
    type GenerationRuntime,
} from '@footnote/agent-runtime';
import { createBoundedOllamaGenerationRuntime } from '../src/services/boundedOllamaRuntime.js';
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

test('the qualified HTTP route runs planning, generation and assessment with a persisted private receipt', async (t) => {
    const previousProfiles = runtimeConfig.modelProfiles;
    const previousMode = runtimeConfig.chatWorkflow.modeId;
    const previousReview = runtimeConfig.chatWorkflow.reviewLoopEnabled;
    const previousDebug = process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO;
    const original = previousProfiles.catalog.find(
        (entry) => entry.provider === 'openai'
    );
    assert.ok(original);
    const profile = {
        ...original,
        id: 'voice-qualified-test',
        enabled: true,
        provider: 'openrouter' as const,
        providerModel: 'openai/gpt-5-mini',
        providerRouting: undefined,
    };
    const mutable = runtimeConfig as unknown as {
        modelProfiles: typeof previousProfiles;
    };
    mutable.modelProfiles = {
        ...previousProfiles,
        catalog: [profile],
        defaultProfileId: profile.id,
        plannerProfileId: profile.id,
    };
    runtimeConfig.chatWorkflow.modeId = 'grounded';
    runtimeConfig.chatWorkflow.reviewLoopEnabled = true;
    process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO = 'true';
    const root = await fs.mkdtemp(
        path.join(os.tmpdir(), 'voice-private-http-')
    );
    const store = new SqliteTraceStore({ dbPath: path.join(root, 'trace.db') });
    const requests: Record<string, unknown>[] = [];
    let disallowed = false;
    t.mock.method(
        globalThis,
        'fetch',
        async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
            assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
            const body = JSON.parse(String(init.body)) as Record<
                string,
                unknown
            >;
            requests.push(body);
            assert.equal(body.model, 'openai/gpt-5-mini');
            assert.equal(body.tools, undefined);
            const text = disallowed
                ? JSON.stringify({
                      ...answerPlan(),
                      action: 'react',
                      reaction: '👍',
                  })
                : [
                      JSON.stringify(answerPlan()),
                      'PRIVATE APPROVED ANSWER',
                      JSON.stringify({
                          reviewDecision: 'finalize',
                          reviewReason: 'PRIVATE REVIEW',
                      }),
                  ][requests.length - 1];
            assert.ok(text);
            return Response.json({
                model: 'openai/gpt-5-mini',
                openrouter_metadata: {
                    endpoints: {
                        available: [
                            {
                                selected: true,
                                provider: 'PRIVATE ATTRIBUTION',
                                model: 'PRIVATE ATTRIBUTION',
                            },
                        ],
                    },
                },
                choices: [
                    { message: { content: text }, finish_reason: 'stop' },
                ],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15,
                },
            });
        }
    );
    try {
        const orchestrator = createChatOrchestrator({
            generationRuntime: createBoundedOllamaGenerationRuntime({
                runtime: createEphemeralOpenRouterRuntime({
                    apiKey: 'synthetic-key',
                }),
                enabled: false,
                maxConcurrentGenerations: 1,
                maxQueuedGenerations: 0,
                logger,
            }),
            storeTrace: (metadata, ...rest) =>
                storeTrace(store, metadata, ...rest),
            buildResponseMetadata,
            defaultModel: profile.id,
            recordUsage: () => undefined,
        });
        const accepted = snapshot();
        const result = await orchestrator.runRealtimeConversation(accepted, {
            signal: new AbortController().signal,
            onRunStarted: () => undefined,
        });
        assert.equal(requests.length, 3);
        assert.ok(requests[0].response_format);
        assert.ok(requests[2].response_format);
        assert.equal(result.finalResponse?.disposition, 'approved');
        assert.ok(result.finalResponse?.disposition === 'approved');
        assert.equal(result.finalResponse.text, 'PRIVATE APPROVED ANSWER');
        assert.ok(result.responseId);
        const metadata = await store.retrieve(result.responseId);
        assert.equal(metadata?.workflow?.runId, result.runId);
        assert.equal(
            metadata?.workflow?.initiatingTurnId,
            accepted.intent?.turnId
        );
        assert.equal(metadata?.workflow?.runStatus, 'completed');
        assert.equal(
            (await store.retrieveResponseCandidates(result.responseId)).length,
            0
        );
        assert.equal(
            (await store.retrieveModelDebugCaptures(result.responseId)).length,
            0
        );
        assert.doesNotMatch(JSON.stringify(metadata), /PRIVATE|VOICE_SECRET/);
        disallowed = true;
        requests.length = 0;
        const rejected = await orchestrator.runRealtimeConversation(
            snapshot(),
            {
                signal: new AbortController().signal,
                onRunStarted: () => undefined,
            }
        );
        assert.equal(requests.length, 1);
        assert.equal(rejected.status, 'rejected');
        assert.notEqual(rejected.finalResponse?.disposition, 'approved');
        const instrumentation = globalThis.AI_SDK_TELEMETRY_INTEGRATIONS;
        try {
            globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = [
                {
                    onStart: () =>
                        assert.fail('No telemetry may receive content'),
                },
            ];
            requests.length = 0;
            const denied = await orchestrator.runRealtimeConversation(
                snapshot(),
                {
                    signal: new AbortController().signal,
                    onRunStarted: () => undefined,
                }
            );
            assert.equal(requests.length, 0);
            assert.ok(denied.responseId);
            const deniedMetadata = await store.retrieve(denied.responseId);
            const routes =
                deniedMetadata?.workflow?.steps.flatMap(
                    (step) =>
                        step.attempts?.flatMap(
                            (attempt) => attempt.routingAttempts ?? []
                        ) ?? []
                ) ?? [];
            assert.ok(routes.length > 0);
            assert.ok(
                routes.every(
                    (route) => route.providerCallStatus === 'not_called'
                )
            );
            assert.doesNotMatch(
                JSON.stringify(deniedMetadata),
                /PRIVATE|VOICE_SECRET/
            );
        } finally {
            globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = instrumentation;
        }
    } finally {
        store.close();
        await fs.rm(root, { recursive: true, force: true });
        mutable.modelProfiles = previousProfiles;
        runtimeConfig.chatWorkflow.modeId = previousMode;
        runtimeConfig.chatWorkflow.reviewLoopEnabled = previousReview;
        if (previousDebug === undefined)
            delete process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO;
        else process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO = previousDebug;
    }
});

test('voice structured planning cannot bypass the qualified runtime through direct OpenAI', async (t) => {
    const profiles = runtimeConfig.modelProfiles;
    const openai = { ...runtimeConfig.openai };
    const mode = runtimeConfig.chatWorkflow.modeId;
    const review = runtimeConfig.chatWorkflow.reviewLoopEnabled;
    const profile = profiles.catalog.find(
        (entry) => entry.provider === 'openai'
    );
    assert.ok(profile);
    const mutable = runtimeConfig as unknown as {
        modelProfiles: typeof profiles;
    };
    mutable.modelProfiles = {
        ...profiles,
        catalog: [{ ...profile, enabled: true }],
        defaultProfileId: profile.id,
        plannerProfileId: profile.id,
    };
    Object.assign(runtimeConfig.openai, {
        apiKey: 'synthetic-key',
        plannerStructuredOutputEnabled: true,
    });
    runtimeConfig.chatWorkflow.modeId = 'grounded';
    runtimeConfig.chatWorkflow.reviewLoopEnabled = true;
    const remote = t.mock.method(globalThis, 'fetch', async () => {
        throw new Error('Unqualified direct transport');
    });
    const requests: Parameters<GenerationRuntime['generate']>[0][] = [];
    try {
        const orchestrator = createChatOrchestrator({
            generationRuntime: {
                kind: 'qualified-synthetic',
                supportsEphemeralContent: true,
                generate: async (request) => {
                    requests.push(request);
                    return {
                        text:
                            [
                                JSON.stringify(answerPlan()),
                                'Reviewed answer.',
                                JSON.stringify({
                                    reviewDecision: 'finalize',
                                    reviewReason: 'Ready.',
                                }),
                            ][requests.length - 1] ?? '',
                        model: request.model,
                    };
                },
            },
            storeTrace: async () => undefined,
            buildResponseMetadata,
            defaultModel: profile.id,
            recordUsage: () => undefined,
        });
        const result = await orchestrator.runRealtimeConversation(snapshot(), {
            signal: new AbortController().signal,
            onRunStarted: () => undefined,
        });
        assert.equal(remote.mock.callCount(), 0);
        assert.ok(requests[0]?.structuredOutput);
        assert.equal(result.finalResponse?.disposition, 'approved');
    } finally {
        mutable.modelProfiles = profiles;
        Object.assign(runtimeConfig.openai, openai);
        runtimeConfig.chatWorkflow.modeId = mode;
        runtimeConfig.chatWorkflow.reviewLoopEnabled = review;
    }
});

test('a failed voice generation cannot silently retry through planner or response fallback', async () => {
    let attempts = 0;
    const orchestrator = createChatOrchestrator({
        generationRuntime: {
            kind: 'qualified-synthetic',
            supportsEphemeralContent: true,
            generate: async () => {
                attempts += 1;
                throw new Error('Qualified transport unavailable');
            },
        },
        storeTrace: async () => undefined,
        buildResponseMetadata,
        defaultModel: 'gpt-5-mini',
        recordUsage: () => undefined,
    });
    const result = await orchestrator.runRealtimeConversation(snapshot(), {
        signal: new AbortController().signal,
        onRunStarted: () => undefined,
    });
    assert.equal(attempts, 1);
    assert.notEqual(result.finalResponse?.disposition, 'approved');
});

test('a policy-invalid structured plan cannot downgrade or trigger response fallback in voice', async () => {
    let attempts = 0;
    const orchestrator = createChatOrchestrator({
        generationRuntime: {
            kind: 'qualified-synthetic',
            supportsEphemeralContent: true,
            generate: async () => {
                attempts += 1;
                return {
                    text: JSON.stringify({
                        action: 'unknown-action',
                        PRIVATE_FIELD: 'PRIVATE INPUT',
                    }),
                };
            },
        },
        storeTrace: async () => undefined,
        buildResponseMetadata,
        defaultModel: 'gpt-5-mini',
        recordUsage: () => undefined,
    });
    const result = await orchestrator.runRealtimeConversation(snapshot(), {
        signal: new AbortController().signal,
        onRunStarted: () => undefined,
    });
    assert.equal(attempts, 1);
    assert.notEqual(result.finalResponse?.disposition, 'approved');
});

test('only the selected, assessed final answer is returned for voice staging', async () => {
    const previousMode = runtimeConfig.chatWorkflow.modeId;
    const previousReview = runtimeConfig.chatWorkflow.reviewLoopEnabled;
    runtimeConfig.chatWorkflow.modeId = 'grounded';
    runtimeConfig.chatWorkflow.reviewLoopEnabled = true;
    let calls = 0;
    let stored: ResponseMetadata | undefined;
    try {
        const orchestrator = createChatOrchestrator({
            generationRuntime: {
                kind: 'synthetic',
                supportsEphemeralContent: true,
                generate: async (request) => ({
                    model: request.model,
                    text:
                        [
                            JSON.stringify(answerPlan()),
                            'The reviewed answer.',
                            JSON.stringify({
                                reviewDecision: 'finalize',
                                reviewReason: 'Sufficient evidence.',
                            }),
                        ][calls++] ?? '',
                }),
            },
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
        assert.ok(result.finalResponse?.disposition === 'approved');
        assert.equal(result.finalResponse?.text, 'The reviewed answer.');
        assert.equal(result.finalResponse?.responseId, stored?.responseId);
        assert.doesNotMatch(JSON.stringify(stored), /The reviewed answer/);
    } finally {
        runtimeConfig.chatWorkflow.modeId = previousMode;
        runtimeConfig.chatWorkflow.reviewLoopEnabled = previousReview;
    }
});

test('an apparently final assessment cannot approve a missing Result or a different draft', async () => {
    const previousMode = runtimeConfig.chatWorkflow.modeId;
    const previousReview = runtimeConfig.chatWorkflow.reviewLoopEnabled;
    runtimeConfig.chatWorkflow.modeId = 'grounded';
    runtimeConfig.chatWorkflow.reviewLoopEnabled = true;
    try {
        for (const missing of [
            'review_result',
            'draft_reference',
            'candidate_link',
            'run_status',
        ] as const) {
            let calls = 0;
            const orchestrator = createChatOrchestrator({
                generationRuntime: {
                    kind: 'synthetic',
                    supportsEphemeralContent: true,
                    generate: async (request) => ({
                        model: request.model,
                        text:
                            [
                                JSON.stringify(answerPlan()),
                                'The answer.',
                                JSON.stringify({
                                    reviewDecision: 'finalize',
                                    reviewReason: 'Ready.',
                                }),
                            ][calls++] ?? '',
                    }),
                },
                storeTrace: async () => undefined,
                buildResponseMetadata: (...args) => {
                    const metadata = buildResponseMetadata(...args);
                    const workflow = metadata.workflow;
                    assert.ok(workflow);
                    if (missing === 'review_result')
                        workflow.results = workflow.results?.filter(
                            (result) => result.name !== 'review'
                        );
                    if (missing === 'run_status') delete workflow.runStatus;
                    for (const step of workflow.steps) {
                        if (
                            missing === 'draft_reference' &&
                            step.stepKind === 'assess'
                        )
                            step.inputRefs = [
                                { name: 'draft', resultId: 'other-draft' },
                            ];
                        if (
                            missing === 'candidate_link' &&
                            step.stepKind === 'generate'
                        )
                            delete step.outcome.artifacts;
                    }
                    return metadata;
                },
                defaultModel: 'gpt-5-mini',
                recordUsage: () => undefined,
            });
            const result = await orchestrator.runRealtimeConversation(
                snapshot(),
                {
                    signal: new AbortController().signal,
                    onRunStarted: () => undefined,
                }
            );
            assert.notEqual(
                result.finalResponse?.disposition,
                'approved',
                missing
            );
            assert.equal('text' in (result.finalResponse ?? {}), false);
        }
    } finally {
        runtimeConfig.chatWorkflow.modeId = previousMode;
        runtimeConfig.chatWorkflow.reviewLoopEnabled = previousReview;
    }
});

test('revision becomes speakable only when its own selected draft is finalized', async () => {
    const previousMode = runtimeConfig.chatWorkflow.modeId;
    const previousReview = runtimeConfig.chatWorkflow.reviewLoopEnabled;
    runtimeConfig.chatWorkflow.modeId = 'grounded';
    runtimeConfig.chatWorkflow.reviewLoopEnabled = true;
    let calls = 0;
    let stored: ResponseMetadata | undefined;
    try {
        const outputs = [
            JSON.stringify(answerPlan()),
            'First draft.',
            JSON.stringify({
                reviewDecision: 'revise',
                reviewReason: 'Overstates certainty.',
                revisionInstruction: 'State the limit.',
            }),
            JSON.stringify(answerPlan()),
            'Revised answer with its limit.',
            JSON.stringify({
                reviewDecision: 'finalize',
                reviewReason: 'Ready.',
            }),
        ];
        const orchestrator = createChatOrchestrator({
            generationRuntime: {
                kind: 'synthetic',
                supportsEphemeralContent: true,
                generate: async (request) => ({
                    model: request.model,
                    text: outputs[calls++] ?? '',
                }),
            },
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
        assert.ok(
            result.finalResponse?.disposition === 'approved',
            JSON.stringify(result)
        );
        assert.equal(
            result.finalResponse.text,
            'Revised answer with its limit.'
        );
        const finalResponse = result.finalResponse;
        const assessment = stored?.workflow?.steps.find(
            (step) => step.stepId === finalResponse.assessmentStepId
        );
        assert.equal(
            assessment?.parentStepId,
            result.finalResponse.generationStepId
        );
    } finally {
        runtimeConfig.chatWorkflow.modeId = previousMode;
        runtimeConfig.chatWorkflow.reviewLoopEnabled = previousReview;
    }
});

test('delivery waits for persistence and cannot survive a failed write or cancellation during the write', async () => {
    const previousMode = runtimeConfig.chatWorkflow.modeId;
    const previousReview = runtimeConfig.chatWorkflow.reviewLoopEnabled;
    runtimeConfig.chatWorkflow.modeId = 'grounded';
    runtimeConfig.chatWorkflow.reviewLoopEnabled = true;
    try {
        for (const outcome of ['written', 'failed', 'cancelled'] as const) {
            let writeStarted!: () => void;
            const writing = new Promise<void>((resolve) => {
                writeStarted = resolve;
            });
            let finishWrite!: () => void;
            let failWrite!: (error: Error) => void;
            const persisted = new Promise<void>((resolve, reject) => {
                finishWrite = resolve;
                failWrite = reject;
            });
            let calls = 0;
            const state = new RealtimeConversationState('private-call');
            state.setAudience([
                { id: 'human', displayName: 'Human', processingConsent: true },
            ]);
            const turn = state.appendFinalizedTurn({
                role: 'user',
                speakerId: 'human',
                content: 'Question',
                intent: 'question',
            });
            const orchestrator = createChatOrchestrator({
                generationRuntime: {
                    kind: 'synthetic',
                    supportsEphemeralContent: true,
                    generate: async (request) => ({
                        model: request.model,
                        text:
                            [
                                JSON.stringify(answerPlan()),
                                'Reviewed answer.',
                                JSON.stringify({
                                    reviewDecision: 'finalize',
                                    reviewReason: 'Ready.',
                                }),
                            ][calls++] ?? '',
                    }),
                },
                storeTrace: async () => {
                    writeStarted();
                    await persisted;
                },
                buildResponseMetadata,
                defaultModel: 'gpt-5-mini',
                recordUsage: () => undefined,
            });
            state.startExecution(orchestrator);
            await writing;
            assert.equal(state.requestDelivery(turn.handle), undefined);
            if (outcome === 'cancelled')
                state.appendFinalizedTurn({
                    role: 'user',
                    speakerId: 'human',
                    content: 'Stop',
                    intent: 'cancel',
                });
            if (outcome === 'failed') failWrite(new Error('write failed'));
            else finishWrite();
            await new Promise<void>((resolve) => setImmediate(resolve));
            const request = state.requestDelivery(turn.handle);
            assert.equal(
                request
                    ? state.startDelivery(request.deliveryId)?.text
                    : undefined,
                outcome === 'written' ? 'Reviewed answer.' : undefined
            );
            assert.equal(state.requestDelivery(turn.handle), undefined);
            if (outcome === 'failed')
                assert.equal(state.completedExecution()?.status, 'failed');
            state.close();
        }
    } finally {
        runtimeConfig.chatWorkflow.modeId = previousMode;
        runtimeConfig.chatWorkflow.reviewLoopEnabled = previousReview;
    }
});

test('voice withholds failed assessments and unresolved revision or search requests', async () => {
    const previousMode = runtimeConfig.chatWorkflow.modeId;
    const previousReview = runtimeConfig.chatWorkflow.reviewLoopEnabled;
    runtimeConfig.chatWorkflow.modeId = 'grounded';
    runtimeConfig.chatWorkflow.reviewLoopEnabled = true;
    try {
        for (const decision of ['invalid', 'revise', 'search']) {
            let calls = 0;
            const orchestrator = createChatOrchestrator({
                generationRuntime: {
                    kind: 'synthetic',
                    supportsEphemeralContent: true,
                    generate: async (request) => ({
                        model: request.model,
                        text:
                            calls++ === 0
                                ? JSON.stringify(answerPlan())
                                : calls === 2
                                  ? 'The draft answer.'
                                  : decision === 'invalid'
                                    ? 'not a review'
                                    : JSON.stringify({
                                          reviewDecision: decision,
                                          reviewReason: 'More work needed.',
                                          ...(decision === 'revise'
                                              ? {
                                                    revisionInstruction:
                                                        'State uncertainty.',
                                                }
                                              : {
                                                    search: {
                                                        query: 'missing evidence',
                                                    },
                                                }),
                                      }),
                    }),
                },
                storeTrace: async () => undefined,
                buildResponseMetadata,
                defaultModel: 'gpt-5-mini',
                recordUsage: () => undefined,
            });
            const result = await orchestrator.runRealtimeConversation(
                snapshot(),
                {
                    signal: new AbortController().signal,
                    onRunStarted: () => undefined,
                }
            );
            assert.equal(
                result.finalResponse?.disposition,
                decision === 'invalid'
                    ? 'assessment_failed'
                    : decision === 'revise'
                      ? 'revision_requested'
                      : 'search_requested'
            );
            assert.equal('text' in (result.finalResponse ?? {}), false);
            assert.equal(result.status, 'degraded');
        }
    } finally {
        runtimeConfig.chatWorkflow.modeId = previousMode;
        runtimeConfig.chatWorkflow.reviewLoopEnabled = previousReview;
    }
});

test('voice denies planner terminal actions before execution and retains canonical evidence only', async () => {
    for (const action of ['react', 'image', 'ignore']) {
        let calls = 0;
        let stored: ResponseMetadata | undefined;
        const runtime: GenerationRuntime = {
            kind: 'synthetic',
            supportsEphemeralContent: true,
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
        assert.equal(result.finalResponse?.disposition, 'unsupported_response');
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
            supportsEphemeralContent: true,
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
    const tool = stored?.workflow?.steps.find(
        (step) => step.stepKind === 'tool'
    );
    assert.equal(tool?.outcome.signals?.clarification, true);
    assert.equal(
        tool?.outcome.signals?.clarificationReasonCode,
        'ambiguous_location'
    );
    assert.equal(tool?.outcome.signals?.clarificationOptionCount, 0);
    assert.equal(ResponseMetadataSchema.safeParse(stored).success, true);
    assert.equal(JSON.stringify(stored).includes('VOICE_SECRET'), false);
});

test('voice rejects runtimes without an explicit content-retention guarantee before any execution', async () => {
    let calls = 0;
    const orchestrator = createChatOrchestrator({
        generationRuntime: {
            kind: 'test-runtime',
            generate: async () => {
                calls += 1;
                throw new Error('Must not execute');
            },
        },
        storeTrace: async () => {
            throw new Error('Must not persist');
        },
        buildResponseMetadata,
        defaultModel: 'gpt-5-mini',
        recordUsage: () => undefined,
    });
    await assert.rejects(
        orchestrator.runRealtimeConversation(snapshot(), {
            signal: new AbortController().signal,
            onRunStarted: () => {
                throw new Error('Must not allocate a Run');
            },
        }),
        /runtime does not support ephemeral content/
    );
    assert.equal(calls, 0);
});

test('express voice still executes a canonical Workflow', async () => {
    const priorMode = runtimeConfig.chatWorkflow.modeId;
    runtimeConfig.chatWorkflow.modeId = 'express';
    let stored: ResponseMetadata | undefined;
    let runId: string | undefined;
    let calls = 0;
    try {
        const orchestrator = createChatOrchestrator({
            generationRuntime: {
                kind: 'test-runtime',
                supportsEphemeralContent: true,
                generate: async (request) => ({
                    model: request.model,
                    text:
                        calls++ === 0
                            ? JSON.stringify(answerPlan())
                            : 'VOICE_SECRET',
                }),
            },
            storeTrace: async (metadata) => {
                stored = metadata;
            },
            buildResponseMetadata,
            defaultModel: 'gpt-5-mini',
            recordUsage: () => undefined,
        });
        const result = await orchestrator.runRealtimeConversation(snapshot(), {
            signal: new AbortController().signal,
            onRunStarted: (identity) => {
                runId = identity;
            },
        });
        assert.ok(runId);
        assert.equal(result.finalResponse?.disposition, 'unassessed');
        assert.equal(result.runId, runId);
        assert.equal(stored?.workflow?.runId, runId);
        assert.ok(stored?.workflow?.steps.length);
        assert.equal(JSON.stringify(stored).includes('VOICE_SECRET'), false);
    } finally {
        runtimeConfig.chatWorkflow.modeId = priorMode;
    }
});

test('voice cannot complete without a canonical execution receipt', async () => {
    let calls = 0;
    let writes = 0;
    const orchestrator = createChatOrchestrator({
        generationRuntime: {
            kind: 'test-runtime',
            supportsEphemeralContent: true,
            generate: async (request) => ({
                model: request.model,
                text:
                    calls++ === 0
                        ? JSON.stringify(answerPlan())
                        : 'VOICE_SECRET',
            }),
        },
        storeTrace: async () => {
            writes += 1;
        },
        buildResponseMetadata: (...args) => ({
            ...buildResponseMetadata(...args),
            workflow: undefined,
        }),
        defaultModel: 'gpt-5-mini',
        recordUsage: () => undefined,
    });
    await assert.rejects(
        orchestrator.runRealtimeConversation(snapshot(), {
            signal: new AbortController().signal,
            onRunStarted: () => undefined,
        }),
        /canonical execution receipt/
    );
    assert.equal(writes, 0);
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
                supportsEphemeralContent: true,
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
                supportsEphemeralContent: true,
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
                supportsEphemeralContent: true,
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

test('real storage withholds voice bodies and refuses completion when canonical writes fail', async (t) => {
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
                supportsEphemeralContent: true,
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
            JSON.stringify([metadata, publicTrace]),
            /VOICE_SECRET|Private Name/u
        );
        calls = 0;
        const failedWrite = t.mock.method(store, 'upsert', async () => {
            throw new Error('canonical write failed');
        });
        await assert.rejects(
            orchestrator.runRealtimeConversation(snapshot(), {
                signal: new AbortController().signal,
                onRunStarted: () => undefined,
            }),
            /canonical write failed/
        );
        assert.equal(failedWrite.mock.callCount(), 1);
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
            supportsEphemeralContent: true,
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
