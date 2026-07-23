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
    resolveProfileReasoningEffort,
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

test('profile default is authoritative over a requested effort', () => {
    logs.length = 0;
    assert.equal(
        resolveProfileReasoningEffort(profile, 'low', logger),
        'medium'
    );
    assert.equal(
        logs[0]?.meta?.reasonCode,
        'reasoning_effort_profile_default_applied'
    );
});

test('unsupported effort is omitted fail-open with structured diagnostics', () => {
    logs.length = 0;
    const unsupportedProfile: ModelProfile = {
        ...profile,
        id: 'limited',
        defaultReasoningEffort: undefined,
        capabilities: {
            canUseSearch: false,
            supportedReasoningEfforts: ['low'],
        },
    };

    assert.equal(
        resolveProfileReasoningEffort(unsupportedProfile, 'max', logger),
        undefined
    );
    assert.equal(logs[0]?.meta?.reasonCode, 'reasoning_effort_not_supported');
});

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
