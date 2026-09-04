/**
 * @description: Tests backend-owned reasoning resolution and OpenAI safety identifier derivation.
 * @footnote-scope: test
 * @footnote-module: RuntimeRequestControlsTests
 * @footnote-risk: medium - Missing coverage could hide model behavior or privacy regressions.
 * @footnote-ethics: high - Tests ensure raw user identifiers do not escape backend derivation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelProfile } from '@footnote/contracts';
import {
    deriveOpenAiSafetyIdentifier,
    resolvePresentationGenerationSettings,
} from '../src/services/runtimeRequestControls.js';
import { hmacId } from '../src/utils/pseudonymization.js';

const logs: Array<{ message: string; meta?: Record<string, unknown> }> = [];
const logger = {
    debug: (message: string, meta?: Record<string, unknown>) =>
        logs.push({ message, meta }),
    warn: (message: string, meta?: Record<string, unknown>) =>
        logs.push({ message, meta }),
};

const profile: ModelProfile = {
    id: 'openai-text-quality',
    description: 'Quality',
    provider: 'openai',
    providerModel: 'gpt-5.6-sol',
    enabled: true,
    tierBindings: ['text-quality'],
    capabilities: {
        canUseSearch: true,
        supportedReasoningEfforts: [
            'none',
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
        ],
    },
    defaultReasoningEffort: 'medium',
};

test('safety identifier is namespaced HMAC and never logged', () => {
    logs.length = 0;
    const identifier = deriveOpenAiSafetyIdentifier(
        { secret: 'secret', surface: 'discord', userId: 'raw-user-123' },
        logger
    );

    assert.equal(
        identifier,
        hmacId('secret', 'raw-user-123', 'openai-safety:v1:discord')
    );
    assert.equal(logs.length, 0);
    assert.equal(JSON.stringify(logs).includes('raw-user-123'), false);
});

test('safety identifier omission is fail-open and metadata-only', () => {
    logs.length = 0;
    assert.equal(
        deriveOpenAiSafetyIdentifier(
            { secret: null, surface: 'web', userId: 'raw-user-123' },
            logger
        ),
        undefined
    );
    assert.equal(logs[0]?.meta?.reasonCode, 'safety_identifier_secret_missing');
    assert.equal(JSON.stringify(logs).includes('raw-user-123'), false);
});

test('presentation settings apply profile precedence and omit unsupported controls', () => {
    const resolution = resolvePresentationGenerationSettings({
        profile: {
            ...profile,
            maxOutputTokens: 512,
            capabilities: {
                ...profile.capabilities,
                supportedSamplingControls: ['temperature'],
                supportedVerbosity: ['low', 'medium'],
            },
            presentationGeneration: {
                promptVariant: 'compact',
                temperature: 0.7,
                verbosity: 'medium',
                maxOutputTokens: 1024,
            },
        },
        request: {
            maxOutputTokens: 256,
            topP: 0.95,
            reasoningEffort: 'low',
            verbosity: 'high',
        },
    });

    assert.deepEqual(resolution.forwarded, {
        promptVariant: 'compact',
        maxOutputTokens: 512,
        reasoningEffort: 'low',
        verbosity: 'medium',
        temperature: 0.7,
    });
    assert.deepEqual(
        resolution.omitted.map(({ setting, reasonCode }) => [
            setting,
            reasonCode,
        ]),
        [['maxOutputTokens', 'output_limit_exceeds_profile_maximum']]
    );
});

test('presentation sampling controls fail open when both are requested', () => {
    const resolution = resolvePresentationGenerationSettings({
        profile: {
            ...profile,
            capabilities: {
                ...profile.capabilities,
                supportedSamplingControls: ['temperature', 'topP'],
            },
        },
        request: { temperature: 0.2, topP: 0.8 },
    });

    assert.equal(resolution.forwarded.temperature, undefined);
    assert.equal(resolution.forwarded.topP, undefined);
    assert.deepEqual(
        resolution.omitted.map(({ setting, reasonCode }) => [
            setting,
            reasonCode,
        ]),
        [
            ['temperature', 'sampling_controls_mutually_exclusive'],
            ['topP', 'sampling_controls_mutually_exclusive'],
        ]
    );
});
