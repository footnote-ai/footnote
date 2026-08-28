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
    runResponseComparison,
    type ComparisonDependencies,
    type ResponseComparisonConfig,
    type ResponseComparisonReport,
} from './lib/response-comparison.js';

const profile: ModelProfile = {
    id: 'writer',
    description: 'test writer',
    provider: 'openai',
    providerModel: 'gpt-5.6-luna',
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

test('loads the durable core reviewed case suite by name', () => {
    const loaded = loadResponseComparisonConfig(
        path.join(process.cwd(), 'response-comparison.yaml'),
        process.cwd()
    );
    assert.equal(loaded.config.cases.length, 6);
    assert.equal(loaded.config.models.length, 7);
    assert.equal(loaded.config.repeats, 2);
    assert.deepEqual(loaded.config.settings, ['default']);
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
    assert.match(html, /Requirements:/u);
    assert.match(html, /Source context/u);
    assert.match(html, /Resolved persona guidance/u);
    assert.match(html, /Not rated/u);
    assert.match(html, /Median output tokens \/ total second/u);
    assert.match(html, /Automatic review coverage/u);
    assert.match(html, /Generation cost/u);
    assert.match(html, /Reviewer name/u);
    assert.match(html, /Blind view/u);
    assert.match(html, /"latencyMs":10/u);
    assert.match(html, /\\u003cscript\\u003e/iu);
});
