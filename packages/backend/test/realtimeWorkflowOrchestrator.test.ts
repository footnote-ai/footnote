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
    createVoltAgentRuntime,
    type GenerationRuntime,
} from '@footnote/agent-runtime';
import { createBoundedOllamaGenerationRuntime } from '../src/services/boundedOllamaRuntime.js';
import { installVoiceTestObservability } from '../../agent-runtime/test/fixtures/voiceObservability.js';
import type { ResponseMetadata } from '@footnote/contracts/policy';
import { createChatOrchestrator } from '../src/services/chatOrchestrator.js';
import { RealtimeConversationState } from '../src/services/realtimeConversationState.js';
import { buildResponseMetadata } from '../src/services/responseMetadata.js';
import { runtimeConfig } from '../src/config.js';
import { parseBotProfileConfig } from '../src/config/profile.js';
import { resolveVoicePersona } from '../src/services/chatProfileOverlay.js';
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
import { assessRealtimeFinalResponse } from '../src/services/realtimeWorkflowScope.js';

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

for (const mode of ['standard', 'live'] as const) {
    for (const id of ['footnote', 'danny', 'myuri', 'winter', 'operator']) {
        test(`${mode} Workflow uses pinned ${id} persona after runtime configuration changes`, async () => {
            const previousMode = runtimeConfig.chatWorkflow.modeId;
            const previousReview = runtimeConfig.chatWorkflow.reviewLoopEnabled;
            const previousProfile = { ...runtimeConfig.profile };
            runtimeConfig.chatWorkflow.modeId = 'grounded';
            runtimeConfig.chatWorkflow.reviewLoopEnabled = true;
            const persona = resolveVoicePersona(
                parseBotProfileConfig({
                    profileId: id,
                    profileDisplayName: 'Private operator name',
                    ...(id === 'operator'
                        ? {
                              inlineOverlayText: 'PRIVATE_OPERATOR_BEHAVIOR',
                              personaExpressionStrength: 'subtle',
                          }
                        : {}),
                }),
                { warn: () => undefined }
            );
            Object.assign(runtimeConfig.profile, {
                id: 'footnote',
                displayName: 'Changed after admission',
                personaExpressionStrength: 'strong',
            });
            const inputs: string[] = [];
            const records: string[] = [];
            let calls = 0;
            try {
                const orchestrator = createChatOrchestrator({
                    generationRuntime: {
                        kind: 'synthetic',
                        generate: async (request) => {
                            inputs.push(
                                request.messages
                                    .map((message) => message.content)
                                    .join('\n')
                            );
                            return {
                                model: request.model,
                                text:
                                    [
                                        JSON.stringify(answerPlan()),
                                        'The reviewed answer.',
                                        JSON.stringify({
                                            reviewDecision: 'finalize',
                                            reviewReason:
                                                'Sufficient evidence.',
                                        }),
                                    ][calls++] ?? '',
                            };
                        },
                    },
                    storeTrace: async (
                        metadata,
                        candidates,
                        publication,
                        debug
                    ) => {
                        records.push(JSON.stringify(metadata));
                        assert.equal(candidates, undefined);
                        assert.equal(publication, undefined);
                        assert.equal(debug, undefined);
                    },
                    buildResponseMetadata,
                    defaultModel: 'gpt-5-mini',
                    recordUsage: () => undefined,
                });
                const result = await orchestrator.runRealtimeConversation(
                    snapshot(),
                    {
                        signal: new AbortController().signal,
                        onRunStarted: () => undefined,
                        voiceMode: mode,
                        persona,
                    }
                );
                assert.equal(result.finalResponse?.disposition, 'approved');
                if (id === 'operator')
                    assert.match(inputs[1], /PRIVATE_OPERATOR_BEHAVIOR/);
                if (id !== 'footnote')
                    assert.match(inputs[1], new RegExp(`Profile ID: ${id}`));
                const strength =
                    id === 'operator'
                        ? 'subtle'
                        : id === 'winter'
                          ? 'strong'
                          : 'balanced';
                assert.match(
                    inputs[1],
                    new RegExp(`Persona expression strength: ${strength}`)
                );
                assert.match(
                    inputs[2],
                    new RegExp(`Persona expression strength: ${strength}`)
                );
                assert.ok(records.length);
                assert.doesNotMatch(
                    records.join('\n'),
                    /PRIVATE_OPERATOR_BEHAVIOR|Private operator name|VOICE_SECRET/
                );
            } finally {
                runtimeConfig.chatWorkflow.modeId = previousMode;
                runtimeConfig.chatWorkflow.reviewLoopEnabled = previousReview;
                Object.assign(runtimeConfig.profile, previousProfile);
                runtimeConfig.profile.personaExpressionStrength =
                    previousProfile.personaExpressionStrength;
            }
        });
    }
}

