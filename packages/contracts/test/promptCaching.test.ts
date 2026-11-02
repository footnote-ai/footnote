/**
 * @description: Verifies prompt-cache contracts distinguish Voice condensation.
 * @footnote-scope: test
 * @footnote-module: PromptCachingContractTests
 * @footnote-risk: low - Tests validate bounded, content-free metadata only.
 * @footnote-ethics: low - Uses synthetic execution receipts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PromptCacheReceiptSchema,
    PromptCacheSummarySchema,
} from '../src/prompt-caching.js';

test('prompt-cache contracts preserve the condensation purpose', () => {
    assert.equal(
        PromptCacheReceiptSchema.safeParse({
            mode: 'explicit',
            purpose: 'condensation',
            surface: 'unknown',
            stablePrefixTokensEstimate: 12,
        }).success,
        true
    );
    assert.equal(
        PromptCacheSummarySchema.safeParse({
            purpose: 'condensation',
            provider: 'provider',
            model: 'model',
            surface: 'unknown',
            attempts: 1,
            inputReported: 0,
            readsReported: 0,
            writesReported: 0,
            costCompleteness: 'unknown',
        }).success,
        true
    );
});
