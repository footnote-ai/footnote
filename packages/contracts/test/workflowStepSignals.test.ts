/**
 * @description: Verifies shared workflow step signal builders keep public lineage keys distinct.
 * @footnote-scope: test
 * @footnote-module: WorkflowStepSignalsTests
 * @footnote-risk: low - Tests only cover deterministic signal-key construction.
 * @footnote-ethics: high - Distinct signal keys keep trace lineage honest and readable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWorkflowRoutingChainSignals } from '../src/policy';

const createAttempt = () => ({
    index: 0,
    profileId: 'openai-json-optimized',
    provider: 'openai',
    model: 'gpt-5-mini',
    status: 'executed',
    chooseOneUsed: false,
});

test('buildWorkflowRoutingChainSignals keeps alias keys away from canonical routing-chain fields', () => {
    const signals = buildWorkflowRoutingChainSignals({
        attempts: [createAttempt()],
        selectedProfileId: 'profile_1',
        selectedProvider: 'provider_1',
        selectedModel: 'model_1',
        signalKeys: {
            profileId: 'routingChainAttemptCount',
            provider: 'routingChainAttemptsJson',
            model: 'selectedModel',
        },
    });

    assert.equal(signals.routingChainAttemptCount, 1);
    assert.equal(
        signals.routingChainAttemptsJson,
        JSON.stringify([createAttempt()])
    );
    assert.equal(signals.routingChainAttemptCount_alias, 'profile_1');
    assert.equal(signals.routingChainAttemptsJson_alias, 'provider_1');
    assert.equal(signals.selectedModel, 'model_1');
});

test('buildWorkflowRoutingChainSignals makes duplicate aliases unique', () => {
    const signals = buildWorkflowRoutingChainSignals({
        attempts: [createAttempt()],
        selectedProfileId: 'profile_1',
        selectedProvider: 'provider_1',
        selectedModel: 'model_1',
        signalKeys: {
            profileId: 'routedProfile',
            provider: 'routedProfile',
            model: 'routedProfile',
        },
    });

    assert.equal(signals.routedProfile, 'profile_1');
    assert.equal(signals.routedProfile_alias, 'provider_1');
    assert.equal(signals.routedProfile_alias2, 'model_1');
});
