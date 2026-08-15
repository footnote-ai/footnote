/**
 * @description: Verifies the workflow invokes draft-first presentation before final main-model wording.
 * @footnote-scope: test
 * @footnote-module: WorkflowPresentationTests
 * @footnote-risk: high - A reversed call order would restore plain-answer-first behavior.
 * @footnote-ethics: high - Workflow tracing must make the presentation path visible without exposing response text.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type {
    GenerationRequest,
    GenerationResult,
    GenerationRuntime,
} from '@footnote/agent-runtime';
import type { ModelProfile } from '@footnote/contracts';
import {
    runBoundedReviewWorkflow,
    type ReviewWorkflowUsageSummary,
} from '../src/services/workflowEngine.js';
import type { PresentationConfig } from '../src/services/presentation.js';
import type { ConversationContextEnvelope } from '../src/services/conversationContextService.js';

const profile: ModelProfile = {
    id: 'presentation',
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
const config: PresentationConfig = {
    enabled: true,
    profileId: profile.id,
    profile,
    validatorProfileId: profile.id,
    validatorProfile: profile,
    timeoutMs: 100,
    validatorTimeoutMs: 100,
};
const generated = (text: string): GenerationResult => ({
    text,
    model: 'gpt-5-mini',
    usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
    provenance: 'Inferred',
    citations: [],
});
const usage = (value: GenerationResult): ReviewWorkflowUsageSummary => ({
    model: value.model ?? 'gpt-5-mini',
    promptTokens: value.usage?.promptTokens ?? 0,
    completionTokens: value.usage?.completionTokens ?? 0,
    totalTokens: value.usage?.totalTokens ?? 0,
    estimatedCost: {
        inputCostUsd: 0.001,
        outputCostUsd: 0.002,
        totalCostUsd: 0.003,
    },
});
const contextEnvelope: ConversationContextEnvelope = {
    participants: [],
    turns: [],
    diagnostics: {
        surface: 'web',
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
    enableAssessment: false,
    enableRevision: false,
};

test('workflow asks for a styled draft before main-model finalization and records the receipt', async () => {
    const calls: GenerationRequest[] = [];
    const generationUsageTexts: string[] = [];
    const presentationUsageCalls: Array<{
        feature: 'chat_presentation_draft' | 'chat_presentation_audit';
        profileId: string;
    }> = [];
    const captureGenerationUsage = (
        value: GenerationResult
    ): ReviewWorkflowUsageSummary => {
        generationUsageTexts.push(value.text);
        return usage(value);
    };
    const capturePresentationUsage = (
        value: GenerationResult,
        profile: ModelProfile,
        feature: 'chat_presentation_draft' | 'chat_presentation_audit'
    ): ReviewWorkflowUsageSummary => {
        presentationUsageCalls.push({ feature, profileId: profile.id });
        return usage(value);
    };
    const runtime: GenerationRuntime = {
        kind: 'test',
        generate: async (request) => {
            calls.push(request);
            if (calls.length === 1)
                return generated(
                    'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
                );
            if (calls.length === 2)
                return generated(
                    'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
                );
            if (calls.length === 3)
                return generated(
                    '{"verdict":"evidence_issue","feedback":"Restore the attribution."}'
                );
            return generated(
                'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
            );
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
            maxIterations: 0,
            maxDurationMs: 1000,
            executionLimits: {
                maxWorkflowSteps: 2,
                maxToolCalls: 0,
                maxDeliberationCalls: 0,
                maxTokensTotal: 100,
                maxDurationMs: 1000,
            },
        },
        workflowPolicy: policy,
        captureUsage: captureGenerationUsage,
        presentation: {
            config,
            persona: { id: 'myuri', presentationGuidance: 'Lively prose.' },
            captureUsage: capturePresentationUsage,
        },
    });
    assert.equal(result.outcome, 'generated');
    if (result.outcome !== 'generated')
        throw new Error('Expected generated result.');
    assert.equal(
        result.presentation?.outcome,
        'finalized_after_evidence_repair'
    );
    assert.equal(result.presentation?.reasonCode, 'evidence_repaired');
    assert.match(
        String(calls[0]?.messages[0]?.content),
        /Write the full presentation draft/u
    );
    assert.match(
        String(calls[1]?.messages.at(-2)?.content),
        /prose authority/u
    );
    assert.match(
        String(calls[3]?.messages.at(-2)?.content),
        /Restore the attribution/u
    );
    assert.deepEqual(presentationUsageCalls, [
        { feature: 'chat_presentation_draft', profileId: profile.id },
        { feature: 'chat_presentation_audit', profileId: profile.id },
    ]);
    assert.equal(result.presentation?.backendEstimatedCostUsd, 0.006);
    assert.equal(result.workflowLineage.terminationReason, 'goal_satisfied');
    assert.deepEqual(generationUsageTexts, [
        'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.',
        'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.',
    ]);
    assert.equal(
        result.generationResult.text,
        'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
    );
});

test('workflow falls back to normal generation after a structured presentation draft', async () => {
    let calls = 0;
    const runtime: GenerationRuntime = {
        kind: 'test',
        generate: async () => {
            calls += 1;
            return calls === 1
                ? generated('```json\n{"answer":"not prose"}\n```')
                : generated('Normal main-model response.');
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
                maxWorkflowSteps: 2,
                maxToolCalls: 0,
                maxDeliberationCalls: 0,
                maxTokensTotal: 100,
                maxDurationMs: 1000,
            },
        },
        workflowPolicy: policy,
        captureUsage: usage,
        presentation: {
            config,
            persona: { id: 'myuri', presentationGuidance: 'Lively prose.' },
            captureUsage: usage,
        },
    });

    assert.equal(result.outcome, 'generated');
    if (result.outcome !== 'generated')
        throw new Error('Expected generated result.');
    assert.equal(result.presentation?.outcome, 'fallback');
    assert.equal(result.presentation?.reasonCode, 'structured_output');
    assert.equal(result.generationResult.text, 'Normal main-model response.');
});
