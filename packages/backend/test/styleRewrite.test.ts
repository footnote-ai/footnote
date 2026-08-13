/**
 * @description: Covers the bounded style rewrite and veto-only validation safeguards.
 * @footnote-scope: test
 * @footnote-module: StyleRewriteTests
 * @footnote-risk: high - A missing check could allow presentation to change meaning.
 * @footnote-ethics: high - Tests enforce original-answer fallback on every uncertain path.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type {
    GenerationRequest,
    GenerationResult,
    GenerationRuntime,
} from '@footnote/agent-runtime';
import type { ModelProfile } from '@footnote/contracts';
import { resolvePersonaPresentationGuidance } from '../src/services/chatProfileOverlay.js';
import { hmacId } from '../src/utils/pseudonymization.js';
import {
    passesStyleRewriteMechanicalChecks,
    resolveStyleRewriteIntensity,
    runStyleRewriteStep,
    type StyleRewriteConfig,
} from '../src/services/styleRewrite.js';

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
    traceHmacSecret: 'style-rewrite-test-secret',
};
const original: GenerationResult = {
    text: 'According to Ada Lovelace, the release has 12 fixes. It may not resolve every issue.',
    model: 'gpt-5-mini',
    usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
    provenance: 'Inferred',
    citations: [],
};
const persona = {
    id: 'footnote',
    presentationGuidance: resolvePersonaPresentationGuidance('footnote'),
};
const runtime = (
    generate: (request: GenerationRequest) => Promise<GenerationResult>
): GenerationRuntime => ({ kind: 'test', generate });

test('disabled, unconfigured, and protected answers skip without provider calls', async () => {
    let calls = 0;
    for (const candidate of [
        { ...config, enabled: false },
        { ...config, validatorProfileId: null, validatorProfile: undefined },
    ]) {
        const result = await runStyleRewriteStep({
            original,
            generationRuntime: runtime(async () => {
                calls += 1;
                return original;
            }),
            config: candidate,
            persona,
            eligibility: { protectedContent: false },
        });
        assert.equal(result.metadata.outcome, 'skipped');
    }
    const protectedResult = await runStyleRewriteStep({
        original,
        generationRuntime: runtime(async () => {
            calls += 1;
            return original;
        }),
        config,
        persona,
        eligibility: { protectedContent: true },
    });
    assert.equal(protectedResult.metadata.reasonCode, 'protected_content');
    assert.equal(calls, 0);
});

test('explicit persona guidance covers Footnote, vendored personas, and neutral unknowns', () => {
    assert.match(resolvePersonaPresentationGuidance('footnote'), /neutral/u);
    assert.match(resolvePersonaPresentationGuidance('danny'), /measured/u);
    assert.match(resolvePersonaPresentationGuidance('myuri'), /lively/u);
    assert.match(
        resolvePersonaPresentationGuidance('future-persona'),
        /neutral/u
    );
    assert.ok(
        resolvePersonaPresentationGuidance('myuri').split(/\s+/u).length > 8
    );
});

test('mechanical checks reject only no-ops and newly introduced links', () => {
    const originalText =
        'The release notes are at https://example.com/release.';
    assert.equal(
        passesStyleRewriteMechanicalChecks(originalText, originalText),
        false
    );
    assert.equal(
        passesStyleRewriteMechanicalChecks(
            originalText,
            'The release notes are at https://example.com/release and https://example.com/other.'
        ),
        false
    );
});

test('mechanical checks allow broad persona rephrasing for semantic validation', () => {
    const originalText =
        'The service will not launch until all 12 tests pass, and it may need another careful review before the final release.';
    const rewrittenText =
        'It may be possible for the service to launch only after 12 tests pass; without that review, it will not go live.';

    assert.equal(
        passesStyleRewriteMechanicalChecks(originalText, rewrittenText),
        true
    );
});

test('ordinary prose with a label, list, and link can reach the semantic validator', async () => {
    let call = 0;
    const labeledOriginal: GenerationResult = {
        ...original,
        text: 'Note: the release is ready.\n- See https://example.com/release for details.',
    };
    const result = await runStyleRewriteStep({
        original: labeledOriginal,
        generationRuntime: runtime(async () => {
            call += 1;
            return call === 1
                ? {
                      ...labeledOriginal,
                      text: 'A quick note: the release is ready.\n- Details remain at https://example.com/release.',
                  }
                : {
                      ...labeledOriginal,
                      text: '{"verdict":"equivalent","reasons":["preserved"]}',
                  };
        }),
        config,
        persona,
        eligibility: { protectedContent: false },
        caution: 3,
    });

    assert.equal(result.metadata.outcome, 'applied');
    assert.equal(call, 2);
});

test('equivalent validator applies a rewrite and records opaque HMAC identifiers without duplicate texts', async () => {
    let call = 0;
    const result = await runStyleRewriteStep({
        original,
        generationRuntime: runtime(async () => {
            call += 1;
            return call === 1
                ? {
                      ...original,
                      text: 'The release has 12 fixes, according to Ada Lovelace. It may not resolve every issue.',
                  }
                : {
                      ...original,
                      text: '{"verdict":"equivalent","reasons":["preserved"]}',
                  };
        }),
        config,
        persona,
        eligibility: { protectedContent: false },
        caution: 3,
    });
    assert.equal(result.metadata.outcome, 'applied');
    assert.equal(result.metadata.validatorOutcome, 'equivalent');
    assert.equal(result.metadata.originalHmacId?.length, 64);
    assert.equal(result.metadata.presentedHmacId?.length, 64);
    assert.equal(
        result.metadata.originalHmacId,
        hmacId(
            config.traceHmacSecret ?? '',
            original.text,
            'style-rewrite:v1:original'
        )
    );
    assert.equal('original' in result.metadata, false);
    assert.equal(call, 2);
});

test('a standalone fenced JSON validator verdict remains a strict equivalent approval', async () => {
    let call = 0;
    const result = await runStyleRewriteStep({
        original,
        generationRuntime: runtime(async () => {
            call += 1;
            return call === 1
                ? {
                      ...original,
                      text: 'The release has 12 fixes, according to Ada Lovelace. It may not resolve every issue.',
                  }
                : {
                      ...original,
                      text: '```json\n{"verdict":"equivalent","reasons":["preserved"]}\n```',
                  };
        }),
        config,
        persona,
        eligibility: { protectedContent: false },
        caution: 3,
    });

    assert.equal(result.metadata.outcome, 'applied');
    assert.equal(result.metadata.validatorOutcome, 'equivalent');
    assert.equal(call, 2);
});

test('a direct validator verdict applies a rewrite without JSON parsing', async () => {
    let call = 0;
    const requests: GenerationRequest[] = [];
    const result = await runStyleRewriteStep({
        original,
        generationRuntime: runtime(async (request) => {
            call += 1;
            requests.push(request);
            return call === 1
                ? {
                      ...original,
                      text: 'The release has 12 fixes, according to Ada Lovelace. It may not resolve every issue.',
                  }
                : { ...original, text: 'EQUIVALENT' };
        }),
        config,
        persona,
        eligibility: { protectedContent: false },
        caution: 3,
    });

    assert.equal(result.metadata.outcome, 'applied');
    assert.equal(result.metadata.validatorOutcome, 'equivalent');
    assert.equal(call, 2);
    assert.match(
        String(requests[1]?.messages[0]?.content),
        /contradiction detector/u
    );
    assert.match(
        String(requests[1]?.messages[0]?.content),
        /harmless elaboration/u
    );
});

test('restrained presentation rejects added emphasis or idioms despite equivalent validator evidence', async () => {
    let call = 0;
    const restrainedOriginal: GenerationResult = {
        ...original,
        text: 'The release includes 12 fixes for the current release cycle. It may not resolve every issue reported by users.',
    };
    const result = await runStyleRewriteStep({
        original: restrainedOriginal,
        generationRuntime: runtime(async () => {
            call += 1;
            return call === 1
                ? {
                      ...restrainedOriginal,
                      text: 'The release includes 12 fixes for the current release cycle! At the end of the day, it may not resolve every issue reported by users.',
                  }
                : {
                      ...restrainedOriginal,
                      text: '{"verdict":"equivalent","reasons":["preserved"]}',
                  };
        }),
        config,
        persona,
        eligibility: { protectedContent: false },
        caution: 4,
    });
    assert.equal(result.text, restrainedOriginal.text);
    assert.equal(result.metadata.outcome, 'rejected');
    assert.equal(result.metadata.reasonCode, 'mechanical_preservation_failed');
    assert.equal(result.metadata.validatorOutcome, 'equivalent');
    assert.equal(call, 2);
});

test('provider failures, timeout, malformed, drift, and uncertain validator evidence preserve original', async () => {
    const failed = await runStyleRewriteStep({
        original,
        generationRuntime: runtime(async () => {
            throw new Error('down');
        }),
        config,
        persona,
        eligibility: { protectedContent: false },
    });
    assert.equal(failed.metadata.reasonCode, 'provider_error');
    const timeout = await runStyleRewriteStep({
        original,
        generationRuntime: runtime(
            async () => await new Promise<GenerationResult>(() => undefined)
        ),
        config: { ...config, timeoutMs: 1 },
        persona,
        eligibility: { protectedContent: false },
    });
    assert.equal(timeout.metadata.reasonCode, 'timeout');
    for (const verdict of [
        '{"verdict":"drift","reasons":["meaning"]}',
        '{"verdict":"uncertain","reasons":[]}',
        'DRIFT',
        'UNCERTAIN',
        'not json',
        'Here is the verdict:\n```json\n{"verdict":"equivalent","reasons":[]}\n```',
    ]) {
        let call = 0;
        const rejected = await runStyleRewriteStep({
            original,
            generationRuntime: runtime(async () => {
                call += 1;
                return call === 1
                    ? {
                          ...original,
                          text: 'The release has 12 fixes, according to Ada Lovelace. It may not resolve every issue.',
                      }
                    : { ...original, text: verdict };
            }),
            config,
            persona,
            eligibility: { protectedContent: false },
        });
        assert.equal(rejected.text, original.text);
        assert.equal(rejected.metadata.outcome, 'rejected');
    }
});

test('structured output is never rewritten', async () => {
    const result = await runStyleRewriteStep({
        original: { ...original, text: '{"status":"ok"}' },
        generationRuntime: runtime(async () => original),
        config,
        persona,
        eligibility: { protectedContent: false },
    });
    assert.equal(result.metadata.reasonCode, 'structured_output');
});

test('style rewrite labels router facts as upstream-reported provenance', async () => {
    let calls = 0;
    const result = await runStyleRewriteStep({
        original,
        generationRuntime: runtime(async () => {
            calls += 1;
            if (calls === 1) {
                return {
                    ...original,
                    text: 'According to Ada Lovelace, the release lists 12 fixes. It may not resolve every issue.',
                    upstreamAttribution: {
                        inferenceProvider: 'parasail',
                        resolvedModel: 'thedrummer/cydonia-24b-v4.1',
                        routingAttempt: 1,
                        routingAttemptCount: 1,
                        upstreamReportedCostUsd: 0.002,
                    },
                };
            }
            return {
                ...original,
                text: '{"verdict":"equivalent","reasons":[]}',
            };
        }),
        config: {
            ...config,
            profile: {
                ...profile,
                provider: 'openrouter',
                providerModel: 'thedrummer/cydonia-24b-v4.1',
            },
        },
        persona,
        eligibility: { protectedContent: false },
    });

    assert.equal(result.metadata.requestedProvider, 'openrouter');
    assert.equal(result.metadata.upstreamInferenceProvider, 'parasail');
    assert.equal(result.metadata.upstreamReportedCostUsd, 0.002);
});

test('TRACE caution constrains intensity and skips high-caution answers', async () => {
    assert.equal(resolveStyleRewriteIntensity(1), 'standard');
    assert.equal(resolveStyleRewriteIntensity(3), 'standard');
    assert.equal(resolveStyleRewriteIntensity(4), 'restrained');
    assert.equal(resolveStyleRewriteIntensity(undefined), 'restrained');
    assert.equal(resolveStyleRewriteIntensity(5), 'skipped');
    let calls = 0;
    const result = await runStyleRewriteStep({
        original,
        generationRuntime: runtime(async () => {
            calls += 1;
            return original;
        }),
        config,
        persona,
        eligibility: { protectedContent: false },
        caution: 5,
    });
    assert.equal(result.metadata.reasonCode, 'trace_caution_high');
    assert.equal(result.metadata.intensity, 'skipped');
    assert.equal(result.metadata.traceConstrained, true);
    assert.equal(calls, 0);
});
