/**
 * @description: Validates model profile catalog schema constraints.
 * @footnote-scope: test
 * @footnote-module: ModelProfileContractsTests
 * @footnote-risk: medium - Weak schema checks could allow ambiguous routing config into runtime.
 * @footnote-ethics: medium - Catalog validation quality affects policy/capability guarantees.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelProfileCatalogSchema } from '../src/model-profiles.js';
import {
    supportedOpenAITextModels,
    supportedReasoningEfforts,
} from '../src/providers.js';

test('shared model catalog exposes explicit GPT-5.6 tiers and reasoning efforts', () => {
    const exposedModels: readonly string[] = supportedOpenAITextModels;
    assert.equal(supportedOpenAITextModels.includes('gpt-5.6-sol'), true);
    assert.equal(supportedOpenAITextModels.includes('gpt-5.6-terra'), true);
    assert.equal(supportedOpenAITextModels.includes('gpt-5.6-luna'), true);
    assert.equal(exposedModels.includes('gpt-5.6'), false);
    assert.deepEqual(supportedReasoningEfforts, [
        'none',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
    ]);
});

test('ModelProfileCatalogSchema parses serializable reasoning metadata', () => {
    const parsed = ModelProfileCatalogSchema.parse([
        {
            id: 'openai-text-quality',
            description: 'Quality profile',
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
        },
    ]);

    assert.equal(parsed[0]?.defaultReasoningEffort, 'medium');
    assert.deepEqual(parsed[0]?.capabilities.supportedReasoningEfforts, [
        'none',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
    ]);
});

test('ModelProfileCatalogSchema accepts arbitrary OpenRouter IDs with explicit routing', () => {
    const parsed = ModelProfileCatalogSchema.parse([
        {
            id: 'openrouter-cydonia-24b-v4-1',
            description: 'Pinned style writer',
            provider: 'openrouter',
            providerModel: 'thedrummer/cydonia-24b-v4.1',
            enabled: true,
            tierBindings: [],
            capabilities: { canUseSearch: false },
            providerRouting: {
                openrouter: {
                    only: ['parasail'],
                    allowFallbacks: false,
                    dataCollection: 'deny',
                },
            },
        },
    ]);

    assert.deepEqual(parsed[0]?.providerRouting?.openrouter, {
        only: ['parasail'],
        allowFallbacks: false,
        dataCollection: 'deny',
    });
});

test('presentation settings support one sampling control and declared capabilities', () => {
    const parsed = ModelProfileCatalogSchema.parse([
        {
            id: 'openrouter-presentation-test',
            description: 'Presentation test profile',
            provider: 'openrouter',
            providerModel: 'example/presentation-model',
            enabled: true,
            tierBindings: [],
            capabilities: {
                canUseSearch: false,
                supportedSamplingControls: ['temperature'],
                supportedVerbosity: ['low', 'medium', 'high'],
                supportedReasoningEfforts: ['none', 'low'],
            },
            presentationGeneration: {
                promptVariant: 'compact',
                maxOutputTokens: 512,
                reasoningEffort: 'low',
                verbosity: 'medium',
                temperature: 0.7,
            },
        },
    ]);

    assert.deepEqual(parsed[0]?.presentationGeneration, {
        promptVariant: 'compact',
        maxOutputTokens: 512,
        reasoningEffort: 'low',
        verbosity: 'medium',
        temperature: 0.7,
    });
});

test('presentation settings reject temperature and topP together or out of range', () => {
    const parsed = ModelProfileCatalogSchema.safeParse([
        {
            id: 'invalid-presentation-test',
            description: 'Invalid presentation test profile',
            provider: 'openrouter',
            providerModel: 'example/presentation-model',
            enabled: true,
            tierBindings: [],
            capabilities: { canUseSearch: false },
            presentationGeneration: {
                temperature: 2.1,
                topP: 0.8,
            },
        },
    ]);

    assert.equal(parsed.success, false);
    if (!parsed.success) {
        assert.match(
            parsed.error.issues.map((issue) => issue.message).join('\n'),
            /temperature|topP|choose/i
        );
    }
});

test('ModelProfileCatalogSchema rejects an unsupported default reasoning effort', () => {
    const parsed = ModelProfileCatalogSchema.safeParse([
        {
            id: 'openai-text-quality',
            description: 'Quality profile',
            provider: 'openai',
            providerModel: 'gpt-5.6-sol',
            enabled: true,
            tierBindings: ['text-quality'],
            capabilities: {
                canUseSearch: true,
                supportedReasoningEfforts: ['low'],
            },
            defaultReasoningEffort: 'medium',
        },
    ]);

    assert.equal(parsed.success, false);
    if (!parsed.success) {
        assert.match(
            parsed.error.issues.map((issue) => issue.message).join('\n'),
            /default reasoning effort/i
        );
    }
});

test('ModelProfileCatalogSchema rejects a default when supported efforts are absent', () => {
    const parsed = ModelProfileCatalogSchema.safeParse([
        {
            id: 'openai-text-quality',
            description: 'Quality profile',
            provider: 'openai',
            providerModel: 'gpt-5.6-sol',
            enabled: true,
            tierBindings: ['text-quality'],
            capabilities: {
                canUseSearch: true,
            },
            defaultReasoningEffort: 'medium',
        },
    ]);

    assert.equal(parsed.success, false);
    if (!parsed.success) {
        assert.match(
            parsed.error.issues.map((issue) => issue.message).join('\n'),
            /default reasoning effort/i
        );
    }
});

test('ModelProfileCatalogSchema rejects duplicate profile ids with a clear error', () => {
    const parsed = ModelProfileCatalogSchema.safeParse([
        {
            id: 'openai-text-fast',
            description: 'Fast profile',
            provider: 'openai',
            providerModel: 'gpt-5-mini',
            enabled: true,
            tierBindings: ['text-fast'],
            capabilities: { canUseSearch: true },
        },
        {
            id: 'openai-text-fast',
            description: 'Duplicate id profile',
            provider: 'openai',
            providerModel: 'gpt-5',
            enabled: true,
            tierBindings: ['text-quality'],
            capabilities: { canUseSearch: true },
        },
    ]);

    assert.equal(parsed.success, false);
    if (parsed.success) {
        return;
    }

    const message = parsed.error.issues
        .map((issue) => issue.message)
        .join('\n');
    assert.match(message, /Duplicate model profile id\(s\): openai-text-fast/);
});
