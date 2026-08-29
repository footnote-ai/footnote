/**
 * @description: Tests the response-comparison contract, checkpoint seam, and blind report rendering.
 * @footnote-scope: test
 * @footnote-module: ResponseComparisonTests
 * @footnote-risk: medium - Regressions can invalidate experiment evidence or expose hidden metadata.
 * @footnote-ethics: high - Blindness and preservation context are safeguards against biased review.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { GenerationRuntime } from '../packages/agent-runtime/src/index.js';
import type { PresentationResult } from '../packages/backend/src/services/presentation.js';
import type { ModelProfile } from '../packages/contracts/src/index.js';
import {
    createResponseComparisonProgressReporter,
    type ResponseComparisonProgressEvent,
} from './lib/response-comparison-progress.js';
import {
    buildReportHtml,
    classifyCandidateAvailability,
    detectCandidateChangeHints,
    loadResponseComparisonConfig,
    parseResponseComparisonConfig,
    readUnsupportedChangesReview,
    RESPONSE_COMPARISON_AUTOMATIC_REVIEW_INSTRUCTION,
    RESPONSE_COMPARISON_UNSUPPORTED_ADDITIONS_REQUIREMENT,
    applyOpenRouterCapabilities,
    rawProfile,
    runResponseComparison,
    resolveModel,
    responseComparisonAuthoritativeModel,
    selectResponseComparisonWorkflowCalls,
    settingToRequest,
    type ComparisonDependencies,
    type ResponseComparisonConfig,
    type ResponseComparisonAttempt,
    type ResponseComparisonAutomaticReview,
    type ResponseComparisonReport,
    type ResponseComparisonStage,
} from './lib/response-comparison.js';
import { buildAutomaticReviewer } from './responses-compare.js';

const profile: ModelProfile = {
    id: 'writer',
    description: 'test writer',
    provider: 'openai',
    providerModel: 'test-model',
    enabled: true,
    tierBindings: [],
    capabilities: {
        canUseSearch: false,
        supportedSamplingControls: ['temperature'],
    },
};

const config = (
    overrides: Partial<ResponseComparisonConfig> = {}
): ResponseComparisonConfig => ({
    version: 1,
    name: 'test',
    models: [{ profile: profile.id }],
    settings: ['default'],
    repeats: 1,
    cases: [
        {
            id: 'case',
            persona: 'footnote',
            expressionStrength: 'balanced',
            messages: [{ role: 'user', content: 'Say hello.' }],
            requirements: [
                { id: 'hello', kind: 'facts', statement: 'Keep the greeting.' },
            ],
        },
    ],
    review: { mustKeep: ['facts'], rate: ['naturalness'], blind: true },
    ...overrides,
});

const runtime: GenerationRuntime = {
    kind: 'test',
    generate: async () => ({ text: 'unused' }),
};
const fakeCandidate = async (): Promise<PresentationResult> => ({
    outcome: 'candidate_generated',
    draftResult: {
        text: '<script>alert(1)</script> Hello.',
        usage: { promptTokens: 2, completionTokens: 4, totalTokens: 6 },
        model: profile.providerModel,
        upstreamAttribution: {
            inferenceProvider: 'test-provider',
            resolvedModel: profile.providerModel,
        },
    },
    metadata: {
        step: 'presentation',
        flow: 'candidate_review',
        outcome: 'candidate_generated',
        attempted: true,
        reasonCode: 'candidate_generated',
        personaId: 'footnote',
        expressionStrength: 'balanced',
        expressionSource: 'request',
        draftAttemptCount: 1,
        draftObservedProvider: 'test-provider',
        draftObservedModel: profile.providerModel,
        presentationSettings: { requested: {}, forwarded: {}, omitted: [] },
    },
});

const deps = (calls: { value: number }): ComparisonDependencies => ({
    profiles: new Map([[profile.id, profile]]),
    generationRuntime: runtime,
    runCandidate: async () => {
        calls.value += 1;
        return fakeCandidate();
    },
});

test('rejects unknown config keys and keeps named setting variants', () => {
    assert.throws(
        () => parseResponseComparisonConfig({ ...config(), unexpected: true }),
        /unknown key/iu
    );
    assert.doesNotThrow(() =>
        parseResponseComparisonConfig(
            config({
                settings: [
                    { name: 'expressive', temperature: 0.2, verbosity: 'low' },
                ],
            })
        )
    );
    const parsed = parseResponseComparisonConfig(
        config({
            models: [
                { profile: profile.id },
                { name: 'raw', provider: 'openai', model: 'raw-model' },
            ],
            settings: [
                'default',
                { temperature: 0.2 },
                { maxOutputTokens: 128 },
            ],
        })
    );
    const parsedModels = parsed.models ?? [];
    const parsedSettings = parsed.settings ?? [];
    const profileModel = parsedModels[0];
    const rawModel = parsedModels[1];
    const maxTokenSetting = parsedSettings[2];
    if (
        profileModel === undefined ||
        rawModel === undefined ||
        maxTokenSetting === undefined
    )
        throw new Error('Parsed comparison fixtures lost expected entries.');
    if (!('name' in rawModel))
        throw new Error('Raw comparison model did not retain its name.');
    assert.equal(
        resolveModel(profileModel, new Map([[profile.id, profile]]))?.id,
        profile.id
    );
    assert.equal(rawProfile(rawModel).providerModel, 'raw-model');
    assert.deepEqual(settingToRequest(maxTokenSetting), {
        maxOutputTokens: 128,
    });
});

test('accepts campaign-level authority and reviewer settings without catalog profiles', () => {
    const rawModel = {
        name: 'GPT-5.6 Terra via OpenRouter',
        provider: 'openrouter' as const,
        model: 'openai/gpt-5.6-terra',
    };
    const parsed = parseResponseComparisonConfig({
        version: 2,
        name: 'raw-authority',
        authority: {
            model: rawModel,
            reasoningEffort: 'medium',
        },
        conditions: [
            {
                id: 'authority-only',
            },
        ],
        repeats: 1,
        cases: config().cases,
        review: {
            mustKeep: ['facts'],
            rate: ['naturalness'],
            automaticReviewer: {
                model: rawModel,
                reasoningEffort: 'medium',
            },
            blind: true,
        },
    });

    const condition = parsed.conditions?.[0];
    assert.ok(condition);
    assert.deepEqual(responseComparisonAuthoritativeModel(parsed), rawModel);
    assert.equal(parsed.authority?.reasoningEffort, 'medium');
    assert.deepEqual(parsed.review.automaticReviewer?.model, rawModel);
    assert.equal(parsed.review.automaticReviewer?.reasoningEffort, 'medium');
});

test('applies OpenRouter discovery capabilities only to ephemeral comparison profiles', () => {
    const openRouterProfile = rawProfile({
        name: 'Terra via OpenRouter',
        provider: 'openrouter',
        model: 'openai/gpt-5.6-terra',
    });
    const prepared = applyOpenRouterCapabilities(openRouterProfile, {
        supportedParameters: ['structured_outputs', 'temperature', 'top_p'],
        reasoning: {
            mandatory: false,
            supportedEfforts: ['low', 'medium'],
        },
    });
    assert.deepEqual(prepared.capabilities.supportedSamplingControls, [
        'temperature',
        'topP',
    ]);
    assert.equal(
        prepared.capabilities.toolCapabilities?.[
            'routing.generation.structured-cheap'
        ],
        true
    );
    assert.deepEqual(prepared.capabilities.supportedReasoningEfforts, [
        'low',
        'medium',
    ]);
    assert.deepEqual(
        applyOpenRouterCapabilities(openRouterProfile, {
            reasoning: { mandatory: true },
        }).capabilities.supportedReasoningEfforts,
        []
    );

    const directOpenAI: ModelProfile = {
        ...profile,
        provider: 'openai',
    };
    assert.deepEqual(
        applyOpenRouterCapabilities(directOpenAI, {
            supportedParameters: ['structured_outputs', 'temperature'],
        }),
        directOpenAI
    );
});

test('flags possible candidate changes without rejecting the response', () => {
    const changes = detectCandidateChangeHints({
        candidateText:
            'The result is 99. See https://untrusted.example/source. Therefore, the policy should recommend this.',
        authoritativeContext: [
            { role: 'system', content: 'The observed result is unknown.' },
        ],
    });

    assert.equal(changes.detected, true);
    assert.match(changes.evidence.join(' | '), /99/u);
    assert.match(changes.evidence.join(' | '), /untrusted\.example/u);

    const clean = detectCandidateChangeHints({
        candidateText: 'A concise expression of the supplied result.',
        authoritativeContext: [
            { role: 'system', content: 'The supplied result is known.' },
        ],
    });
    assert.equal(clean.detected, false);
    assert.equal(clean.method, 'heuristic');
});

test('classifies empty and provider artifact candidates as unavailable', () => {
    assert.equal(
        classifyCandidateAvailability({
            status: 'completed',
            text: 'A useful answer.',
        }),
        'usable'
    );
    assert.equal(
        classifyCandidateAvailability({ status: 'completed', text: '' }),
        'unavailable'
    );
    assert.equal(
        classifyCandidateAvailability({
            status: 'completed',
            text: 'CTION END',
        }),
        'unavailable'
    );
    assert.equal(
        classifyCandidateAvailability({
            status: 'failed',
            failure: 'provider error',
        }),
        'unavailable'
    );
    assert.equal(
        classifyCandidateAvailability({ status: 'not_run' }),
        'not_attempted'
    );
});

test('keeps revision calls separate and selects the revised output as final', () => {
    const selected = selectResponseComparisonWorkflowCalls([
        { stage: 'candidate' },
        { stage: 'authoritative' },
        { stage: 'assessment' },
        { stage: 'revision' },
        { stage: 'assessment' },
    ]);

    assert.equal(selected.authoritativeCall?.stage, 'authoritative');
    assert.equal(selected.revisionCalls.length, 1);
    assert.equal(selected.finalCall?.stage, 'revision');
});

test('unsupported-changes review distinguishes surviving additions from removal', () => {
    const review: ResponseComparisonAutomaticReview = {
        reviewer: { profile: 'reviewer' },
        promptHash: 'prompt',
        schemaHash: 'schema',
        instruction: 'Review the final answer.',
        schema: { type: 'object' },
        status: 'completed',
        mustKeep: [
            {
                requirementId: 'unsupported-additions',
                result: 'fail',
                explanation: 'The invented result survived.',
            },
        ],
        ratings: [],
    };
    assert.equal(readUnsupportedChangesReview(review).status, 'fail');
    assert.equal(
        readUnsupportedChangesReview({
            ...review,
            mustKeep: [
                {
                    requirementId: 'unsupported-additions',
                    result: 'pass',
                    explanation: 'The invented result was removed.',
                },
            ],
        }).status,
        'pass'
    );
});

test('treats unsupported additions as material and task-sensitive', () => {
    assert.match(
        RESPONSE_COMPARISON_UNSUPPORTED_ADDITIONS_REQUIREMENT.statement,
        /material unsupported/iu
    );
    assert.match(
        RESPONSE_COMPARISON_UNSUPPORTED_ADDITIONS_REQUIREMENT.statement,
        /general knowledge/iu
    );
    assert.match(
        RESPONSE_COMPARISON_UNSUPPORTED_ADDITIONS_REQUIREMENT.statement,
        /safety guidance/iu
    );
    assert.match(
        RESPONSE_COMPARISON_AUTOMATIC_REVIEW_INSTRUCTION,
        /do not treat it as an exhaustive knowledge base/iu
    );
    assert.match(
        RESPONSE_COMPARISON_AUTOMATIC_REVIEW_INSTRUCTION,
        /material unsupported claim/iu
    );
});

test('runs independent variants and resumes from checkpoints', async () => {
    const checkpointRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'response-comparison-')
    );
    const calls = { value: 0 };
    const first = await runResponseComparison({
        configPath: 'test.yaml',
        checkpointRoot,
        command: 'test',
        config: config({
            settings: ['default', { temperature: 0.2 }],
            repeats: 2,
        }),
        configHash: crypto.createHash('sha256').update('test').digest('hex'),
        dependencies: deps(calls),
    });
    assert.equal(first.attempts.length, 4);
    assert.equal(calls.value, 4);
    const second = await runResponseComparison({
        configPath: 'test.yaml',
        checkpointRoot,
        command: 'test',
        config: config({
            settings: ['default', { temperature: 0.2 }],
            repeats: 2,
        }),
        configHash: crypto.createHash('sha256').update('test').digest('hex'),
        dependencies: deps(calls),
    });
    assert.equal(second.attempts.length, 4);
    assert.equal(calls.value, 8);
    assert.notEqual(second.reportId, first.reportId);
});

test('resumes an interrupted run from its active pointer', async () => {
    const checkpointRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'response-comparison-interrupted-')
    );
    const calls = { value: 0 };
    const interruptedConfig = config({ repeats: 1 });
    const configHash = crypto
        .createHash('sha256')
        .update('interrupted')
        .digest('hex');
    const interrupted = await runResponseComparison({
        configPath: 'test.yaml',
        checkpointRoot,
        command: 'test',
        config: interruptedConfig,
        configHash,
        dependencies: deps(calls),
    });

    const checkpoint = path.join(
        checkpointRoot,
        interrupted.reportId,
        'checkpoint.jsonl'
    );
    fs.writeFileSync(
        checkpoint,
        `${interrupted.attempts.map((attempt) => JSON.stringify(attempt)).join('\n')}\n`,
        'utf8'
    );
    fs.writeFileSync(
        path.join(checkpointRoot, `${configHash}.active`),
        `${interrupted.reportId}\n`,
        'utf8'
    );

    const resumed = await runResponseComparison({
        configPath: 'test.yaml',
        checkpointRoot,
        command: 'test',
        config: interruptedConfig,
        configHash,
        dependencies: deps(calls),
    });

    assert.equal(resumed.attempts.length, interrupted.attempts.length);
    assert.equal(calls.value, 1);
    assert.equal(resumed.reportId, interrupted.reportId);
});

test('records support gaps, provider failures, and review evidence without calling unsupported variants', async () => {
    const checkpointRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'response-comparison-outcomes-')
    );
    const generatedSettings: Array<number | undefined> = [];
    const automaticReview: ResponseComparisonAutomaticReview = {
        reviewer: {
            profile: 'test-reviewer',
            provider: 'openai',
            model: 'test-reviewer-model',
        },
        promptHash: 'prompt-hash',
        schemaHash: 'schema-hash',
        instruction: 'Check the supplied response.',
        schema: { type: 'object', properties: {} },
        status: 'completed',
        mustKeep: [
            {
                requirementId: 'hello',
                result: 'pass',
                explanation: 'The greeting is present.',
                evidence: 'Hello.',
            },
        ],
        ratings: [
            {
                dimension: 'naturalness',
                score: 4,
                rationale: 'The response is direct.',
                evidence: 'Hello.',
            },
        ],
        timing: { latencyMs: 5, costUsd: 0.001 },
    };
    const runCandidate: ComparisonDependencies['runCandidate'] = async (
        input
    ) => {
        generatedSettings.push(input.generationRequest.temperature);
        if (input.generationRequest.temperature === 0.4)
            throw new Error('provider generation failed');
        return fakeCandidate();
    };
    const support: NonNullable<
        ComparisonDependencies['checkProviderSupport']
    > = async (_candidateProfile, settings) => {
        if (settings.temperature === 0.2)
            return {
                checkedAt: new Date(0).toISOString(),
                source: 'catalog_profile',
                modelId: profile.providerModel,
                status: 'unsupported',
                reasonCode: 'temperature_not_supported',
            };
        if (settings.temperature === 0.3)
            throw new Error('provider support check failed');
        return {
            checkedAt: new Date(0).toISOString(),
            source: 'catalog_profile',
            modelId: profile.providerModel,
            status: 'supported',
        };
    };
    const report = await runResponseComparison({
        configPath: 'test.yaml',
        checkpointRoot,
        command: 'test',
        config: config({
            settings: [
                'default',
                { temperature: 0.2 },
                { temperature: 0.3 },
                { temperature: 0.4 },
            ],
        }),
        configHash: crypto
            .createHash('sha256')
            .update('outcomes')
            .digest('hex'),
        dependencies: {
            profiles: new Map([[profile.id, profile]]),
            generationRuntime: runtime,
            runCandidate,
            checkProviderSupport: support,
            automaticReviewer: async () => automaticReview,
        },
    });

    const byTemperature = (temperature: number | undefined) =>
        report.attempts.find((attempt) =>
            typeof attempt.setting === 'object'
                ? attempt.setting.temperature === temperature
                : temperature === undefined && attempt.setting === 'default'
        );
    assert.equal(byTemperature(undefined)?.status, 'completed');
    assert.equal(byTemperature(0.2)?.status, 'not_tested');
    assert.equal(
        byTemperature(0.2)?.support?.reasonCode,
        'temperature_not_supported'
    );
    assert.equal(byTemperature(0.3)?.status, 'not_tested');
    assert.equal(
        byTemperature(0.3)?.support?.reasonCode,
        'provider_support_check_failed'
    );
    assert.equal(byTemperature(0.4)?.status, 'failed');
    assert.equal(byTemperature(0.4)?.reason, 'provider generation failed');
    assert.deepEqual(generatedSettings, [undefined, 0.4]);
    assert.equal(
        byTemperature(undefined)?.automaticReview?.status,
        'completed'
    );
    assert.equal(
        byTemperature(undefined)?.automaticReview?.reviewer.model,
        'test-reviewer-model'
    );
    assert.equal(
        byTemperature(undefined)?.settingsEvidence?.forwarded.temperature,
        undefined
    );
    assert.equal(
        byTemperature(undefined)?.attribution?.observedProvider,
        'test-provider'
    );
});

test('automatic review uses configured reasoning and structured output', async () => {
    let seenRequest: Parameters<GenerationRuntime['generate']>[0] | undefined;
    const reviewer = buildAutomaticReviewer({
        profile: {
            ...profile,
            id: 'comparison-reviewer',
            provider: 'openrouter',
            providerModel: 'anthropic/claude-sonnet-5',
        },
        name: 'Claude Sonnet 5 via OpenRouter',
        reasoningEffort: 'medium',
        runtime: {
            kind: 'test',
            generate: async (request) => {
                seenRequest = request;
                return {
                    text: JSON.stringify({
                        mustKeep: [],
                        ratings: [
                            {
                                dimension: 'naturalness',
                                score: 3,
                                rationale: 'Readable.',
                                evidence: 'The final answer.',
                            },
                        ],
                    }),
                };
            },
        },
        rate: ['naturalness'],
    });
    const attempt = {
        output: { text: 'The final answer.' },
        source: {
            messages: [{ role: 'user', content: 'Answer the question.' }],
            persona: 'footnote',
            resolvedGuidance: 'Be direct.',
            expressionGuidance: 'Use a restrained voice.',
            expressionStrength: 'balanced',
            guidanceHash: 'guidance',
            requirements: [],
            reviewRequirements: [],
        },
    } as unknown as ResponseComparisonAttempt;

    const review = await reviewer(attempt);

    assert.equal(review?.status, 'completed');
    assert.equal(review?.reviewer.reasoningEffort, 'medium');
    assert.equal(seenRequest?.provider, 'openrouter');
    assert.equal(seenRequest?.model, 'anthropic/claude-sonnet-5');
    assert.equal(seenRequest?.reasoningEffort, 'medium');
    assert.equal(
        seenRequest?.structuredOutput?.name,
        'response-comparison-review'
    );
    assert.equal(
        seenRequest?.structuredOutput?.schema.additionalProperties,
        false
    );
});

test('runs all 84 campaign attempts and records every stage', async () => {
    const checkpointRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'response-comparison-pipeline-')
    );
    const authority: ModelProfile = {
        ...profile,
        id: 'authority',
        providerModel: 'authority-model',
    };
    const cases = Array.from({ length: 6 }, (_, index) => ({
        id: `case-${index + 1}`,
        persona: 'footnote',
        expressionStrength: 'balanced' as const,
        messages: [{ role: 'user' as const, content: `Case ${index + 1}.` }],
        requirements: [
            {
                id: `fact-${index + 1}`,
                kind: 'facts' as const,
                statement: 'Keep the supplied fact.',
            },
        ],
    }));
    const conditions = [
        {
            id: 'authority-only',
        },
        ...['cydonia', 'deepseek'].flatMap((model) => [
            {
                id: `${model}-faithful-preserve`,
                candidateModel: { profile: profile.id },
                candidatePromptVariant: 'faithful-rewrite' as const,
                handoffVariant: 'preserve-candidate' as const,
            },
            {
                id: `${model}-style-preserve`,
                candidateModel: { profile: profile.id },
                candidatePromptVariant: 'style-sketch' as const,
                handoffVariant: 'preserve-candidate' as const,
            },
            {
                id: `${model}-style-reference`,
                candidateModel: { profile: profile.id },
                candidatePromptVariant: 'style-sketch' as const,
                handoffVariant: 'style-reference' as const,
            },
        ]),
    ];
    const pipelineConfig: ResponseComparisonConfig = {
        version: 2,
        name: 'pipeline-test',
        authority: {
            model: { profile: authority.id },
            reasoningEffort: 'medium',
        },
        conditions,
        repeats: 2,
        cases,
        review: {
            mustKeep: ['facts', 'unsupported_additions'],
            rate: ['naturalness'],
            blind: true,
        },
    };
    const progress: ResponseComparisonProgressEvent[] = [];
    const runWorkflow: NonNullable<
        ComparisonDependencies['runWorkflow']
    > = async ({ condition, authoritativeReasoningEffort, onStage }) => {
        assert.equal(authoritativeReasoningEffort, 'medium');
        if (condition.candidateModel !== undefined) {
            onStage?.({ stage: 'candidate', status: 'running' });
            onStage?.({
                stage: 'candidate',
                status: 'completed',
                durationMs: 100,
            });
        }
        onStage?.({ stage: 'authoritative', status: 'running' });
        onStage?.({
            stage: 'authoritative',
            status: 'completed',
            durationMs: 100,
        });
        onStage?.({ stage: 'assessment', status: 'running' });
        onStage?.({
            stage: 'assessment',
            status: 'completed',
            durationMs: 100,
            decision: 'revise',
        });
        onStage?.({ stage: 'revision', status: 'running' });
        onStage?.({ stage: 'revision', status: 'completed', durationMs: 100 });
        return {
            candidate:
                condition.candidateModel === undefined
                    ? { status: 'not_run' }
                    : {
                          status: 'completed',
                          text: 'A candidate expression sketch with an unsupported number: 99.',
                          operations: {
                              promptTokens: 2,
                              completionTokens: 3,
                              totalTokens: 5,
                              costUsd: 0.01,
                          },
                      },
            authoritative: {
                status: 'completed',
                text: 'The authoritative answer.',
                operations: {
                    promptTokens: 4,
                    completionTokens: 5,
                    totalTokens: 9,
                    costUsd: 0.02,
                },
            },
            final: {
                status: 'completed',
                text: 'The final answer without the unsupported number.',
                operations: {
                    promptTokens: 6,
                    completionTokens: 7,
                    totalTokens: 13,
                    costUsd: 0.03,
                },
            },
            revisions: [
                {
                    status: 'completed',
                    text: 'The final answer without the unsupported number.',
                    operations: {
                        promptTokens: 6,
                        completionTokens: 7,
                        totalTokens: 13,
                        costUsd: 0.03,
                    },
                },
            ],
            candidateAvailability:
                condition.candidateModel === undefined
                    ? 'not_attempted'
                    : 'usable',
            correctionDecisions: [
                {
                    stage: 'assessment',
                    decision: 'revise',
                    reason: 'Remove unsupported additions.',
                    instruction: 'Keep only supported content.',
                },
            ],
            candidateChangeHint:
                condition.candidateModel === undefined
                    ? { detected: false, evidence: [] }
                    : {
                          detected: true,
                          evidence: ['candidate introduced numeric result 99'],
                      },
        };
    };
    const automaticReviewer = async (
        attempt: ResponseComparisonAttempt
    ): Promise<ResponseComparisonAutomaticReview> => ({
        reviewer: { profile: 'reviewer' },
        promptHash: 'prompt',
        schemaHash: 'schema',
        instruction: 'Review the final answer.',
        schema: { type: 'object' },
        status: 'completed',
        mustKeep: attempt.source.reviewRequirements.map((requirement) => ({
            requirementId: requirement.id,
            result: 'pass' as const,
            explanation: 'The final answer is supported.',
        })),
        ratings: [
            {
                dimension: 'naturalness',
                score: 4,
                rationale: 'Readable.',
            },
        ],
    });
    const report = await runResponseComparison({
        configPath: 'response-comparison/config.yaml',
        checkpointRoot,
        command: 'test',
        config: pipelineConfig,
        configHash: 'pipeline-config',
        dependencies: {
            profiles: new Map([
                [profile.id, profile],
                [authority.id, authority],
            ]),
            generationRuntime: runtime,
            runCandidate: async () => fakeCandidate(),
            runWorkflow,
            automaticReviewer,
            onProgress: (event) => progress.push(event),
        },
    });

    assert.equal(report.attempts.length, 84);
    assert.equal(
        report.attempts.filter((attempt) => attempt.status === 'completed')
            .length,
        84
    );
    const authorityOnly = report.attempts.find(
        (attempt) => attempt.condition?.id === 'authority-only'
    );
    assert.equal(authorityOnly?.stages?.candidate.status, 'not_run');
    assert.equal(
        authorityOnly?.stages?.final.text,
        'The final answer without the unsupported number.'
    );
    assert.equal(
        authorityOnly?.source.reviewRequirements.some(
            (requirement) => requirement.id === 'unsupported-additions'
        ),
        true
    );
    const styleReference = report.attempts.find(
        (attempt) => attempt.condition?.id === 'cydonia-style-reference'
    );
    assert.equal(styleReference?.condition?.handoffVariant, 'style-reference');
    assert.equal(styleReference?.candidateChangeHint?.detected, true);
    assert.equal(styleReference?.status, 'completed');
    assert.equal(styleReference?.unsupportedChangesReview?.status, 'pass');
    assert.equal(styleReference?.operations?.totalTokens, 27);
    assert.equal(styleReference?.correctionDecisions?.[0]?.decision, 'revise');
    assert.equal(styleReference?.candidateAvailability, 'usable');
    assert.equal(styleReference?.stages?.revisions?.length, 1);
    assert.equal(
        progress.filter((event) => event.kind === 'attempt_started').length,
        84
    );
    assert.equal(
        progress.filter((event) => event.kind === 'attempt_finished').length,
        84
    );
    assert.equal(
        progress.some(
            (event) =>
                event.kind === 'stage_finished' &&
                event.stage === 'assessment' &&
                event.decision === 'revise'
        ),
        true
    );
});

test('loads the checked-in campaign without repeating authority settings per condition', () => {
    const loaded = loadResponseComparisonConfig(
        path.join(process.cwd(), 'response-comparison/config.yaml'),
        process.cwd()
    );
    assert.ok(loaded.config.cases.length > 0);
    assert.equal(loaded.config.conditions?.length, 7);
    assert.equal(loaded.config.repeats, 2);
    assert.deepEqual(
        loaded.config.conditions?.map((condition) => condition.id),
        [
            'authority-only',
            'cydonia-faithful-preserve',
            'cydonia-style-preserve',
            'cydonia-style-reference',
            'deepseek-faithful-preserve',
            'deepseek-style-preserve',
            'deepseek-style-reference',
        ]
    );
    assert.deepEqual(loaded.config.authority, {
        model: {
            name: 'GPT-5.6 Terra via OpenRouter',
            provider: 'openrouter',
            model: 'openai/gpt-5.6-terra',
        },
        reasoningEffort: 'medium',
    });
    assert.deepEqual(loaded.config.review.automaticReviewer, {
        model: {
            name: 'Claude Sonnet 5 via OpenRouter',
            provider: 'openrouter',
            model: 'anthropic/claude-sonnet-5',
        },
        reasoningEffort: 'medium',
    });
});

test('keeps live progress compact while showing the active models and stage', () => {
    const lines: string[] = [];
    const reportProgress = createResponseComparisonProgressReporter({
        write: (line) => lines.push(line),
    });
    const base = {
        attemptIndex: 17,
        totalAttempts: 84,
        conditionId: 'cydonia-style-reference',
        caseId: 'source-boundary',
        repeat: 1,
        repeatCount: 2,
    } satisfies Omit<
        Extract<ResponseComparisonProgressEvent, { kind: 'attempt_started' }>,
        'kind' | 'candidateLabel' | 'authoritativeLabel'
    >;
    reportProgress({
        kind: 'attempt_started',
        ...base,
        candidateLabel: 'Cydonia 24B V4.1',
        authoritativeLabel: 'openai-text-medium/gpt-5.6-terra',
    });
    reportProgress({ kind: 'stage_started', ...base, stage: 'candidate' });
    reportProgress({
        kind: 'stage_finished',
        ...base,
        stage: 'candidate',
        status: 'completed',
        durationMs: 4800,
    });
    reportProgress({ kind: 'stage_started', ...base, stage: 'assessment' });
    reportProgress({
        kind: 'stage_finished',
        ...base,
        stage: 'assessment',
        status: 'completed',
        durationMs: 100,
        decision: 'revise',
    });
    reportProgress({
        kind: 'attempt_finished',
        ...base,
        status: 'completed',
        durationMs: 10400,
        costUsd: 0.0041,
        completedAttempts: 17,
        failedAttempts: 0,
        notTestedAttempts: 0,
        remainingAttempts: 67,
    });
    reportProgress({
        kind: 'stage_finished',
        ...base,
        stage: 'candidate',
        status: 'failed',
        durationMs: 30000,
        reason: 'draft_timeout',
    });
    assert.deepEqual(lines, [
        '[17/84] cydonia-style-reference · source-boundary · repeat 1/2',
        '  Models: Cydonia 24B V4.1 → openai-text-medium/gpt-5.6-terra',
        '  candidate     running',
        '  candidate     done · 4.8s',
        '  assessment    running',
        '  assessment    revise · 0.1s',
        '  completed     10.4s · $0.0041 · overall 17/84 (0 failed, 67 left)',
        '  candidate     TIMEOUT · 30.0s · draft_timeout',
    ]);
});

test('labels an authority-only attempt without printing skipped stage rows', () => {
    const lines: string[] = [];
    const reportProgress = createResponseComparisonProgressReporter({
        write: (line) => lines.push(line),
    });
    reportProgress({
        kind: 'attempt_started',
        attemptIndex: 1,
        totalAttempts: 84,
        conditionId: 'authority-only',
        caseId: 'technical-explanation',
        repeat: 1,
        repeatCount: 2,
        authoritativeLabel: 'GPT-5.6 Terra via OpenRouter',
    });

    assert.deepEqual(lines, [
        '[1/84] authority-only · technical-explanation · repeat 1/2',
        '  Models: no candidate → GPT-5.6 Terra via OpenRouter',
    ]);
});

test('keeps per-stage workflow failures visible without blocking later evidence', async () => {
    const checkpointRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'response-comparison-stage-failures-')
    );
    const authority: ModelProfile = {
        ...profile,
        id: 'authority',
        providerModel: 'authority-model',
    };
    const item = {
        id: 'failure-case',
        persona: 'footnote',
        expressionStrength: 'balanced' as const,
        messages: [{ role: 'user' as const, content: 'Keep this answer.' }],
        requirements: [
            {
                id: 'fact',
                kind: 'facts' as const,
                statement: 'Keep the supplied fact.',
            },
        ],
    };
    const baseConfig: ResponseComparisonConfig = {
        version: 2,
        name: 'stage-failures',
        authority: { model: { profile: authority.id } },
        conditions: [
            {
                id: 'failure-condition',
                candidateModel: { profile: profile.id },
                candidatePromptVariant: 'style-sketch',
                handoffVariant: 'style-reference',
            },
        ],
        repeats: 1,
        cases: [item],
        review: { mustKeep: ['facts'], rate: [], blind: true },
    };
    const run = async (
        finalStatus: ResponseComparisonStage['status']
    ): Promise<ResponseComparisonAttempt> => {
        const report = await runResponseComparison({
            configPath: 'response-comparison/config.yaml',
            checkpointRoot: fs.mkdtempSync(
                path.join(checkpointRoot, `${finalStatus}-`)
            ),
            command: 'test',
            config: baseConfig,
            configHash: `stage-${finalStatus}`,
            dependencies: {
                profiles: new Map([
                    [profile.id, profile],
                    [authority.id, authority],
                ]),
                generationRuntime: runtime,
                runCandidate: async () => fakeCandidate(),
                runWorkflow: async () => ({
                    candidate: {
                        status: 'failed',
                        failure: 'candidate provider failed',
                    },
                    authoritative: {
                        status: 'completed',
                        text: 'The authoritative answer.',
                    },
                    final:
                        finalStatus === 'completed'
                            ? {
                                  status: 'completed' as const,
                                  text: 'The final answer.',
                              }
                            : {
                                  status: 'failed' as const,
                                  failure: 'final provider failed',
                              },
                    revisions: [],
                    candidateAvailability: 'unavailable',
                    correctionDecisions: [],
                    candidateChangeHint: { detected: false, evidence: [] },
                }),
            },
        });
        return report.attempts[0];
    };
    const completed = await run('completed');
    assert.equal(completed.status, 'completed');
    assert.equal(
        completed.stages?.candidate.failure,
        'candidate provider failed'
    );
    assert.equal(completed.stages?.authoritative.status, 'completed');
    const failed = await run('failed');
    assert.equal(failed.status, 'failed');
    assert.equal(failed.stages?.final.failure, 'final provider failed');
});

test('blind report retains judgment context, escapes candidate text, and hides operational metadata', () => {
    const report: ResponseComparisonReport = {
        schemaVersion: 1,
        reportId: 'abc',
        createdAt: new Date(0).toISOString(),
        command: 'test',
        configPath: 'test.yaml',
        configHash: 'hash',
        dependencies: {},
        config: config(),
        attempts: [
            {
                attemptId: 'a',
                comparisonId: 'a',
                model: { profile: 'writer' },
                setting: 'default',
                caseId: 'case',
                repeat: 1,
                status: 'completed',
                source: {
                    messages: [{ role: 'user', content: 'Say hello.' }],
                    persona: 'footnote',
                    resolvedGuidance: 'guidance',
                    expressionGuidance: 'expression guidance',
                    expressionStrength: 'balanced',
                    guidanceHash: 'guidance-hash',
                    requirements: config().cases[0].requirements,
                    reviewRequirements: config().cases[0].requirements,
                },
                output: { text: '<script>alert(1)</script> Hello.' },
                operations: { latencyMs: 10, costUsd: 1 },
            },
        ],
        humanReviews: [],
        blindnessEvents: [],
    };
    const html = buildReportHtml(report);
    assert.match(html, /data-role',\s*'comparison-summary'/u);
    assert.match(
        html,
        /data-role',\s*blind\s*\?\s*'blind-review'\s*:\s*'operational-details'/u
    );
    assert.match(html, /data-role',\s*'human-review'/u);
    assert.match(html, /canonical-report/u);
    assert.match(html, /if \(!blind\)/u);
    assert.match(html, /parentReportId/u);
    assert.match(html, /action:\s*'exported'/u);
    assert.match(html, /Candidate availability/u);
    assert.match(html, /Possible candidate changes/u);
    assert.match(html, /"attemptId":"a"/u);
    assert.match(html, /"expressionStrength":"balanced"/u);
    assert.match(html, /"latencyMs":10/u);
    assert.match(html, /\\u003cscript\\u003e/iu);
});
