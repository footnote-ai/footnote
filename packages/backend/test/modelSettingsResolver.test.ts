/**
 * @description: Tests the backend-owned model settings resolution seam.
 * @footnote-scope: test
 * @footnote-module: ModelSettingsResolverTests
 * @footnote-risk: medium - Incorrect resolution can send invalid model controls.
 * @footnote-ethics: medium - Explicit receipts preserve truthful fail-open behavior.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelProfile } from '@footnote/contracts';
import { resolveModelSettings } from '../src/services/runtimeRequestControls.js';

const profile: ModelProfile = {
    id: 'primary',
    description: 'Primary test profile',
    provider: 'openai',
    providerModel: 'gpt-primary',
    enabled: true,
    tierBindings: [],
    capabilities: {
        canUseSearch: false,
        supportedReasoningEfforts: ['none', 'low', 'medium'],
        supportedVerbosity: ['low', 'medium'],
        supportedSamplingControls: ['temperature'],
    },
    defaultReasoningEffort: 'medium',
    maxOutputTokens: 512,
};

test('applies profile defaults when no matching control was requested', () => {
    const resolution = resolveModelSettings({
        profile,
        request: {},
    });

    assert.deepEqual(resolution.requested, {});
    assert.deepEqual(resolution.applied, {
        maxOutputTokens: 512,
        reasoningEffort: 'medium',
    });
    assert.deepEqual(resolution.ignored, []);
    assert.deepEqual(resolution.adjusted, []);
});

test('omits unsupported controls without blocking the attempt', () => {
    const resolution = resolveModelSettings({
        profile,
        request: {
            reasoningEffort: 'max',
            verbosity: 'high',
            topP: 0.8,
        },
    });

    assert.deepEqual(resolution.applied, { maxOutputTokens: 512 });
    assert.deepEqual(
        resolution.ignored.map(({ setting, reasonCode }) => [
            setting,
            reasonCode,
        ]),
        [
            ['reasoningEffort', 'reasoning_effort_not_supported'],
            ['verbosity', 'verbosity_not_supported'],
            ['topP', 'sampling_control_not_supported'],
        ]
    );
});

test('forwards controls with unknown support to preserve fail-open execution', () => {
    const resolution = resolveModelSettings({
        profile: {
            ...profile,
            capabilities: { canUseSearch: false },
        },
        request: {
            reasoningEffort: 'low',
            verbosity: 'high',
            temperature: 0.3,
        },
    });

    assert.deepEqual(resolution.applied, {
        maxOutputTokens: 512,
        reasoningEffort: 'low',
        verbosity: 'high',
        temperature: 0.3,
    });
    assert.deepEqual(resolution.ignored, []);
});

test('caps requested output at the actual profile ceiling with a bounded receipt', () => {
    const resolution = resolveModelSettings({
        profile,
        request: { maxOutputTokens: 1_024 },
    });

    assert.equal(resolution.applied.maxOutputTokens, 512);
    assert.deepEqual(resolution.adjusted, [
        {
            setting: 'maxOutputTokens',
            requested: 1_024,
            applied: 512,
            reasonCode: 'output_limit_exceeds_profile_maximum',
        },
    ]);
});
