/**
 * @description: Validates model-chain attempt execution and strict transient fallback progression.
 * @footnote-scope: test
 * @footnote-module: StepRoutingExecutorTests
 * @footnote-risk: low - Test-only coverage for chain executor behavior.
 * @footnote-ethics: medium - Fallback telemetry and deterministic fail-open behavior need explicit checks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { GenerationRuntimeError } from '@footnote/agent-runtime';
import type { ModelProfile } from '@footnote/contracts';
import { executeStepRoutingChain } from '../src/services/stepRoutingExecutor.js';
import { createProviderAvailabilityStore } from '../src/services/providerAvailability.js';

const makeProfile = (input: {
    id: string;
    provider: 'openai' | 'ollama';
    providerModel: string;
    canUseSearch: boolean;
}): ModelProfile => ({
    id: input.id,
    description: input.id,
    provider: input.provider,
    providerModel: input.providerModel,
    enabled: true,
    tierBindings: [],
    capabilities: { canUseSearch: input.canUseSearch },
});

test('executeStepRoutingChain advances on transient errors and succeeds on next candidate', async () => {
    const first = makeProfile({
        id: 'openai-text-medium',
        provider: 'openai',
        providerModel: 'gpt-5.4-mini',
        canUseSearch: true,
    });
    const second = makeProfile({
        id: 'ollama-text-gptoss',
        provider: 'ollama',
        providerModel: 'gpt-oss:20b-cloud',
        canUseSearch: true,
    });
    const enabledProfilesById = new Map([
        [first.id, first],
        [second.id, second],
    ]);

    let calls = 0;
    const result = await executeStepRoutingChain({
        step: 'generate',
        candidates: [
            { profileId: first.id, chooseOneUsed: false },
            { profileId: second.id, chooseOneUsed: false },
        ],
        enabledProfilesById,
        requiresSearch: false,
        runWithProfile: async (profile) => {
            calls += 1;
            if (profile.id === first.id) {
                throw new GenerationRuntimeError('429 rate limit', {
                    classification: 'transient',
                });
            }
            return profile.id;
        },
    });

    assert.equal(calls, 2);
    assert.equal(result.status, 'executed');
    if (result.status === 'executed') {
        assert.equal(result.selected.profile.id, second.id);
        assert.equal(result.attempts.length, 2);
        assert.equal(result.attempts[0]?.status, 'failed_transient_advanced');
        assert.equal(result.attempts[1]?.status, 'executed');
    }
});

test('executeStepRoutingChain stops on non-transient errors', async () => {
    const first = makeProfile({
        id: 'openai-text-medium',
        provider: 'openai',
        providerModel: 'gpt-5.4-mini',
        canUseSearch: true,
    });
    const second = makeProfile({
        id: 'ollama-text-gptoss',
        provider: 'ollama',
        providerModel: 'gpt-oss:20b-cloud',
        canUseSearch: true,
    });
    const enabledProfilesById = new Map([
        [first.id, first],
        [second.id, second],
    ]);

    let calls = 0;
    const result = await executeStepRoutingChain({
        step: 'assess',
        candidates: [
            { profileId: first.id, chooseOneUsed: false },
            { profileId: second.id, chooseOneUsed: false },
        ],
        enabledProfilesById,
        requiresSearch: false,
        runWithProfile: async () => {
            calls += 1;
            throw new Error('401 unauthorized');
        },
    });

    assert.equal(calls, 1);
    assert.equal(result.status, 'exhausted');
    if (result.status === 'exhausted') {
        assert.equal(result.reasonCode, 'routing_chain_non_transient_error');
        assert.equal(result.attempts.length, 1);
        assert.equal(
            result.attempts[0]?.status,
            'failed_non_transient_stopped'
        );
    }
});

test('executeStepRoutingChain advances when a provider returns a retryable result', async () => {
    const first = makeProfile({
        id: 'openai-text-medium',
        provider: 'openai',
        providerModel: 'gpt-5.4-mini',
        canUseSearch: true,
    });
    const second = makeProfile({
        id: 'ollama-text-gptoss',
        provider: 'ollama',
        providerModel: 'gpt-oss:20b-cloud',
        canUseSearch: true,
    });
    const enabledProfilesById = new Map([
        [first.id, first],
        [second.id, second],
    ]);

    const result = await executeStepRoutingChain({
        step: 'generate',
        candidates: [
            { profileId: first.id, chooseOneUsed: false },
            { profileId: second.id, chooseOneUsed: false },
        ],
        enabledProfilesById,
        requiresSearch: false,
        runWithProfile: async (profile) => ({
            profileId: profile.id,
            complete: profile.id === second.id,
        }),
        retryReasonCode: (value) =>
            value.complete ? undefined : 'routing_chain_transient_error',
    });

    assert.equal(result.status, 'executed');
    if (result.status === 'executed') {
        assert.equal(result.selected.profile.id, second.id);
        assert.equal(result.attempts[0]?.status, 'failed_transient_advanced');
        assert.equal(result.attempts[1]?.status, 'executed');
    }
});

test('inadmissible generation output advances without recording provider unavailability', async () => {
    const profile = makeProfile({
        id: 'openai-empty-output',
        provider: 'openai',
        providerModel: 'gpt-5.4-mini',
        canUseSearch: true,
    });
    const store = createProviderAvailabilityStore({ now: () => 5_000 });
    const result = await executeStepRoutingChain({
        step: 'generate',
        candidates: [{ profileId: profile.id, chooseOneUsed: false }],
        enabledProfilesById: new Map([[profile.id, profile]]),
        requiresSearch: false,
        providerAvailability: store,
        runWithProfile: async () => ({ admitted: false }),
        retryReasonCode: () => 'generation_empty_output',
    });

    assert.equal(result.status, 'exhausted');
    assert.equal(store.size(), 0);
    assert.equal(result.attempts[0]?.reasonCode, 'generation_empty_output');
});

test('unknown provider availability remains fail-open and does not poison later routing', async () => {
    const first = makeProfile({
        id: 'openai-text-medium-unknown',
        provider: 'openai',
        providerModel: 'gpt-5.4-mini',
        canUseSearch: true,
    });
    const store = createProviderAvailabilityStore({ now: () => 1_000 });
    const enabledProfilesById = new Map([[first.id, first]]);
    let calls = 0;

    const run = async () =>
        executeStepRoutingChain({
            step: 'generate',
            candidates: [{ profileId: first.id, chooseOneUsed: false }],
            enabledProfilesById,
            requiresSearch: false,
            providerAvailability: store,
            runWithProfile: async () => {
                calls += 1;
                throw new Error('provider availability is unknown');
            },
        });

    const firstResult = await run();
    const secondResult = await run();

    assert.equal(calls, 2);
    assert.equal(firstResult.status, 'exhausted');
    assert.equal(secondResult.status, 'exhausted');
    assert.equal(store.size(), 0);
});

test('recognized billing failure is recorded, then automatic routing skips it and runs the fallback', async () => {
    const first = makeProfile({
        id: 'openai-billing',
        provider: 'openai',
        providerModel: 'gpt-5.6-terra',
        canUseSearch: true,
    });
    const second = makeProfile({
        id: 'ollama-fallback',
        provider: 'ollama',
        providerModel: 'gpt-oss:20b-cloud',
        canUseSearch: true,
    });
    let now = 10_000;
    const store = createProviderAvailabilityStore({
        now: () => now,
        ttlMs: 100,
    });
    const enabledProfilesById = new Map([
        [first.id, first],
        [second.id, second],
    ]);
    let calls = 0;

    const firstResult = await executeStepRoutingChain({
        step: 'generate',
        candidates: [
            { profileId: first.id, chooseOneUsed: false },
            { profileId: second.id, chooseOneUsed: false },
        ],
        enabledProfilesById,
        requiresSearch: false,
        providerAvailability: store,
        runWithProfile: async (profile) => {
            calls += 1;
            if (profile.id === first.id) {
                throw new GenerationRuntimeError('account has no credits', {
                    classification: 'provider_temporary_unavailable',
                    availabilityReason: 'billing_or_quota',
                });
            }
            return profile.id;
        },
    });

    assert.equal(firstResult.status, 'executed');
    assert.equal(calls, 2);
    if (firstResult.status === 'executed') {
        assert.equal(firstResult.selected.profile.id, second.id);
        assert.equal(
            firstResult.attempts[0]?.reasonCode,
            'routing_chain_temporary_unavailable'
        );
        assert.equal(
            firstResult.attempts[0]?.status,
            'failed_transient_advanced'
        );
    }
    assert.equal(store.size(), 1);

    const secondResult = await executeStepRoutingChain({
        step: 'generate',
        candidates: [
            { profileId: first.id, chooseOneUsed: false },
            { profileId: second.id, chooseOneUsed: false },
        ],
        enabledProfilesById,
        requiresSearch: false,
        providerAvailability: store,
        runWithProfile: async (profile) => {
            calls += 1;
            return profile.id;
        },
    });

    assert.equal(secondResult.status, 'executed');
    assert.equal(calls, 3);
    if (secondResult.status === 'executed') {
        assert.equal(secondResult.selected.profile.id, second.id);
        assert.equal(
            secondResult.attempts[0]?.status,
            'skipped_temporary_unavailable'
        );
        assert.equal(
            secondResult.attempts[0]?.reasonCode,
            'routing_chain_temporary_unavailable'
        );
        assert.equal(
            secondResult.attempts[0]?.temporaryUnavailableReason,
            'billing_or_quota'
        );
    }
});

test('temporary provider availability expires lazily and a successful retry clears state', async () => {
    const profile = makeProfile({
        id: 'openai-recovering',
        provider: 'openai',
        providerModel: 'gpt-5.6-terra',
        canUseSearch: true,
    });
    let now = 20_000;
    const store = createProviderAvailabilityStore({
        now: () => now,
        ttlMs: 100,
    });
    const enabledProfilesById = new Map([[profile.id, profile]]);
    store.mark(profile.provider, 'account_unavailable');

    const skipped = await executeStepRoutingChain({
        step: 'generate',
        candidates: [{ profileId: profile.id, chooseOneUsed: false }],
        enabledProfilesById,
        requiresSearch: false,
        providerAvailability: store,
        runWithProfile: async () => profile.id,
    });
    assert.equal(skipped.status, 'exhausted');
    assert.equal(store.size(), 1);

    now += 101;
    const recovered = await executeStepRoutingChain({
        step: 'generate',
        candidates: [{ profileId: profile.id, chooseOneUsed: false }],
        enabledProfilesById,
        requiresSearch: false,
        providerAvailability: store,
        runWithProfile: async () => profile.id,
    });
    assert.equal(recovered.status, 'executed');
    assert.equal(store.size(), 0);
});

test('explicit profile selection is attempted despite temporary automatic state', async () => {
    const profile = makeProfile({
        id: 'openai-explicit',
        provider: 'openai',
        providerModel: 'gpt-5.6-terra',
        canUseSearch: true,
    });
    const store = createProviderAvailabilityStore({ now: () => 30_000 });
    store.mark(profile.provider, 'billing_or_quota');
    const result = await executeStepRoutingChain({
        step: 'generate',
        candidates: [
            {
                profileId: profile.id,
                selectionSource: 'explicit',
                chooseOneUsed: false,
            },
        ],
        enabledProfilesById: new Map([[profile.id, profile]]),
        requiresSearch: false,
        providerAvailability: store,
        runWithProfile: async () => 'explicitly attempted',
    });

    assert.equal(result.status, 'executed');
    assert.equal(store.size(), 0);
});

test('temporary availability state only affects generation routing', async () => {
    const profile = makeProfile({
        id: 'openai-planner',
        provider: 'openai',
        providerModel: 'gpt-5.6-terra',
        canUseSearch: true,
    });
    const store = createProviderAvailabilityStore({ now: () => 35_000 });
    store.mark(profile.provider, 'billing_or_quota');

    const result = await executeStepRoutingChain({
        step: 'planner',
        candidates: [{ profileId: profile.id, chooseOneUsed: false }],
        enabledProfilesById: new Map([[profile.id, profile]]),
        requiresSearch: false,
        providerAvailability: store,
        runWithProfile: async () => profile.id,
    });

    assert.equal(result.status, 'executed');
    assert.equal(store.size(), 1);
});

test('unrelated failures do not poison provider availability and expired entries are bounded', async () => {
    let now = 40_000;
    const store = createProviderAvailabilityStore({
        now: () => now,
        ttlMs: 100,
        maxEntries: 2,
    });
    store.mark('openai', 'billing_or_quota');
    store.mark('ollama', 'account_unavailable');
    store.mark('openrouter', 'billing_or_quota');
    assert.equal(store.size(), 2);

    const profile = makeProfile({
        id: 'openai-unrelated',
        provider: 'openai',
        providerModel: 'gpt-5.4-mini',
        canUseSearch: true,
    });
    const result = await executeStepRoutingChain({
        step: 'generate',
        candidates: [{ profileId: profile.id, chooseOneUsed: false }],
        enabledProfilesById: new Map([[profile.id, profile]]),
        requiresSearch: false,
        providerAvailability: store,
        runWithProfile: async () => {
            throw new GenerationRuntimeError('temporary transport failure', {
                classification: 'transient',
            });
        },
    });
    assert.equal(result.status, 'exhausted');
    assert.equal(store.size(), 2);

    now += 101;
    assert.equal(store.size(), 0);
});
