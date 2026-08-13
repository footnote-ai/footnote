/**
 * @description: Exercises the real bounded rewrite step against a focused persona and preservation corpus.
 * @footnote-scope: test
 * @footnote-module: StyleRewriteEvaluationCorpusTests
 * @footnote-risk: medium - A mock upstream still needs to preserve production request boundaries.
 * @footnote-ethics: high - Confirms unsafe or high-caution presentation changes retain the original answer.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { GenerationRuntime } from '@footnote/agent-runtime';
import type { ModelProfile } from '@footnote/contracts';
import {
    runStyleRewriteStep,
    type StyleRewriteConfig,
} from '../src/services/styleRewrite.js';
import { styleRewriteEvaluationCorpus } from './fixtures/styleRewriteEvaluationCorpus.js';

const writerProfile: ModelProfile = {
    id: 'openrouter-cydonia-24b-v4-1',
    description: 'Pinned OpenRouter style writer.',
    provider: 'openrouter',
    providerModel: 'thedrummer/cydonia-24b-v4.1',
    enabled: true,
    tierBindings: [],
    capabilities: { canUseSearch: false },
    providerRouting: {
        openrouter: { only: ['parasail'], allowFallbacks: false },
    },
};

const validatorProfile: ModelProfile = {
    id: 'ollama-gemma-validator',
    description: 'Pinned local semantic veto validator.',
    provider: 'ollama',
    providerModel: 'gemma3:12b',
    enabled: true,
    tierBindings: [],
    capabilities: { canUseSearch: false },
};

const config: StyleRewriteConfig = {
    enabled: true,
    profileId: writerProfile.id,
    validatorProfileId: validatorProfile.id,
    timeoutMs: 1_000,
    validatorTimeoutMs: 1_000,
    profile: writerProfile,
    validatorProfile,
};

test('style rewrite evaluation corpus exercises the production rewrite and veto path', async () => {
    for (const evaluationCase of styleRewriteEvaluationCorpus) {
        const requests: Parameters<GenerationRuntime['generate']>[0][] = [];
        const runtime: GenerationRuntime = {
            kind: 'test',
            generate: async (request) => {
                requests.push(request);
                if (requests.length === 1) {
                    return {
                        text: evaluationCase.writerOutput,
                        model: writerProfile.providerModel,
                    };
                }
                return {
                    text:
                        evaluationCase.validatorOutput ??
                        '{"verdict":"equivalent","reasons":[]}',
                    model: validatorProfile.providerModel,
                };
            },
        };

        const result = await runStyleRewriteStep({
            original: { text: evaluationCase.original },
            generationRuntime: runtime,
            config,
            persona: {
                id: evaluationCase.personaId,
                presentationGuidance: evaluationCase.presentationGuidance,
            },
            eligibility: { protectedContent: false },
            caution: evaluationCase.caution,
        });

        assert.equal(
            result.metadata.outcome,
            evaluationCase.expectedOutcome,
            evaluationCase.id
        );
        assert.equal(
            result.metadata.intensity,
            evaluationCase.expectedIntensity,
            evaluationCase.id
        );
        if (evaluationCase.expectedOutcome === 'applied') {
            assert.equal(
                result.text,
                evaluationCase.writerOutput,
                evaluationCase.id
            );
            assert.equal(
                requests[0]?.provider,
                'openrouter',
                evaluationCase.id
            );
            assert.deepEqual(
                requests[0]?.providerRouting?.openrouter,
                writerProfile.providerRouting?.openrouter,
                evaluationCase.id
            );
            assert.equal(requests[1]?.provider, 'ollama', evaluationCase.id);
        } else {
            assert.equal(
                result.text,
                evaluationCase.original,
                evaluationCase.id
            );
        }
    }
});
