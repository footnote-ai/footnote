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
import type { ModelProfile } from '../packages/contracts/src/index.js';
import {
    buildReportHtml,
    loadResponseComparisonConfig,
    parseResponseComparisonConfig,
    rawProfile,
    runResponseComparison,
    resolveModel,
    settingToRequest,
    type ComparisonDependencies,
    type ResponseComparisonConfig,
    type ResponseComparisonAutomaticReview,
    type ResponseComparisonReport,
} from './lib/response-comparison.js';

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
const fakeCandidate: ComparisonDependencies['runCandidate'] = async () => ({
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
    runCandidate: async (input) => {
        calls.value += 1;
        return fakeCandidate(input);
    },
});

test('rejects unknown YAML keys and accepts named intentional combinations', () => {
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
    const profileModel = parsed.models[0];
    const rawModel = parsed.models[1];
    const maxTokenSetting = parsed.settings[2];
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
        return fakeCandidate(input);
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

test('loads the editable campaign config without fixing its current matrix', () => {
    const loaded = loadResponseComparisonConfig(
        path.join(process.cwd(), 'response-comparison.yaml'),
        process.cwd()
    );
    assert.ok(loaded.config.cases.length > 0);
    assert.ok(loaded.config.models.length > 0);
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
    assert.match(html, /data-role','comparison-summary'/u);
    assert.match(
        html,
        /data-role',blind\?'blind-review':'operational-details'/u
    );
    assert.match(html, /data-role','human-review'/u);
    assert.match(html, /canonical-report/u);
    assert.match(html, /if\(!blind\)/u);
    assert.match(html, /parentReportId/u);
    assert.match(html, /action:'exported'/u);
    assert.match(html, /"attemptId":"a"/u);
    assert.match(html, /"expressionStrength":"balanced"/u);
    assert.match(html, /"latencyMs":10/u);
    assert.match(html, /\\u003cscript\\u003e/iu);
});
