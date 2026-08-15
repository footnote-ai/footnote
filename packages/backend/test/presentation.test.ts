/**
 * @description: Verifies draft-first presentation finalization and bounded audit repair behavior.
 * @footnote-scope: test
 * @footnote-module: PresentationTests
 * @footnote-risk: high - Tests protect styled wording, evidence repair, and fail-open audit handling.
 * @footnote-ethics: high - Presentation must not obscure source, safety, or user-intent limits.
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
    preservesPresentationUrls,
    runPresentationStep,
    type PresentationConfig,
} from '../src/services/presentation.js';

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
    traceHmacSecret: 'presentation-test-secret',
};
const request: GenerationRequest = {
    messages: [
        {
            role: 'system',
            content:
                'AUTHORITATIVE CONTEXT: Ada Lovelace confirmed 12 fixes. Cite https://example.com/release.',
        },
        { role: 'user', content: 'What changed?' },
    ],
};
const result = (text: string): GenerationResult => ({
    text,
    model: 'gpt-5-mini',
    usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
    provenance: 'Inferred',
    citations: [],
});
const persona = {
    id: 'myuri',
    presentationGuidance: 'Warm, colorful, lively prose.',
};

const runtime = (
    generate: (request: GenerationRequest) => Promise<GenerationResult>
): GenerationRuntime => ({ kind: 'test', generate });

test('passes the styled draft and authoritative context into evidence-aware finalization', async () => {
    const requests: GenerationRequest[] = [];
    const presentation = await runPresentationStep({
        generationRuntime: runtime(async (input) => {
            requests.push(input);
            if (requests.length === 1)
                return result(
                    'A bright release: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
                );
            return result('{"verdict":"clear","feedback":""}');
        }),
        generationRequest: request,
        finalize: async (input) => {
            requests.push(input);
            return result(
                'A bright release: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
            );
        },
        config,
        persona,
        caution: 3,
    });

    assert.equal(presentation.outcome, 'finalized');
    assert.equal(presentation.metadata.outcome, 'finalized');
    const finalizerRequest = requests[1];
    assert.match(
        String(finalizerRequest?.messages[0]?.content),
        /AUTHORITATIVE CONTEXT/u
    );
    assert.match(
        String(finalizerRequest?.messages.at(-1)?.content),
        /STYLED PRESENTATION DRAFT/u
    );
    assert.match(
        String(finalizerRequest?.messages.at(-1)?.content),
        /bright release/u
    );
    assert.match(
        String(finalizerRequest?.messages.at(-2)?.content),
        /prose authority/u
    );
});

test('keeps the styled candidate when the finalizer has no authority reason to change it', async () => {
    let runtimeCalls = 0;
    const styled =
        'The update arrives with a little sparkle: 12 fixes, confirmed by Ada Lovelace at https://example.com/release.';
    const presentation = await runPresentationStep({
        generationRuntime: runtime(async () => {
            runtimeCalls += 1;
            return runtimeCalls === 1
                ? result(styled)
                : result('{"verdict":"clear","feedback":""}');
        }),
        generationRequest: request,
        finalize: async () => result(styled),
        config,
        persona,
    });
    assert.equal(presentation.text, styled);
    assert.equal(presentation.metadata.styledDraftRetentionRatio, 1);
    assert.equal(presentation.metadata.finalizerAttemptCount, 1);
});

test('uses one audit-guided evidence repair instead of reverting to a plain answer', async () => {
    let runtimeCalls = 0;
    const finalizerRequests: GenerationRequest[] = [];
    const presentation = await runPresentationStep({
        generationRuntime: runtime(async () => {
            runtimeCalls += 1;
            if (runtimeCalls === 1)
                return result(
                    'A lively update: 12 fixes are confirmed at https://example.com/release.'
                );
            return result(
                '{"verdict":"evidence_issue","feedback":"Restore the Ada Lovelace attribution."}'
            );
        }),
        generationRequest: request,
        finalize: async (input) => {
            finalizerRequests.push(input);
            return finalizerRequests.length === 1
                ? result(
                      'A lively update: 12 fixes are confirmed at https://example.com/release.'
                  )
                : result(
                      'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
                  );
        },
        config,
        persona,
    });
    assert.equal(presentation.outcome, 'finalized');
    assert.equal(
        presentation.text,
        'A lively update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
    );
    assert.equal(
        presentation.metadata.outcome,
        'finalized_after_evidence_repair'
    );
    assert.equal(presentation.metadata.finalizerAttemptCount, 2);
    assert.equal(finalizerRequests.length, 2);
    assert.match(
        String(finalizerRequests[1]?.messages.at(-2)?.content),
        /Restore the Ada Lovelace attribution/u
    );
});

test('records an unavailable audit without suppressing the finalized presentation', async () => {
    let runtimeCalls = 0;
    const styled =
        'A colorful update: Ada Lovelace confirmed 12 fixes at https://example.com/release.';
    const presentation = await runPresentationStep({
        generationRuntime: runtime(async () => {
            runtimeCalls += 1;
            if (runtimeCalls === 1) return result(styled);
            throw new Error('audit unavailable');
        }),
        generationRequest: request,
        finalize: async () => result(styled),
        config,
        persona,
    });
    assert.equal(presentation.outcome, 'finalized');
    assert.equal(presentation.text, styled);
    assert.equal(
        presentation.metadata.outcome,
        'finalized_with_audit_unavailable'
    );
    assert.equal(presentation.metadata.reasonCode, 'audit_unavailable');
});

test('keeps provider-native search out of the prose-only presentation draft', async () => {
    const requests: GenerationRequest[] = [];
    const presentation = await runPresentationStep({
        generationRuntime: runtime(async (input) => {
            requests.push(input);
            return requests.length === 1
                ? result(
                      'A colorful update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
                  )
                : result('{"verdict":"clear","feedback":""}');
        }),
        generationRequest: {
            ...request,
            capabilities: { canUseSearch: true },
            search: {
                query: 'Ada Lovelace release fixes',
                contextSize: 'low',
                intent: 'current_facts',
            },
        },
        finalize: async () =>
            result(
                'A colorful update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
            ),
        config,
        persona,
    });

    assert.equal(presentation.outcome, 'finalized');
    assert.equal(requests[0]?.search, undefined);
});

test('records draft and finalizer timeouts as bounded presentation fallbacks', async () => {
    const timeoutConfig: PresentationConfig = {
        ...config,
        timeoutMs: 5,
    };
    const draftTimeout = await runPresentationStep({
        generationRuntime: runtime(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return result('Late draft.');
        }),
        generationRequest: request,
        finalize: async () => result('Unused.'),
        config: timeoutConfig,
        persona,
    });
    let draftCalls = 0;
    let finalizerSignal: AbortSignal | undefined;
    const finalizerTimeout = await runPresentationStep({
        generationRuntime: runtime(async () => {
            draftCalls += 1;
            return draftCalls === 1
                ? result(
                      'A colorful update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
                  )
                : result('{"verdict":"clear","feedback":""}');
        }),
        generationRequest: request,
        finalize: async (_request, signal) => {
            finalizerSignal = signal;
            await new Promise((resolve) => setTimeout(resolve, 20));
            return result('Late finalizer.');
        },
        config: timeoutConfig,
        persona,
    });

    assert.equal(draftTimeout.metadata.reasonCode, 'draft_timeout');
    assert.equal(finalizerTimeout.metadata.reasonCode, 'finalizer_timeout');
    assert.equal(finalizerSignal?.aborted, true);
});

test('uses normal fallback for structured drafts and mechanical preservation failures', async () => {
    const structuredDraft = await runPresentationStep({
        generationRuntime: runtime(async () =>
            result('{"answer":"not prose"}')
        ),
        generationRequest: request,
        finalize: async () => result('Unused.'),
        config,
        persona,
    });
    let runtimeCalls = 0;
    const droppedUrl = await runPresentationStep({
        generationRuntime: runtime(async () => {
            runtimeCalls += 1;
            return runtimeCalls === 1
                ? result(
                      'A colorful update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
                  )
                : result('{"verdict":"clear","feedback":""}');
        }),
        generationRequest: request,
        finalize: async () => result('A colorful update: 12 fixes confirmed.'),
        config,
        persona,
    });

    assert.equal(structuredDraft.outcome, 'fallback');
    assert.equal(structuredDraft.metadata.reasonCode, 'structured_output');
    assert.equal(droppedUrl.outcome, 'fallback');
    assert.equal(
        droppedUrl.metadata.reasonCode,
        'mechanical_preservation_failed'
    );
});

test('suppresses an unrepairable evidence issue instead of displaying the stale finalizer text', async () => {
    let runtimeCalls = 0;
    const presentation = await runPresentationStep({
        generationRuntime: runtime(async () => {
            runtimeCalls += 1;
            return runtimeCalls === 1
                ? result(
                      'A colorful update: Ada Lovelace confirmed 12 fixes at https://example.com/release.'
                  )
                : result(
                      '{"verdict":"evidence_issue","feedback":"Restore the attribution."}'
                  );
        }),
        generationRequest: request,
        finalize: async () => {
            if (runtimeCalls === 1) {
                return result(
                    'A colorful update: 12 fixes at https://example.com/release.'
                );
            }
            throw new Error('repair unavailable');
        },
        config,
        persona,
    });

    assert.equal(presentation.outcome, 'fallback');
    assert.equal(
        presentation.metadata.reasonCode,
        'evidence_repair_unavailable'
    );
    assert.equal(presentation.text, undefined);
});

test('preserves literal URLs across the styled draft and final response', () => {
    assert.equal(
        preservesPresentationUrls(
            'See https://example.com/release.',
            'See HTTPS://EXAMPLE.COM/release.'
        ),
        true
    );
    assert.equal(
        preservesPresentationUrls(
            'See https://example.com/release.',
            'See the release notes.'
        ),
        false
    );
});
