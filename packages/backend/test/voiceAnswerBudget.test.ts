/**
 * @description: Covers provider-neutral Voice answer estimates and delivery ceilings.
 * @footnote-scope: test
 * @footnote-module: VoiceAnswerBudgetTests
 * @footnote-risk: medium - Incorrect estimates can admit speech that a provider rejects.
 * @footnote-ethics: medium - Voice limits must not silently change reviewed answer text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    estimateVoiceAnswerTokens,
    resolveVoiceAnswerTokenLimit,
    fitsVoiceAnswerDelivery,
} from '../src/services/voiceAnswerBudget.js';

test('estimates multilingual Voice text without splitting on English spaces', () => {
    assert.equal(estimateVoiceAnswerTokens('漢'), 2);
    assert.equal(estimateVoiceAnswerTokens('🌏'), 2);
    assert.equal(estimateVoiceAnswerTokens('Hello，世界！'), 10);
    assert.equal(estimateVoiceAnswerTokens(''), 1);
});

test('caps configured Voice answers below each provider limit', () => {
    assert.equal(resolveVoiceAnswerTokenLimit('live', 1_000), 400);
    assert.equal(resolveVoiceAnswerTokenLimit('standard', 1_000), 1_000);
    assert.equal(resolveVoiceAnswerTokenLimit('standard', 2_000), 1_600);
    assert.equal(resolveVoiceAnswerTokenLimit('live', 100), 100);
});

test('applies the token and Standard TTS character boundaries without altering text', () => {
    assert.equal(fitsVoiceAnswerDelivery('短い返事です。', 'live', 20), true);
    assert.equal(fitsVoiceAnswerDelivery('答'.repeat(201), 'live', 400), false);
    assert.equal(
        fitsVoiceAnswerDelivery('x'.repeat(3_687), 'standard', 10_000),
        false
    );
    assert.equal(
        fitsVoiceAnswerDelivery('x'.repeat(3_000), 'standard', 10_000),
        true
    );
});
