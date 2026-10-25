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
import { PostChatRequestSchema } from '@footnote/contracts/web/schemas';
import type {
    ExecutionEvent,
    ProvenanceAssessment,
    SteerabilityControls,
    WorkflowRecord,
} from '@footnote/contracts/policy';
import {
    LANDING_SCENARIO_PROMPTS,
    assertConciseIntroductionResponse,
    assertScenarioId,
    buildChatRequest,
    buildLandingScenarioFixture,
    canonicalLandingHash,
    formatJson,
    mergeLandingScenarioFixtures,
    selectLandingScenarioPrompts,
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

test('scenario selection validates a known id before capture', () => {
    assert.equal(selectLandingScenarioPrompts([]).length, 6);
    assert.deepEqual(
        selectLandingScenarioPrompts([
            '--scenario-id',
            LANDING_SCENARIO_PROMPTS[0].id,
        ]),
        [LANDING_SCENARIO_PROMPTS[0]]
    );
    assert.throws(
        () => selectLandingScenarioPrompts(['--scenario-id', 'unknown']),
        /Unknown landing scenario id/
    );
    assert.throws(
        () => selectLandingScenarioPrompts(['--scenario-id']),
        /Expected no arguments/
    );
});

test('partial fixture update preserves every other captured scenario', () => {
    const existing = landingScenarios.map((scenario) => ({
        ...scenario,
        capture: {
            generatedAt: '2026-10-25T00:00:00.000Z',
            backendBaseUrl: 'http://localhost:3000',
            workflowModeId: 'balanced',
            capturedResponseId: scenario.response.metadata.responseId,
            capturedChainHash: scenario.response.metadata.chainHash,
        },
    }));
    const replacement = {
        ...existing[0]!,
        response: {
            ...existing[0]!.response,
            message: 'Newly captured answer',
        },
    };

    const merged = mergeLandingScenarioFixtures(existing, [replacement]);

    assert.equal(merged.length, existing.length);
    assert.deepEqual(merged[0], replacement);
    assert.deepEqual(merged.slice(1), existing.slice(1));
});

test('sanitizeLandingScenarioResponse rewrites prepared metadata', () => {
    const input = {
        scenario: LANDING_SCENARIO_PROMPTS[0],
        response: {
            ...createMessageResponse('A prepared answer'),
            answerProvenanceEligible: true,
            publicationToken: 'publication-token-must-not-escape',
        },
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
    assert.equal(hasOwn(sanitized.response, 'answerProvenanceEligible'), false);
    assert.equal(hasOwn(sanitized.response, 'publicationToken'), false);
    assert.deepEqual(
        sanitized.response.metadata.provenanceAssessment,
        input.response.metadata.provenanceAssessment
    );
    assert.deepEqual(
        sanitized.response.metadata.execution,
        input.response.metadata.execution
    );
    assert.deepEqual(
        sanitized.response.metadata.workflow,
        input.response.metadata.workflow
    );
    assert.deepEqual(
        sanitized.response.metadata.steerabilityControls,
        input.response.metadata.steerabilityControls
    );
});

test('sanitizeLandingScenarioResponse preserves captured workflow metadata', () => {
    const provenanceAssessment: ProvenanceAssessment = {
        methodId: 'deterministic_multi_signal_v1',
        methodLabel: 'Test provenance assessment',
        signals: {
            citationsPresent: false,
            retrievalRequested: false,
            retrievalUsed: false,
            retrievalToolExecuted: false,
            workflowEvidence: false,
            trustGraphEvidenceAvailable: false,
            trustGraphEvidenceUsed: false,
            assistantDeclaredSpeculative: false,
        },
        conflicts: [],
        limitations: [],
    };
    const execution: ExecutionEvent[] = [
        {
            kind: 'generation',
            status: 'executed',
        },
    ];
    const workflow: WorkflowRecord = {
        workflowId: 'workflow-test',
        workflowName: 'landing-test',
        status: 'completed',
        terminationReason: 'goal_satisfied',
        stepCount: 0,
        maxSteps: 1,
        maxDurationMs: 1000,
        steps: [],
    };
    const steerabilityControls: SteerabilityControls = {
        version: 'v1',
        controls: [],
    };
    const response = createMessageResponse('A prepared answer', {
        provenanceAssessment,
        execution,
        workflow,
        steerabilityControls,
    });

    const sanitized = sanitizeLandingScenarioResponse({
        scenario: LANDING_SCENARIO_PROMPTS[0],
        response,
        capturedResponseId: 'AbCdEf12',
        capturedChainHash: '0123456789abcdef',
        capturedAt: '2026-06-11T00:34:07.189Z',
        backendBaseUrl: 'http://localhost:3000',
        workflowModeId: 'balanced',
    });

    assert.deepEqual(
        sanitized.response.metadata.provenanceAssessment,
        provenanceAssessment
    );
    assert.deepEqual(sanitized.response.metadata.execution, execution);
    assert.deepEqual(sanitized.response.metadata.workflow, workflow);
    assert.deepEqual(
        sanitized.response.metadata.steerabilityControls,
        steerabilityControls
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

test('sanitizeLandingScenarioResponse rejects non-text message responses', () => {
    assert.throws(
        () =>
            sanitizeLandingScenarioResponse({
                scenario: LANDING_SCENARIO_PROMPTS[0],
                response: {
                    ...createMessageResponse('A prepared answer'),
                    modality: 'image',
                } as never,
                capturedResponseId: 'AbCdEf12',
                capturedChainHash: '0123456789abcdef',
                capturedAt: '2026-06-11T00:34:07.189Z',
                backendBaseUrl: 'http://localhost:3000',
                workflowModeId: 'balanced',
            }),
        /Expected text modality/
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
        latestUserInput: "What does Footnote do when it can't confirm a claim?",
        conversation: [
            {
                role: 'user',
                content: "What does Footnote do when it can't confirm a claim?",
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

test('introduction capture records its submitted prompt separately from the displayed question', () => {
    const scenario = LANDING_SCENARIO_PROMPTS[0];
    const submittedPrompt =
        'How does Footnote show its work? Write a concise, plain-language introduction explaining how the response footnote lets readers inspect supporting evidence and provenance. Aim for 40–70 words, but treat that as a soft editorial target: do not pad an already complete shorter answer or cut a complete explanation just to hit 70. Keep the response to no more than 100 words. Do not browse or invent sources.';
    const request = buildChatRequest(scenario, {
        backendBaseUrl: 'http://localhost:3000',
        modeId: 'express',
    });
    const response = createMessageResponse('A captured answer');
    const fixture = buildLandingScenarioFixture({
        scenario,
        response,
        capturedResponseId: 'AbCdEf12',
        capturedChainHash: '0123456789abcdef',
        capturedAt: '2026-06-11T00:34:07.189Z',
        backendBaseUrl: 'http://localhost:3000',
        workflowModeId: 'express',
    });

    assert.equal(scenario.question, 'How does Footnote show its work?');
    assert.equal(request.latestUserInput, submittedPrompt);
    assert.deepEqual(PostChatRequestSchema.parse(request), request);
    assert.deepEqual(request.conversation, [
        { role: 'user', content: submittedPrompt },
    ]);
    assert.equal(fixture.question, scenario.question);
    assert.equal(fixture.capture.capturedQuestion, submittedPrompt);
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
            capturedQuestion: scenario.submittedPrompt,
        },
    });
    assert.deepEqual(fixture.capture, {
        generatedAt: '2026-06-11T00:34:07.189Z',
        backendBaseUrl: 'http://localhost:3000',
        workflowModeId: 'balanced',
        capturedResponseId: 'AbCdEf12',
        capturedChainHash: '0123456789abcdef',
        capturedQuestion: scenario.submittedPrompt,
    });
});

test('assertScenarioId enforces kebab-case ids', () => {
    assert.doesNotThrow(() => assertScenarioId('what-is-footnote'));
    assert.throws(
        () => assertScenarioId('what is footnote'),
        /Invalid landing scenario id/
    );
});

test('introduction capture treats 40 to 70 words as an editorial target', () => {
    for (const wordCount of [35, 40, 70, 71, 100]) {
        assert.equal(
            assertConciseIntroductionResponse('word '.repeat(wordCount)),
            wordCount
        );
    }
    assert.throws(
        () => assertConciseIntroductionResponse('   '),
        /Expected the landing introduction to be non-empty/
    );
    assert.throws(
        () => assertConciseIntroductionResponse('word '.repeat(101)),
        /Expected the landing introduction to contain no more than 100 words/
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
