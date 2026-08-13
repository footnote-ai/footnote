/**
 * @description: Verifies style rewrite is a bounded workflow step, not direct post-processing.
 * @footnote-scope: test
 * @footnote-module: WorkflowStyleRewriteTests
 * @footnote-risk: high - Workflow placement and counters must remain truthful.
 * @footnote-ethics: high - A presentation step must fail open without changing main-answer authority.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type {
    GenerationRequest,
    GenerationResult,
    GenerationRuntime,
} from '@footnote/agent-runtime';
import type { ModelProfile } from '@footnote/contracts';
import { runBoundedReviewWorkflow } from '../src/services/workflowEngine.js';
import type { ReviewWorkflowUsageSummary } from '../src/services/workflowEngine.js';
import type { StyleRewriteConfig } from '../src/services/styleRewrite.js';

const profile: ModelProfile = {
    id: 'style',
    description: 'test',
    provider: 'openai',
    providerModel: 'gpt-5-mini',
    enabled: true,
    tierBindings: [],
    capabilities: { canUseSearch: false },
    maxInputTokens: 2000,
    maxOutputTokens: 500,
    costClass: 'low',
    latencyClass: 'low',
};
const config: StyleRewriteConfig = {
    enabled: true,
    profileId: profile.id,
    profile,
    validatorProfileId: profile.id,
    validatorProfile: profile,
    timeoutMs: 50,
    validatorTimeoutMs: 50,
    traceHmacSecret: 'workflow-style-rewrite-test-secret',
};
const generated: GenerationResult = {
    text: 'According to Ada Lovelace, the release has 12 fixes. It may not resolve every issue.',
    model: 'gpt-5-mini',
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    provenance: 'Inferred',
    citations: [],
};
const contextEnvelope = {
    participants: [],
    turns: [],
    diagnostics: {
        surface: 'web' as const,
        totalInputMessages: 0,
        projectedMessageCount: 0,
        trimmedMessageCount: 0,
        sanitizedTimestampCount: 0,
        projectedSpeakerLabelCount: 0,
    },
};
const policy = {
    enablePlanning: false,
    enableToolUse: false,
    enableReplanning: false,
    enableGeneration: true,
    enableAssessment: true,
    enableRevision: false,
};
const usage = (result: GenerationResult): ReviewWorkflowUsageSummary => ({
    model: result.model ?? 'gpt-5-mini',
    promptTokens: result.usage?.promptTokens ?? 0,
    completionTokens: result.usage?.completionTokens ?? 0,
    totalTokens: result.usage?.totalTokens ?? 0,
    estimatedCost: { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 },
});

test('successful workflow applies one style_rewrite lineage step and records separate costs', async () => {
    let calls = 0;
    const features: string[] = [];
    const runtime: GenerationRuntime = {
        kind: 'test',
        generate: async (_request: GenerationRequest) => {
            calls += 1;
            if (calls === 1) return generated;
            if (calls === 2)
                return {
                    ...generated,
                    text: '{"reviewDecision":"finalize","reviewReason":"Ready."}',
                };
            if (calls === 3)
                return {
                    ...generated,
                    text: 'According to Ada Lovelace, the release lists 12 fixes. It may not resolve every issue.',
                };
            return {
                ...generated,
                text: '{"verdict":"equivalent","reasons":[]}',
            };
        },
    };
    const result = await runBoundedReviewWorkflow({
        generationRuntime: runtime,
        generationRequest: { messages: [{ role: 'user', content: 'status' }] },
        messagesWithHints: [{ role: 'user', content: 'status' }],
        contextEnvelope,
        generationStartedAtMs: Date.now(),
        workflowConfig: {
            workflowName: 'test',
            maxIterations: 1,
            maxDurationMs: 1000,
            executionLimits: {
                maxWorkflowSteps: 3,
                maxToolCalls: 0,
                maxDeliberationCalls: 3,
                maxTokensTotal: 100,
                maxDurationMs: 1000,
            },
        },
        workflowPolicy: policy,
        captureUsage: (result, _model) => usage(result),
        styleRewrite: {
            config,
            persona: {
                id: 'myuri',
                presentationGuidance:
                    'Warm, lively, perceptive prose with situational wit.',
            },
            protectedContent: false,
            captureUsage: (result, _profile, feature) => {
                features.push(feature);
                return usage(result);
            },
        },
    });
    assert.equal(result.outcome, 'generated');
    if (result.outcome !== 'generated')
        throw new Error('Expected generated result.');
    assert.equal(
        result.styleRewrite?.outcome,
        'applied',
        JSON.stringify(result.workflowLineage)
    );
    assert.equal(
        result.generationResult.text,
        'According to Ada Lovelace, the release lists 12 fixes. It may not resolve every issue.'
    );
    assert.equal(
        result.workflowLineage.steps.at(-1)?.stepKind,
        'style_rewrite'
    );
    assert.deepEqual(features, ['chat_style_rewrite', 'chat_style_validation']);
});

test('protected and budget-exhausted workflows preserve the original answer', async () => {
    for (const candidate of [
        { protectedContent: true, maxDeliberationCalls: 2 },
        { protectedContent: false, maxDeliberationCalls: 1 },
    ]) {
        let calls = 0;
        const runtime: GenerationRuntime = {
            kind: 'test',
            generate: async () => {
                calls += 1;
                return generated;
            },
        };
        const result = await runBoundedReviewWorkflow({
            generationRuntime: runtime,
            generationRequest: {
                messages: [{ role: 'user', content: 'status' }],
            },
            messagesWithHints: [{ role: 'user', content: 'status' }],
            contextEnvelope,
            generationStartedAtMs: Date.now(),
            workflowConfig: {
                workflowName: 'test',
                maxIterations: 0,
                maxDurationMs: 1000,
                executionLimits: {
                    maxWorkflowSteps: 2,
                    maxToolCalls: 0,
                    maxDeliberationCalls: candidate.maxDeliberationCalls,
                    maxTokensTotal: 100,
                    maxDurationMs: 1000,
                },
            },
            workflowPolicy: { ...policy, enableAssessment: false },
            captureUsage: (result, _model) => usage(result),
            styleRewrite: {
                config,
                persona: {
                    id: 'footnote',
                    presentationGuidance: 'Clear neutral prose.',
                },
                protectedContent: candidate.protectedContent,
                captureUsage: (result, _profile, _feature) => usage(result),
            },
        });
        assert.equal(result.outcome, 'generated');
        if (result.outcome === 'generated')
            assert.equal(result.generationResult.text, generated.text);
        assert.equal(calls, 1);
    }
});
