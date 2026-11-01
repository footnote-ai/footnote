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
    measureVoiceAnswerDelivery,
} from '../src/services/voiceAnswerBudget.js';

test('estimates multilingual Voice text without splitting on English spaces', () => {
    assert.equal(estimateVoiceAnswerTokens('漢'), 3);
    assert.equal(estimateVoiceAnswerTokens('🌏'), 4);
    assert.equal(estimateVoiceAnswerTokens('Hello，世界！'), 14);
    assert.equal(estimateVoiceAnswerTokens(''), 1);
});

test('keeps realistic Unicode answers within a UTF-8 upper-bound estimate', () => {
    const examples = [
        'The answer keeps its qualification: evidence is limited.',
        '日本語で簡潔に説明します。追加の証拠はありません。',
        'The answer is短く、 but its根拠 is uncertain.',
        'Use punctuation—pauses… quotes “like this”; slash/括弧（そうです）。',
        'Status: ✅ 👩🏽‍💻 — verified? No; the source is limited.',
        'Cafe\u0301 remains spelled with a combining mark.',
    ];
    for (const example of examples) {
        assert.ok(
            estimateVoiceAnswerTokens(example) <= Buffer.byteLength(example)
        );
    }
    assert.equal(estimateVoiceAnswerTokens('あ'.repeat(133)), 399);
    assert.equal(fitsVoiceAnswerDelivery('あ'.repeat(133), 'live', 400), true);
    assert.equal(fitsVoiceAnswerDelivery('あ'.repeat(134), 'live', 400), false);
});

test('caps configured Voice answers below each provider limit', () => {
    assert.equal(resolveVoiceAnswerTokenLimit('live', 1_000), 400);
    assert.equal(resolveVoiceAnswerTokenLimit('standard', 1_000), 1_000);
    assert.equal(resolveVoiceAnswerTokenLimit('standard', 2_000), 1_600);
    assert.equal(resolveVoiceAnswerTokenLimit('live', 100), 100);
});

test('uses one configured deliverable ceiling for Standard and Live', () => {
    for (const mode of ['standard', 'live'] as const) {
        assert.deepEqual(measureVoiceAnswerDelivery('a'.repeat(36), mode, 12), {
            estimatedTokens: 12,
            tokenLimit: 12,
            tokenOverage: 0,
            codePoints: 36,
            ...(mode === 'standard' ? { characterLimit: 3_686 } : {}),
            characterOverage: 0,
            fits: true,
        });
    }
});

test('applies the token and Standard TTS character boundaries without altering text', () => {
    assert.equal(fitsVoiceAnswerDelivery('短い返事です。', 'live', 24), true);
    assert.equal(fitsVoiceAnswerDelivery('答'.repeat(201), 'live', 400), false);
    assert.equal(
        fitsVoiceAnswerDelivery('x'.repeat(3_687), 'standard', 10_000),
        false
    );
    assert.equal(
        fitsVoiceAnswerDelivery('x'.repeat(3_000), 'standard', 10_000),
        true
    );
    assert.deepEqual(
        measureVoiceAnswerDelivery('x'.repeat(3_687), 'standard', 10_000),
        {
            estimatedTokens: 1_229,
            tokenLimit: 1_600,
            tokenOverage: 0,
            codePoints: 3_687,
            characterLimit: 3_686,
            characterOverage: 1,
            fits: false,
        }
    );
});