for (const provider of ['openrouter', 'openai'] as const) {
    test(`the configured ${provider} route plans, generates and assesses Voice with metadata-only SQLite receipts`, async (t) => {
        const previousProfiles = runtimeConfig.modelProfiles;
        const previousMode = runtimeConfig.chatWorkflow.modeId;
        const previousReview = runtimeConfig.chatWorkflow.reviewLoopEnabled;
        const previousDebug = process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO;
        const previousApiKey = process.env.OPENAI_API_KEY;
        const previousOpenAi = { ...runtimeConfig.openai };
        const original = previousProfiles.catalog.find(
            (entry) => entry.provider === 'openai'
        );
        assert.ok(original);
        const profile = {
            ...original,
            id: 'shared-runtime-test',
            enabled: true,
            provider,
            providerModel:
                provider === 'openrouter' ? 'openai/gpt-5-mini' : 'gpt-5-mini',
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
        process.env.OPENAI_API_KEY = 'synthetic-key';
        Object.assign(runtimeConfig.openai, {
            apiKey: 'synthetic-key',
            plannerStructuredOutputEnabled: true,
        });
        const observability = installVoiceTestObservability();
        const root = await fs.mkdtemp(
            path.join(os.tmpdir(), 'voice-shared-runtime-')
        );
        const store = new SqliteTraceStore({
            dbPath: path.join(root, 'trace.db'),
        });
        const requests: Record<string, unknown>[] = [];
        let failing = false;
        let hostileLabels = true;
        t.mock.method(
            globalThis,
            'fetch',
            async (
                url: Parameters<typeof fetch>[0],
                init?: Parameters<typeof fetch>[1]
            ) => {
                assert.equal(
                    String(url),
                    provider === 'openrouter'
                        ? 'https://openrouter.ai/api/v1/chat/completions'
                        : 'https://api.openai.com/v1/responses'
                );
                const body = JSON.parse(String(init?.body)) as Record<
                    string,
                    unknown
                >;
                requests.push(body);
                if (failing)
                    return Response.json(
                        {
                            model: 'VOICE_SECRET ERROR MODEL',
                            error: {
                                message: 'VOICE_SECRET provider failure',
                                type: 'invalid_request_error',
                                code: 'invalid_request_error',
                            },
                        },
                        { status: 400 }
                    );
                const text = [
                    JSON.stringify(answerPlan()),
                    'VOICE_SECRET APPROVED ANSWER',
                    JSON.stringify({
                        reviewDecision: 'finalize',
                        reviewReason: 'VOICE_SECRET REVIEW',
                    }),
                ][requests.length - 1];
                assert.ok(text, 'Unexpected generation after assessment');
                if (provider === 'openai') {
                    assert.equal(body.store, false);
                    return Response.json({
                        id: `synthetic-${requests.length}`,
                        object: 'response',
                        created_at: 0,
                        status: 'completed',
                        model: hostileLabels
                            ? 'VOICE_SECRET MODEL'
                            : profile.providerModel,
                        output:
                            requests.length === 1
                                ? [
                                      {
                                          type: 'function_call',
                                          name: 'submit_planner_decision',
                                          arguments: text,
                                          call_id: 'synthetic-plan',
                                      },
                                  ]
                                : [
                                      {
                                          id: 'synthetic-message',
                                          type: 'message',
                                          status: 'completed',
                                          role: 'assistant',
                                          content: [
                                              {
                                                  type: 'output_text',
                                                  annotations: [],
                                                  logprobs: [],
                                                  text,
                                              },
                                          ],
                                      },
                                  ],
                        usage: {
                            input_tokens: 10,
                            output_tokens: 5,
                            total_tokens: 15,
                        },
                    });
                }
                return Response.json({
                    id: `synthetic-${requests.length}`,
                    created: 0,
                    model: hostileLabels
                        ? 'VOICE_SECRET MODEL'
                        : profile.providerModel,
                    openrouter_metadata: {
                        endpoints: {
                            available: [
                                {
                                    selected: true,
                                    provider: hostileLabels
                                        ? 'VOICE_SECRET ATTRIBUTION'
                                        : provider,
                                    model: hostileLabels
                                        ? 'VOICE_SECRET ATTRIBUTION'
                                        : profile.providerModel,
                                },
                            ],
                        },
                    },
                    choices: [
                        {
                            index: 0,
                            message: { role: 'assistant', content: text },
                            finish_reason: 'stop',
                        },
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
                    runtime: createVoltAgentRuntime({
                        defaultModel: `${provider}/${profile.providerModel}`,
                        openrouter: { apiKey: 'synthetic-key' },
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
            const result = await orchestrator.runRealtimeConversation(
                snapshot(),
                {
                    signal: new AbortController().signal,
                    onRunStarted: () => undefined,
                }
            );
            assert.equal(requests.length, 3);
            if (provider === 'openrouter') {
                assert.ok(requests[0].response_format);
                assert.ok(requests[2].response_format);
                assert.ok(
                    requests.every((request) => request.tools === undefined)
                );
            } else {
                assert.deepEqual(requests[0].tool_choice, {
                    type: 'function',
                    name: 'submit_planner_decision',
                });
            }
            assert.ok(
                requests.every(
                    (request) => request.model === profile.providerModel
                )
            );
            assert.ok(result.finalResponse?.disposition === 'approved');
            assert.equal(
                result.finalResponse.text,
                'VOICE_SECRET APPROVED ANSWER'
            );
            assert.ok(result.responseId);
            const metadata = await store.retrieve(result.responseId);
            assert.equal(metadata?.workflow?.runId, result.runId);
            assert.equal(metadata?.workflow?.runStatus, 'completed');
            assert.equal(
                (await store.retrieveResponseCandidates(result.responseId))
                    .length,
                0
            );
            assert.equal(
                (await store.retrieveModelDebugCaptures(result.responseId))
                    .length,
                0
            );
            assert.doesNotMatch(
                JSON.stringify(metadata),
                /VOICE_SECRET|Private Name/
            );
            assert.ok(
                metadata?.workflow?.steps.some(
                    (step) => (step.usage?.totalTokens ?? 0) > 0
                )
            );
            hostileLabels = false;
            requests.length = 0;
            const recognized = await orchestrator.runRealtimeConversation(
                snapshot(),
                {
                    signal: new AbortController().signal,
                    onRunStarted: () => undefined,
                }
            );
            assert.ok(recognized.responseId);
            const recognizedMetadata = await store.retrieve(
                recognized.responseId
            );
            assert.equal(recognizedMetadata?.modelVersion, 'gpt-5-mini');
            assert.equal(
                recognizedMetadata?.workflow?.steps.find(
                    (step) => step.stepKind === 'generate'
                )?.model,
                'gpt-5-mini'
            );
            failing = true;
            const failed = await orchestrator.runRealtimeConversation(
                snapshot(),
                {
                    signal: new AbortController().signal,
                    onRunStarted: () => undefined,
                }
            );
            assert.notEqual(failed.finalResponse?.disposition, 'approved');
            assert.ok(failed.responseId);
            const failureMetadata = await store.retrieve(failed.responseId);
            assert.ok(failureMetadata?.workflow);
            assert.doesNotMatch(
                JSON.stringify(failureMetadata),
                /VOICE_SECRET|Private Name/
            );
        } finally {
            store.close();
            await fs.rm(root, { recursive: true, force: true });
            await observability.shutdown();
            mutable.modelProfiles = previousProfiles;
            runtimeConfig.chatWorkflow.modeId = previousMode;
            runtimeConfig.chatWorkflow.reviewLoopEnabled = previousReview;
            Object.assign(runtimeConfig.openai, previousOpenAi);
            if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
            else process.env.OPENAI_API_KEY = previousApiKey;
            if (previousDebug === undefined)
                delete process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO;
            else process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO = previousDebug;
        }
    });
}

test('only the selected, assessed final answer is returned for voice staging', async () => {
    const previousMode = runtimeConfig.chatWorkflow.modeId;
    const previousReview = runtimeConfig.chatWorkflow.reviewLoopEnabled;
    runtimeConfig.chatWorkflow.modeId = 'grounded';
    runtimeConfig.chatWorkflow.reviewLoopEnabled = true;
    let calls = 0;
    let stored: ResponseMetadata | undefined;
    const generationInputs: string[] = [];
    try {
        const orchestrator = createChatOrchestrator({
            generationRuntime: {
                kind: 'synthetic',
                generate: async (request) => {
                    generationInputs.push(
                        request.messages
                            .map((message) => message.content)
                            .join('\n')
                    );
                    return {
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
        assert.equal(calls, 3);
        assert.match(
            generationInputs.join('\n'),
            /maximum of approximately 160 estimated tokens/
        );
        assert.match(
            generationInputs.join('\n'),
            /without automatically raising Tightness or forcing brevity/
        );
    } finally {
        runtimeConfig.chatWorkflow.modeId = previousMode;
        runtimeConfig.chatWorkflow.reviewLoopEnabled = previousReview;
    }
});

test('an over-limit approved Voice answer is condensed, reassessed, and persisted as metadata only', async () => {
    const previousMode = runtimeConfig.chatWorkflow.modeId;
    const previousReview = runtimeConfig.chatWorkflow.reviewLoopEnabled;
    runtimeConfig.chatWorkflow.modeId = 'grounded';
    runtimeConfig.chatWorkflow.reviewLoopEnabled = true;
    let calls = 0;
    const requests: Parameters<GenerationRuntime['generate']>[0][] = [];
    const originalAnswer =
        'The detailed answer repeats itself, adds background, and spends too long explaining the setup.';
    const condensedAnswer = 'Evidence is limited.';
    const outputs = [
        JSON.stringify(answerPlan()),
        originalAnswer,
        JSON.stringify({
            reviewDecision: 'finalize',
            reviewReason: 'Keep the evidence limitation clear.',
        }),
        condensedAnswer,
        JSON.stringify({
            reviewDecision: 'finalize',
            reviewReason: 'The limitation remains clear.',
        }),
    ];
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-condense-'));
    const store = new SqliteTraceStore({ dbPath: path.join(root, 'trace.db') });
    let storedResponseId: string | undefined;
    try {
        const orchestrator = createChatOrchestrator({
            generationRuntime: {
                kind: 'synthetic',
                generate: async (request) => {
                    const call = calls++;
                    requests.push(request);
                    return {
                        model: request.model,
                        text: outputs[call] ?? '',
                        usage: {
                            promptTokens: 10,
                            completionTokens: 5,
                            totalTokens: 15,
                        },
                    };
                },
            },
            storeTrace: (metadata, ...rest) => {
                storedResponseId = metadata.responseId;
                return storeTrace(store, metadata, ...rest);
            },
            buildResponseMetadata,
            defaultModel: 'gpt-5-mini',
            recordUsage: () => undefined,
        });
        const result = await orchestrator.runRealtimeConversation(snapshot(), {
            signal: new AbortController().signal,
            onRunStarted: () => undefined,
            voiceMode: 'live',
            maxAnswerTokens: 12,
        });
        const approvedFinalResponse = result.finalResponse;
        const stored = await store.retrieve(storedResponseId ?? '');
        assert.equal(
            result.finalResponse?.disposition,
            'approved',
            JSON.stringify({ calls, workflowStatus: stored?.workflow?.status })
        );
        assert.ok(approvedFinalResponse?.disposition === 'approved');
        assert.equal(approvedFinalResponse.text, condensedAnswer);
        assert.equal(calls, 5);
        const condensationInput = requests[3]?.messages
            .map((message) => message.content)
            .join('\n');
        assert.match(condensationInput ?? '', /VOICE_SECRET/);
        assert.match(
            condensationInput ?? '',
            /The detailed answer repeats itself/
        );
        assert.match(
            condensationInput ?? '',
            /Keep the evidence limitation clear/
        );
        assert.match(condensationInput ?? '', /12/);

        assert.ok(stored?.workflow);
        assert.doesNotMatch(
            JSON.stringify(stored),
            /VOICE_SECRET|The detailed answer repeats itself|Evidence is limited/
        );
        const workflow = stored.workflow;
        const condensation = workflow.steps.find(
            (step) => step.stepKind === 'condense'
        );
        assert.ok(condensation);
        assert.equal(condensation.usage?.totalTokens, 15);
        assert.equal(condensation.attempts?.[0]?.usage?.totalTokens, 15);
        assert.ok(condensation.cost);
        const candidate = approvedFinalResponse.candidateId;
        assert.ok(condensation.outcome.artifacts?.includes(candidate));
        const condensedResult = workflow.results?.find(
            (entry) =>
                entry.producedByStepId === condensation.stepId &&
                entry.name === 'draft' &&
                entry.status === 'produced'
        );
        assert.ok(condensedResult);
        const assessment = workflow.steps.find(
            (step) => step.stepId === approvedFinalResponse.assessmentStepId
        );
        assert.equal(assessment?.parentStepId, condensation.stepId);
        assert.ok(
            assessment?.inputRefs?.some(
                (ref) =>
                    ref.name === 'draft' &&
                    ref.resultId === condensedResult.resultId
            )
        );
        assert.ok(assessment?.outcome.artifacts?.includes(candidate));
        const initialGeneration = workflow.steps.find(
            (step) => step.stepKind === 'generate'
        );
        assert.ok(initialGeneration);
        const sourceCandidateId = initialGeneration?.outcome.artifacts?.[0];
        assert.ok(sourceCandidateId);
        const selection = {
            message: condensedAnswer,
            answerProvenanceEligible: true,
            candidates: [
                {
                    id: sourceCandidateId,
                    stage: 'initial_generation' as const,
                    workflowStepId: initialGeneration.stepId,
                    sequence: 0,
                    state: 'superseded' as const,
                    text: originalAnswer,
                },
                {
                    id: candidate,
                    parentCandidateId: sourceCandidateId,
                    stage: 'condensation' as const,
                    workflowStepId: condensation.stepId,
                    sequence: 1,
                    state: 'selected' as const,
                    text: condensedAnswer,
                },
            ],
        };
        assert.equal(
            assessRealtimeFinalResponse(
                stored!,
                {
                    mode: 'live',
                    maxAnswerTokens: 12,
                },
                selection
            ).disposition,
            'approved'
        );
        assert.notEqual(
            assessRealtimeFinalResponse(
                stored!,
                {
                    mode: 'live',
                    maxAnswerTokens: 12,
                },
                {
                    ...selection,
                    candidates: [
                        selection.candidates[0],
                        {
                            ...selection.candidates[1],
                            parentCandidateId: 'candidate_wrong_parent',
                        },
                    ],
                }
            ).disposition,
            'approved'
        );
    } finally {
        store.close();
        await fs.rm(root, { recursive: true, force: true });
        runtimeConfig.chatWorkflow.modeId = previousMode;
        runtimeConfig.chatWorkflow.reviewLoopEnabled = previousReview;
    }
});

test('failed or unresolved condensation never releases the original or condensed text', async () => {
    const previousMode = runtimeConfig.chatWorkflow.modeId;
    const previousReview = runtimeConfig.chatWorkflow.reviewLoopEnabled;
    runtimeConfig.chatWorkflow.modeId = 'grounded';
    runtimeConfig.chatWorkflow.reviewLoopEnabled = true;
    const originalAnswer =
        'The original answer is much longer than this configured Voice delivery budget and must never be released without a compliant approved replacement.';
    const cases: Array<{
        name: string;
        outcome: string;
        calls: number;
        failProvider?: boolean;
        condensed?: string;
        completion?: {
            status: 'incomplete';
            visibleTextLength: number;
        };
        reassessment?: 'revise' | 'search';
        toolExecution?: boolean;
    }> = [
        {
            name: 'provider failure',
            outcome: 'provider_failed',
            calls: 4,
            failProvider: true,
        },
        {
            name: 'empty output',
            outcome: 'empty_output',
            calls: 4,
            condensed: ' \u200b ',
        },
        {
            name: 'incomplete output',
            outcome: 'incomplete_output',
            calls: 4,
            condensed: 'Evidence is limited.',
            completion: { status: 'incomplete', visibleTextLength: 20 },
        },
        {
            name: 'provider tool result',
            outcome: 'tool_rejected',
            calls: 4,
            condensed: 'Evidence is limited.',
            toolExecution: true,
        },
        {
            name: 'still over budget',
            outcome: 'still_overlong',
            calls: 5,
            condensed:
                'This answer is still much longer than the configured Voice delivery budget.',
        },
        {
            name: 'reassessment requests revision',
            outcome: 'completed',
            calls: 5,
            condensed: 'Evidence is limited.',
            reassessment: 'revise' as const,
        },
        {
            name: 'reassessment requests search',
            outcome: 'completed',
            calls: 5,
            condensed: 'Evidence is limited.',
            reassessment: 'search' as const,
        },
    ];
    try {
        for (const scenario of cases) {
            let calls = 0;
            let stored: ResponseMetadata | undefined;
            const orchestrator = createChatOrchestrator({
                generationRuntime: {
                    kind: 'synthetic',
                    generate: async (request) => {
                        const call = calls++;
                        if (scenario.failProvider && call === 3)
                            throw new Error('VOICE_SECRET provider failure');
                        const text =
                            call === 0
                                ? JSON.stringify(answerPlan())
                                : call === 1
                                  ? originalAnswer
                                  : call === 2
                                    ? JSON.stringify({
                                          reviewDecision: 'finalize',
                                          reviewReason:
                                              'Preserve this qualification.',
                                      })
                                    : call === 3
                                      ? (scenario.condensed ?? '')
                                      : JSON.stringify({
                                            reviewDecision:
                                                scenario.reassessment ??
                                                'finalize',
                                            reviewReason:
                                                'VOICE_SECRET reassessment',
                                            ...(scenario.reassessment ===
                                            'revise'
                                                ? {
                                                      revisionInstruction:
                                                          'Restore the qualification.',
                                                  }
                                                : {}),
                                            ...(scenario.reassessment ===
                                            'search'
                                                ? {
                                                      search: {
                                                          query: 'restricted follow-up',
                                                      },
                                                  }
                                                : {}),
                                        });
                        return {
                            model: request.model,
                            text,
                            ...(call === 3 && scenario.completion !== undefined
                                ? { completion: scenario.completion }
                                : {}),
                            ...(call === 3 && scenario.toolExecution
                                ? {
                                      toolExecution: {
                                          toolName: 'web_search',
                                          status: 'executed' as const,
                                      },
                                  }
                                : {}),
                        };
                    },
                },
                storeTrace: async (metadata) => {
                    stored = metadata;
                },
                buildResponseMetadata,
                defaultModel: 'gpt-5-mini',
                recordUsage: () => undefined,
            });
            const result = await orchestrator.runRealtimeConversation(
                snapshot(),
                {
                    signal: new AbortController().signal,
                    onRunStarted: () => undefined,
                    voiceMode: 'live',
                    maxAnswerTokens: 12,
                }
            );
            assert.equal(calls, scenario.calls, scenario.name);
            assert.notEqual(
                result.finalResponse?.disposition,
                'approved',
                scenario.name
            );
            assert.equal(
                'text' in (result.finalResponse ?? {}),
                false,
                scenario.name
            );
            const condensation = stored?.workflow?.steps.find(
                (step) => step.stepKind === 'condense'
            );
            assert.equal(
                condensation?.outcome.signals?.condensationOutcome,
                scenario.outcome,
                scenario.name
            );
            if (scenario.toolExecution) {
                assert.equal(
                    stored?.workflow?.steps.some(
                        (step) => step.stepKind === 'tool'
                    ),
                    false
                );
            }
            if (scenario.reassessment !== undefined) {
                const finalAssessment = stored?.workflow?.steps.findLast(
                    (step) => step.stepKind === 'assess'
                );
                assert.equal(
                    finalAssessment?.outcome.signals?.reviewDecision,
                    scenario.reassessment,
                    `${scenario.name}: ${JSON.stringify(finalAssessment)}`
                );
                assert.equal(
                    finalAssessment?.outcome.signals?.condensationOutcome,
                    'assessment_recovery_blocked',
                    scenario.name
                );
            }
            assert.doesNotMatch(
                JSON.stringify(stored),
                /VOICE_SECRET|The original answer is much longer|Evidence is limited/u,
                scenario.name
            );
        }
    } finally {
        runtimeConfig.chatWorkflow.modeId = previousMode;
        runtimeConfig.chatWorkflow.reviewLoopEnabled = previousReview;
    }
});

test('Voice condensation is withheld when the existing Workflow step limit cannot reserve reassessment', async () => {
    const previousMode = runtimeConfig.chatWorkflow.modeId;
    const previousReview = runtimeConfig.chatWorkflow.reviewLoopEnabled;
    const previousStepLimit =
        runtimeConfig.chatWorkflow.maxWorkflowStepsOverride;
    runtimeConfig.chatWorkflow.modeId = 'grounded';
    runtimeConfig.chatWorkflow.reviewLoopEnabled = true;
    runtimeConfig.chatWorkflow.maxWorkflowStepsOverride = 4;
    let calls = 0;
    let stored: ResponseMetadata | undefined;
    try {
        const orchestrator = createChatOrchestrator({
            generationRuntime: {
                kind: 'synthetic',
                generate: async (request) => ({
                    model: request.model,
                    text:
                        [
                            JSON.stringify(answerPlan()),
                            'This approved original is too long for the configured Voice delivery budget.',
                            JSON.stringify({
                                reviewDecision: 'finalize',
                                reviewReason: 'The answer is complete.',
                            }),
                        ][calls++] ?? '',
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
            voiceMode: 'live',
            maxAnswerTokens: 12,
        });
        assert.equal(
            calls,
            3,
            JSON.stringify({
                workflow: stored?.workflow?.steps.map((step) => ({
                    kind: step.stepKind,
                    outcome: step.outcome,
                })),
                terminationReason: stored?.workflow?.terminationReason,
            })
        );
        assert.notEqual(result.finalResponse?.disposition, 'approved');
        assert.equal('text' in (result.finalResponse ?? {}), false);
        assert.deepEqual(result.finalResponse, {
            disposition: 'workflow_limit_reached',
            limitReason: 'budget_exhausted_steps',
        });
        const assessment = stored?.workflow?.steps.findLast(
            (step) => step.stepKind === 'assess'
        );
        assert.equal(
            assessment?.outcome.signals?.condensationOutcome,
            'budget_blocked'
        );
        assert.equal(assessment?.outcome.signals?.condensationAttempted, false);
        assert.equal(
            stored?.workflow?.terminationReason,
            'budget_exhausted_steps'
        );
        assert.equal(
            stored?.workflow?.limitStop?.stoppedBeforeStepKind,
            'condense'
        );
    } finally {
        runtimeConfig.chatWorkflow.modeId = previousMode;
        runtimeConfig.chatWorkflow.reviewLoopEnabled = previousReview;
        runtimeConfig.chatWorkflow.maxWorkflowStepsOverride = previousStepLimit;
    }
});

test('Voice condensation reports a deadline hit before its required reassessment', async () => {
    const previousMode = runtimeConfig.chatWorkflow.modeId;
    const previousReview = runtimeConfig.chatWorkflow.reviewLoopEnabled;
    const previousDurationLimit =
        runtimeConfig.chatWorkflow.maxDurationMsOverride;
    runtimeConfig.chatWorkflow.modeId = 'grounded';
    runtimeConfig.chatWorkflow.reviewLoopEnabled = true;
    runtimeConfig.chatWorkflow.maxDurationMsOverride = 800;
    let calls = 0;
    let stored: ResponseMetadata | undefined;
    try {
        const orchestrator = createChatOrchestrator({
            generationRuntime: {
                kind: 'synthetic',
                generate: async (request) => {
                    const call = calls++;
                    if (call === 3)
                        await new Promise((resolve) =>
                            setTimeout(resolve, 1_000)
                        );
                    return {
                        model: request.model,
                        text:
                            [
                                JSON.stringify(answerPlan()),
                                'This approved original is too long for the configured Voice delivery budget.',
                                JSON.stringify({
                                    reviewDecision: 'finalize',
                                    reviewReason: 'The answer is complete.',
                                }),
                                'A short, accurate condensation.',
                            ][call] ?? '',
                    };
                },
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
            voiceMode: 'live',
            maxAnswerTokens: 12,
        });
        assert.equal(calls, 4);
        assert.ok(
            stored?.workflow?.steps.some(
                (step) =>
                    step.stepKind === 'condense' &&
                    step.outcome.signals?.condensationOutcome === 'completed'
            )
        );
        assert.equal(
            stored?.workflow?.terminationReason,
            'budget_exhausted_time'
        );
        assert.deepEqual(result.finalResponse, {
            disposition: 'workflow_limit_reached',
            limitReason: 'budget_exhausted_time',
        });
    } finally {
        runtimeConfig.chatWorkflow.modeId = previousMode;
        runtimeConfig.chatWorkflow.reviewLoopEnabled = previousReview;
        runtimeConfig.chatWorkflow.maxDurationMsOverride =
            previousDurationLimit;
    }
});

test('caller cancellation during condensation or reassessment cannot approve a late provider result', async () => {
    const previousMode = runtimeConfig.chatWorkflow.modeId;
    const previousReview = runtimeConfig.chatWorkflow.reviewLoopEnabled;
    runtimeConfig.chatWorkflow.modeId = 'grounded';
    runtimeConfig.chatWorkflow.reviewLoopEnabled = true;
    try {
        for (const stage of ['condense', 'assess'] as const) {
            let calls = 0;
            let releaseProvider!: () => void;
            let markProviderStarted!: () => void;
            const providerStarted = new Promise<void>((resolve) => {
                markProviderStarted = resolve;
            });
            const delayedProvider = new Promise<void>((resolve) => {
                releaseProvider = resolve;
            });
            let observedSignal: AbortSignal | undefined;
            let stored: ResponseMetadata | undefined;
            const controller = new AbortController();
            const orchestrator = createChatOrchestrator({
                generationRuntime: {
                    kind: 'synthetic',
                    generate: async (request) => {
                        const call = calls++;
                        if (
                            (stage === 'condense' && call === 3) ||
                            (stage === 'assess' && call === 4)
                        ) {
                            observedSignal = request.signal;
                            markProviderStarted();
                            await delayedProvider;
                            return {
                                model: request.model,
                                text:
                                    stage === 'condense'
                                        ? 'Evidence is limited.'
                                        : JSON.stringify({
                                              reviewDecision: 'finalize',
                                              reviewReason: 'Ready.',
                                          }),
                                usage: {
                                    promptTokens: 100,
                                    completionTokens: 20,
                                    totalTokens: 120,
                                },
                            };
                        }
                        return {
                            model: request.model,
                            text:
                                [
                                    JSON.stringify(answerPlan()),
                                    'This original answer is much too long for the configured Voice delivery ceiling.',
                                    JSON.stringify({
                                        reviewDecision: 'finalize',
                                        reviewReason: 'The original is sound.',
                                    }),
                                    'Evidence is limited.',
                                ][call] ?? '',
                        };
                    },
                },
                storeTrace: async (metadata) => {
                    stored = metadata;
                },
                buildResponseMetadata,
                defaultModel: 'gpt-5-mini',
                recordUsage: () => undefined,
            });
            const pending = orchestrator.runRealtimeConversation(snapshot(), {
                signal: controller.signal,
                onRunStarted: () => undefined,
                voiceMode: 'live',
                maxAnswerTokens: 12,
            });
            await providerStarted;
            controller.abort(new Error('Caller interrupted the turn.'));
            releaseProvider();
            const result = await pending;
            assert.equal(observedSignal?.aborted, true, stage);
            assert.notEqual(
                result.finalResponse?.disposition,
                'approved',
                stage
            );
            assert.equal('text' in (result.finalResponse ?? {}), false, stage);
            assert.doesNotMatch(
                JSON.stringify(stored),
                /This original answer is much too long|Evidence is limited/u,
                stage
            );
            const completedProviderStep = stored?.workflow?.steps.findLast(
                (step) =>
                    step.stepKind ===
                    (stage === 'condense' ? 'condense' : 'assess')
            );
            assert.equal(completedProviderStep?.usage?.totalTokens, 120, stage);
            assert.equal(
                completedProviderStep?.attempts?.[0]?.usage?.totalTokens,
                120,
                stage
            );
            assert.ok(completedProviderStep?.cost, stage);
            assert.ok(completedProviderStep?.attempts?.[0]?.cost, stage);
            if (stage === 'assess') {
                assert.equal(
                    stored?.workflow?.steps.findLast(
                        (step) => step.stepKind === 'assess'
                    )?.outcome.status,
                    'failed'
                );
            }
        }
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
    const previousDeliberationLimit =
        runtimeConfig.chatWorkflow.maxDeliberationCallsOverride;
    runtimeConfig.chatWorkflow.modeId = 'grounded';
    runtimeConfig.chatWorkflow.reviewLoopEnabled = true;
    runtimeConfig.chatWorkflow.maxDeliberationCallsOverride = 8;
    let calls = 0;
    let stored: ResponseMetadata | undefined;
    const requests: Parameters<GenerationRuntime['generate']>[0][] = [];
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
            'Revised answer with its limit, supporting evidence, and enough useful explanation to exceed the Voice delivery limit.',
            JSON.stringify({
                reviewDecision: 'finalize',
                reviewReason: 'Ready.',
            }),
            'The source remains uncertain.',
            JSON.stringify({
                reviewDecision: 'finalize',
                reviewReason: 'The source remains qualified.',
            }),
        ];
        const orchestrator = createChatOrchestrator({
            generationRuntime: {
                kind: 'synthetic',
                generate: async (request) => {
                    requests.push(request);
                    return {
                        model: request.model,
                        text: outputs[calls++] ?? '',
                    };
                },
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
            voiceMode: 'live',
            maxAnswerTokens: 12,
        });
        assert.ok(
            result.finalResponse?.disposition === 'approved',
            JSON.stringify({ result, calls, workflow: stored?.workflow })
        );
        assert.equal(
            result.finalResponse.text,
            'The source remains uncertain.'
        );
        assert.equal(calls, 8);
        const condensationInput = requests[6]?.messages
            .map((message) => message.content)
            .join('\n');
        assert.match(
            condensationInput ?? '',
            /Revised answer with its limit, supporting evidence/
        );
        assert.doesNotMatch(condensationInput ?? '', /First draft\./);
        const condensation = stored?.workflow?.steps.find(
            (step) => step.stepKind === 'condense'
        );
        assert.ok(condensation);
        const assessment = stored?.workflow?.steps.findLast(
            (step) => step.stepKind === 'assess'
        );
        assert.equal(assessment?.parentStepId, condensation.stepId);
        const finalResponse = result.finalResponse;
        const finalAssessment = stored?.workflow?.steps.find(
            (step) => step.stepId === finalResponse.assessmentStepId
        );
        assert.equal(
            finalAssessment?.parentStepId,
            result.finalResponse.generationStepId
        );
    } finally {
        runtimeConfig.chatWorkflow.modeId = previousMode;
        runtimeConfig.chatWorkflow.reviewLoopEnabled = previousReview;
        runtimeConfig.chatWorkflow.maxDeliberationCallsOverride =
            previousDeliberationLimit;
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
