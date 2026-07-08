/**
 * @description: Verifies the shared landing-scenario generation helpers used by the live capture CLI and JSON emitters.
 * @footnote-scope: test
 * @footnote-module: LandingScenarioGenerationTests
 * @footnote-risk: medium - Bad helper behavior would corrupt generated fixtures or weaken validation.
 * @footnote-ethics: high - Prepared examples need deterministic sanitization and trace-safe metadata.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessageActionResponse } from '@footnote/contracts/web';
import {
    LANDING_SCENARIO_PROMPTS,
    assertScenarioId,
    buildChatRequest,
    buildLandingScenarioFixture,
    canonicalLandingHash,
    formatJson,
    sanitizeLandingScenarioResponse,
} from './lib/landing-scenario-generation.js';
import { landingScenarios } from '../packages/web/src/data/landingScenarios.js';

const hasOwn = (value: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(value, key);

const createMessageResponse = (
    message: string,
    overrides: Partial<ChatMessageActionResponse['metadata']> = {}
): ChatMessageActionResponse => {
    const baseResponse = landingScenarios[0].response;

    return {
        ...baseResponse,
        message,
        metadata: {
            ...baseResponse.metadata,
            responseId: 'abcdefgh',
            chainHash: 'deadbeefdeadbeef',
            ...overrides,
        },
    };
};

test('canonical hash matches the checked-in landing fixture', () => {
    const scenario = landingScenarios[0];
    assert.equal(
        canonicalLandingHash(scenario.question, scenario.response.message),
        scenario.response.metadata.chainHash
    );
});

test('sanitizeLandingScenarioResponse rewrites prepared metadata', () => {
    const input = {
        scenario: LANDING_SCENARIO_PROMPTS[0],
        response: createMessageResponse('A prepared answer'),
        capturedResponseId: 'AbCdEf12',
        capturedChainHash: '0123456789abcdef',
        capturedAt: '2026-06-11T00:34:07.189Z',
        backendBaseUrl: 'http://localhost:3000',
        workflowModeId: 'balanced',
    } as const;

    const sanitized = sanitizeLandingScenarioResponse(input);

    assert.equal(sanitized.id, input.scenario.id);
    assert.equal(
        sanitized.response.metadata.responseId,
        `prepared-landing-${input.scenario.id}`
    );
    assert.equal(
        sanitized.response.metadata.chainHash,
        canonicalLandingHash(input.scenario.question, input.response.message)
    );
    assert.equal(
        sanitized.response.metadata.staleAfter,
        input.response.metadata.staleAfter
    );
    assert.equal(
        sanitized.response.metadata.modelVersion,
        input.response.metadata.modelVersion
    );
    assert.equal(hasOwn(sanitized, 'capture'), false);
    assert.equal(hasOwn(sanitized.response.metadata, 'workflow'), false);
    assert.equal(hasOwn(sanitized.response.metadata, 'execution'), false);
    assert.equal(
        hasOwn(sanitized.response.metadata, 'steerabilityControls'),
        false
    );
});

test('sanitizeLandingScenarioResponse rejects invalid landing ids', () => {
    assert.throws(
        () =>
            sanitizeLandingScenarioResponse({
                scenario: {
                    id: 'Bad ID',
                    question: 'Invalid',
                },
                response: createMessageResponse('A prepared answer'),
                capturedResponseId: 'AbCdEf12',
                capturedChainHash: '0123456789abcdef',
                capturedAt: '2026-06-11T00:34:07.189Z',
                backendBaseUrl: 'http://localhost:3000',
                workflowModeId: 'balanced',
            }),
        /Invalid landing scenario id/
    );
});

test('sanitizeLandingScenarioResponse rejects non-message responses', () => {
    assert.throws(
        () =>
            sanitizeLandingScenarioResponse({
                scenario: LANDING_SCENARIO_PROMPTS[0],
                response: {
                    action: 'react',
                    reaction: '👍',
                    metadata: null,
                } as never,
                capturedResponseId: 'AbCdEf12',
                capturedChainHash: '0123456789abcdef',
                capturedAt: '2026-06-11T00:34:07.189Z',
                backendBaseUrl: 'http://localhost:3000',
                workflowModeId: 'balanced',
            }),
        /Expected message action/
    );
});

test('buildChatRequest emits the landing capture payload shape', () => {
    const request = buildChatRequest(LANDING_SCENARIO_PROMPTS[1], {
        backendBaseUrl: 'http://localhost:3000',
        modeId: 'balanced',
    });

    assert.deepEqual(request, {
        surface: 'web',
        modeId: 'balanced',
        trigger: { kind: 'submit' },
        latestUserInput:
            'What does Footnote do differently from other AI tools?',
        conversation: [
            {
                role: 'user',
                content:
                    'What does Footnote do differently from other AI tools?',
            },
        ],
        capabilities: {
            canReact: false,
            canGenerateImages: false,
            canUseTts: false,
        },
        surfaceContext: {
            requestHost: 'localhost:3000',
        },
    });
});

test('buildLandingScenarioFixture merges the capture block into each scenario', () => {
    const scenario = LANDING_SCENARIO_PROMPTS[0];
    const response = createMessageResponse('A prepared answer');
    const fixture = buildLandingScenarioFixture({
        scenario,
        response,
        capturedResponseId: 'AbCdEf12',
        capturedChainHash: '0123456789abcdef',
        capturedAt: '2026-06-11T00:34:07.189Z',
        backendBaseUrl: 'http://localhost:3000',
        workflowModeId: 'balanced',
    });

    assert.deepEqual(fixture, {
        ...sanitizeLandingScenarioResponse({
            scenario,
            response,
            capturedResponseId: 'AbCdEf12',
            capturedChainHash: '0123456789abcdef',
            capturedAt: '2026-06-11T00:34:07.189Z',
            backendBaseUrl: 'http://localhost:3000',
            workflowModeId: 'balanced',
        }),
        capture: {
            generatedAt: '2026-06-11T00:34:07.189Z',
            backendBaseUrl: 'http://localhost:3000',
            workflowModeId: 'balanced',
            capturedResponseId: 'AbCdEf12',
            capturedChainHash: '0123456789abcdef',
        },
    });
    assert.deepEqual(fixture.capture, {
        generatedAt: '2026-06-11T00:34:07.189Z',
        backendBaseUrl: 'http://localhost:3000',
        workflowModeId: 'balanced',
        capturedResponseId: 'AbCdEf12',
        capturedChainHash: '0123456789abcdef',
    });
});

test('assertScenarioId enforces kebab-case ids', () => {
    assert.doesNotThrow(() => assertScenarioId('what-is-footnote'));
    assert.throws(
        () => assertScenarioId('what is footnote'),
        /Invalid landing scenario id/
    );
});

test('formatJson emits stable pretty JSON arrays with a trailing newline', () => {
    const input = [
        {
            id: 'what-is-footnote',
            capture: {
                generatedAt: '2026-06-11T00:34:07.189Z',
            },
        },
        {
            id: 'what-does-footnote-do-differently',
            capture: {
                generatedAt: '2026-06-11T00:34:07.190Z',
            },
        },
    ];
    const formatted = formatJson(input);

    assert.equal(formatted.endsWith('\n'), true);
    assert.equal(formatted.startsWith('[\n'), true);
    assert.deepEqual(JSON.parse(formatted), input);
});
