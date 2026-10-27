/**
 * @description: Checks cache economics against worked token-pricing examples.
 * @footnote-scope: test
 * @footnote-module: PromptCachePricingTests
 * @footnote-risk: high - Wrong write premiums can invert the reported savings.
 * @footnote-ethics: high - Estimates must never claim unsupported savings.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateOpenAITextCost } from '../src/pricing.js';

test('12-hour cache writes use the 2.5x total rate and can produce negative savings', () => {
    const estimate = estimateOpenAITextCost('gpt-5.6-luna', 100000, 0, {
        cachedInputTokens: 10000,
        cacheWriteTokens: 80000,
        cacheWrite30mTokens: 0,
        cacheWrite12hTokens: 80000,
    });
    assert.ok(Math.abs(estimate.inputCost - 0.0211) < 1e-10);
    assert.ok(Math.abs((estimate.cacheSavingsUsd ?? NaN) - -0.0111) < 1e-10);
    assert.equal(estimate.completeness, 'complete');
});

test('missing cache-write tier detail never claims complete savings for modern models', () => {
    const incomplete = estimateOpenAITextCost('gpt-5.6-luna', 100, 5, {
        cachedInputTokens: 0,
        cacheWriteTokens: 100,
    });
    assert.equal(incomplete.completeness, 'partial');
    assert.equal(incomplete.cacheSavingsUsd, undefined);
    assert.ok(
        incomplete.incompleteReasons.includes('cache_write_tier_unavailable')
    );
    const measuredZero = estimateOpenAITextCost('gpt-5.6-luna', 100000, 0, {
        cachedInputTokens: 50000,
        cacheWriteTokens: 0,
    });
    assert.ok(Math.abs((measuredZero.cacheSavingsUsd ?? NaN) - 0.0045) < 1e-10);
});
