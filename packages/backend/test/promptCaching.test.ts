/**
 * @description: Verifies backend cache identity and route isolation at the request boundary.
 * @footnote-scope: test
 * @footnote-module: BackendPromptCachingTests
 * @footnote-risk: high - Incorrect identities can mix volatile content and model routes.
 * @footnote-ethics: high - Caller text and identity must never affect cache keys.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelProfile } from '@footnote/contracts';
import {
    translatePromptCache,
    GenerationRuntimeError,
    type GenerationRequest,
} from '@footnote/agent-runtime';
import { applyPromptCaching } from '../src/services/workflowEngine/promptCaching.js';
import { observePlannerCall } from '../src/services/workflowEngine/plannerMeasurements.js';
import type { RoutingChainInternalAttempt } from '../src/services/stepRoutingExecutor.js';
import { summarizePromptCaching } from '../src/services/workflowEngine/cacheMeasurements.js';
import { createOpenAiChatPlannerStructuredExecutor } from '../src/services/chatPlannerStructuredOpenAi.js';
import type { WorkflowRecord } from '@footnote/contracts/policy';

const profile: ModelProfile = {
    id: 'test-profile',
    description: 'test',
    provider: 'openai',
    providerModel: 'gpt-5.6-luna',
    enabled: true,
    tierBindings: [],
    capabilities: { canUseSearch: false },
    promptCaching: { enabled: true },
};
const request: GenerationRequest = {
    messages: [
        { role: 'system', content: 'Stable app policy v1', cacheable: true },
        { role: 'system', content: 'Effective request time: 2026-10-27' },
        { role: 'user', content: 'private caller question' },
    ],
};

test('structured planner serializes cache controls on the actual Responses request', async () => {
    const previousFetch = globalThis.fetch;
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
            JSON.stringify({
                model: profile.providerModel,
                usage: {
                    input_tokens: 20,
                    input_tokens_details: {
                        cached_tokens: 0,
                        cache_write_tokens: 10,
                        cache_write_tokens_details: {
                            ttl_30m_tokens: 0,
                            ttl_12h_tokens: 10,
                        },
                    },
                    output_tokens: 1,
                },
                output: [
                    {
                        type: 'function_call',
                        name: 'submit_planner_decision',
                        status: 'completed',
                        arguments: '{}',
                    },
                ],
            }),
            { headers: { 'content-type': 'application/json' } }
        );
    };
    try {
        const execute = createOpenAiChatPlannerStructuredExecutor({
            apiKey: 'fixture-key',
            retryAttempts: 0,
        });
        const result = await execute(
            applyPromptCaching(
                {
                    ...request,
                    model: profile.providerModel,
                    maxOutputTokens: 32,
                },
                {
                    ...profile,
                    promptCaching: { enabled: true, ttlSeconds: 43200 },
                },
                'planner',
                'web'
            )
        );
        assert.equal(body?.store, false);
        assert.deepEqual(body?.prompt_cache_options, {
            mode: 'explicit',
            ttl: '30m',
        });
        const input = body?.input as Array<{ content: unknown }>;
        assert.match(JSON.stringify(input[0]), /prompt_cache_breakpoint/);
        assert.match(JSON.stringify(input[0]), /12h/);
        assert.equal(
            JSON.stringify(input[1]).includes('prompt_cache_breakpoint'),
            false
        );
        assert.equal(result.usage?.cacheWrite12hTokens, 10);
        assert.equal(result.promptCache?.purpose, 'planner');
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test('cache identity excludes volatile clock, caller identifiers, and evidence but invalidates trusted prefix and route changes', () => {
    const initial = applyPromptCaching(
        request,
        profile,
        'generation',
        'web'
    ).promptCache;
    assert.equal(initial?.stablePrefixMessages, 1);
    assert.match(initial?.key ?? '', /^footnote:cache:v1:[a-f0-9]{64}$/);
    assert.equal(
        initial?.key,
        'footnote:cache:v1:1d111d32417992aa709115cf82270059e01d9ae94db4a7c32325c2353b15a53c'
    );
    const changed = applyPromptCaching(
        {
            ...request,
            userId: 'different user',
            messages: [
                request.messages[0]!,
                {
                    role: 'user',
                    content: 'different clock, evidence, and text',
                },
            ],
        },
        profile,
        'generation',
        'web'
    ).promptCache;
    assert.equal(changed?.key, initial?.key);
    const prefixChange = applyPromptCaching(
        {
            messages: [
                {
                    role: 'system',
                    content: 'Stable app policy v2',
                    cacheable: true,
                },
            ],
        },
        profile,
        'generation',
        'web'
    ).promptCache;
    assert.notEqual(prefixChange?.key, initial?.key);
    for (const [selected, purpose, surface] of [
        [{ ...profile, providerModel: 'gpt-5.6-terra' }, 'generation', 'web'],
        [{ ...profile, defaultReasoningEffort: 'high' }, 'generation', 'web'],
        [profile, 'assessment', 'web'],
        [profile, 'generation', 'discord'],
    ] as const)
        assert.notEqual(
            applyPromptCaching(request, selected, purpose, surface).promptCache
                ?.key,
            initial?.key
        );
    const disabled = applyPromptCaching(
        { ...request, promptCache: initial },
        { ...profile, promptCaching: { enabled: false } },
        'generation'
    );
    assert.equal(disabled.promptCache?.enabled, false);
    assert.equal(disabled.promptCache?.promptVersion, initial?.promptVersion);
    assert.notEqual(
        disabled.promptCache?.profileVersion,
        initial?.profileVersion
    );
    assert.deepEqual(disabled.messages, request.messages);
});

test('cache summary counts failed and successful nested routes once and preserves partial measurements', () => {
    const workflow: WorkflowRecord = {
        workflowId: 'fixture',
        workflowName: 'fixture',
        status: 'completed',
        terminationReason: 'goal_satisfied',
        stepCount: 1,
        maxSteps: 10,
        steps: [
            {
                stepId: 'generate',
                startedAt: '2026-10-27T00:00:00Z',
                finishedAt: '2026-10-27T00:00:01Z',
                durationMs: 1000,
                stepKind: 'generate',
                attempt: 1,
                outcome: { status: 'executed', summary: 'fixture' },
                usage: { promptTokens: 9999 },
                attempts: [
                    {
                        attempt: 1,
                        status: 'succeeded',
                        startedAt: '2026-10-27T00:00:00Z',
                        finishedAt: '2026-10-27T00:00:01Z',
                        durationMs: 1000,
                        requestedProvider: 'openai',
                        requestedModel: 'gpt-5.6-luna',
                        usage: { promptTokens: 8888 },
                        routingAttempts: [
                            {
                                index: 0,
                                profileId: 'private-route',
                                status: 'failed_transient_advanced',
                                chooseOneUsed: false,
                                usage: {
                                    promptTokens: 100,
                                    cachedInputTokens: 0,
                                    cacheWriteTokens: 80,
                                },
                            },
                            {
                                index: 1,
                                profileId: 'private-route',
                                status: 'executed',
                                chooseOneUsed: false,
                                usage: {
                                    promptTokens: 100,
                                    cachedInputTokens: 80,
                                },
                            },
                            {
                                index: 2,
                                profileId: 'private-route',
                                status: 'skipped_ineligible',
                                chooseOneUsed: false,
                            },
                        ],
                    },
                ],
            },
        ],
    };
    const [summary] = summarizePromptCaching(workflow);
    assert.equal(summary?.attempts, 2);
    assert.equal(summary?.inputTokens, 200);
    assert.equal(summary?.cacheReadTokens, 80);
    assert.equal(summary?.cacheWriteTokens, 80);
    assert.equal(summary?.writesReported, 1);
    assert.equal(summary?.hitRate, 0.5);
    assert.equal(summary?.cacheReadShare, 0.4);
    assert.equal(summary?.cacheWriteReadRatio, undefined);
    assert.equal(summary?.cacheSavingsUsd, undefined);
    assert.equal(JSON.stringify(summary).includes('private-route'), false);
});

test('cache summary excludes not-called routes and groups by actual serving provider', () => {
    const workflow: WorkflowRecord = {
        workflowId: 'fixture',
        workflowName: 'fixture',
        status: 'completed',
        terminationReason: 'goal_satisfied',
        stepCount: 1,
        maxSteps: 10,
        steps: [
            {
                stepId: 'generate',
                startedAt: '2026-10-27T00:00:00Z',
                finishedAt: '2026-10-27T00:00:01Z',
                durationMs: 1000,
                stepKind: 'generate',
                attempt: 1,
                outcome: { status: 'executed', summary: 'fixture' },
                attempts: [
                    {
                        attempt: 1,
                        status: 'succeeded',
                        startedAt: '2026-10-27T00:00:00Z',
                        finishedAt: '2026-10-27T00:00:01Z',
                        durationMs: 1000,
                        requestedProvider: 'openrouter',
                        requestedModel: 'router/model',
                        actualProvider: 'aggregate-provider',
                        actualModel: 'aggregate-model',
                        routingAttempts: [
                            {
                                index: 0,
                                profileId: 'route-a',
                                status: 'failed_transient_advanced',
                                providerCallStatus: 'failed',
                                actualProvider: 'serving-provider',
                                actualModel: 'serving-model',
                                chooseOneUsed: false,
                                usage: { promptTokens: 100 },
                            },
                            {
                                index: 1,
                                profileId: 'route-b',
                                status: 'executed',
                                providerCallStatus: 'succeeded',
                                actualProvider: 'serving-provider',
                                actualModel: 'serving-model',
                                chooseOneUsed: false,
                                usage: {
                                    promptTokens: 100,
                                    cachedInputTokens: 40,
                                },
                            },
                            {
                                index: 2,
                                profileId: 'route-c',
                                status: 'failed_transient_advanced',
                                providerCallStatus: 'not_called',
                                chooseOneUsed: false,
                            },
                            {
                                index: 3,
                                profileId: 'route-d',
                                status: 'executed',
                                providerCallStatus: 'succeeded',
                                actualProvider: 'other-provider',
                                actualModel: 'other-model',
                                chooseOneUsed: false,
                                usage: {
                                    promptTokens: 30,
                                    cachedInputTokens: 0,
                                },
                            },
                            {
                                index: 4,
                                profileId: 'route-e',
                                status: 'executed',
                                providerCallStatus: 'succeeded',
                                chooseOneUsed: false,
                                usage: {
                                    promptTokens: 10,
                                    cachedInputTokens: 5,
                                },
                            },
                        ],
                    },
                ],
            },
        ],
    };

    const summaries = summarizePromptCaching(workflow);
    const routed = summaries.find(
        (summary) => summary.provider === 'serving-provider'
    );
    const other = summaries.find(
        (summary) => summary.provider === 'other-provider'
    );
    const requested = summaries.find(
        (summary) => summary.provider === 'openrouter'
    );
    assert.equal(summaries.length, 3);
    assert.equal(routed?.model, 'serving-model');
    assert.equal(routed?.attempts, 2);
    assert.equal(routed?.inputReported, 2);
    assert.equal(routed?.readsReported, 1);
    assert.equal(routed?.hitRate, undefined);
    assert.equal(other?.model, 'other-model');
    assert.equal(other?.attempts, 1);
    assert.equal(other?.hitRate, 0);
    assert.equal(requested?.model, 'router/model');
    assert.equal(requested?.attempts, 1);
    assert.equal(requested?.cacheReadTokens, 5);
});

test('condensation cache attempts retain their distinct purpose', () => {
    const workflow: WorkflowRecord = {
        workflowId: 'fixture',
        workflowName: 'fixture',
        status: 'completed',
        terminationReason: 'goal_satisfied',
        stepCount: 1,
        maxSteps: 10,
        steps: [
            {
                stepId: 'condense',
                startedAt: '2026-10-27T00:00:00Z',
                finishedAt: '2026-10-27T00:00:01Z',
                durationMs: 1000,
                stepKind: 'condense',
                attempt: 1,
                outcome: { status: 'executed', summary: 'fixture' },
                attempts: [
                    {
                        attempt: 1,
                        status: 'succeeded',
                        startedAt: '2026-10-27T00:00:00Z',
                        finishedAt: '2026-10-27T00:00:01Z',
                        durationMs: 1000,
                        promptCache: {
                            mode: 'explicit',
                            purpose: 'condensation',
                            surface: 'unknown',
                            stablePrefixTokensEstimate: 12,
                        },
                    },
                ],
            },
        ],
    };

    const [summary] = summarizePromptCaching(workflow);
    assert.equal(summary?.purpose, 'condensation');
    assert.equal(summary?.attempts, 1);
});

test('disabled controls retain version attribution without changing provider wire options', () => {
    const observed = applyPromptCaching(
        request,
        { ...profile, promptCaching: undefined },
        'generation',
        'web'
    );
    const translated = translatePromptCache(observed);
    assert.equal(translated?.receipt.mode, 'disabled');
    assert.equal(translated?.receipt.surface, 'web');
    assert.match(translated?.receipt.promptVersion ?? '', /^[a-f0-9]{64}$/);
    assert.match(translated?.receipt.profileVersion ?? '', /^[a-f0-9]{64}$/);
    assert.deepEqual(translated?.native, {});
    assert.deepEqual(translated?.sdk, {});
    assert.equal(translated?.breakpoint, undefined);
});

test('planner measurements retain missing, zero, failed calls, costs and durations independently', async () => {
    const attempts: RoutingChainInternalAttempt[] = [];
    const observed = applyPromptCaching(
        { ...request, model: 'gpt-5.6-luna', provider: 'openai' },
        profile,
        'planner',
        'web'
    );
    await assert.rejects(
        observePlannerCall(
            observed,
            async () => {
                throw new GenerationRuntimeError(
                    'fixture',
                    { classification: 'structured_output_unavailable' },
                    { usage: { promptTokens: 10 } }
                );
            },
            (attempt) => attempts.push(attempt)
        )
    );
    await observePlannerCall(
        observed,
        async () => ({
            model: 'gpt-5.6-luna',
            usage: {
                promptTokens: 12,
                completionTokens: 1,
                cachedInputTokens: 0,
                cacheWriteTokens: 0,
            },
        }),
        (attempt) => attempts.push(attempt)
    );
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0]?.providerCallStatus, 'failed');
    assert.equal(attempts[1]?.providerCallStatus, 'succeeded');
    assert.equal(attempts[0]?.usage?.cachedInputTokens, undefined);
    assert.equal(attempts[1]?.usage?.cachedInputTokens, 0);
    assert.equal(attempts[1]?.cost?.costCompleteness, 'complete');
    assert.ok(
        attempts.every(
            (attempt) => attempt.finishedAtMs! >= attempt.startedAtMs!
        )
    );
    assert.ok(
        attempts.every((attempt) => attempt.promptCache?.purpose === 'planner')
    );
    await assert.rejects(
        observePlannerCall(
            observed,
            async () => {
                throw Object.assign(new Error('before provider'), {
                    preProviderCallFailure: true,
                });
            },
            (attempt) => attempts.push(attempt)
        )
    );
    assert.equal(attempts.length, 2);
});

test('planner canonical receipts retain actual router attribution without direct-provider savings', async () => {
    const attempts: RoutingChainInternalAttempt[] = [];
    await observePlannerCall(
        { ...request, provider: 'openrouter', model: 'openai/gpt-5.6-luna' },
        async () => ({
            model: 'openai/gpt-5.6-luna',
            upstreamAttribution: {
                resolvedModel: 'gpt-5.6-luna-2026-10-01',
                inferenceProvider: 'fixture-router-host',
            },
            usage: {
                promptTokens: 1000,
                completionTokens: 1,
                cachedInputTokens: 800,
                cacheWriteTokens: 0,
            },
        }),
        (attempt) => attempts.push(attempt)
    );
    assert.equal(attempts[0]?.actualModel, 'gpt-5.6-luna-2026-10-01');
    assert.equal(attempts[0]?.actualProvider, 'fixture-router-host');
    assert.equal(attempts[0]?.cost?.costCompleteness, 'unknown');
    assert.equal(attempts[0]?.cost?.cacheSavingsUsd, undefined);
});
