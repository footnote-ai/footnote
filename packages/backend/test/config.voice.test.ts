/**
 * @description: Covers administrator-configured Voice answer length.
 * @footnote-scope: test
 * @footnote-module: BackendVoiceConfigTests
 * @footnote-risk: low - Incorrect parsing would change the Voice delivery ceiling.
 * @footnote-ethics: medium - Operators need a predictable maximum for spoken answers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVoiceSection } from '../src/config/sections/voice.js';

test('Voice answer ceiling defaults to auto, accepts positive integers, and falls back to auto when invalid', () => {
    const warnings: string[] = [];
    const warn = (message: string): void => {
        warnings.push(message);
    };
    assert.equal(buildVoiceSection({}, warn).maxAnswerTokens, 'auto');
    assert.equal(
        buildVoiceSection({ VOICE_MAX_ANSWER_TOKENS: 'auto' }, warn)
            .maxAnswerTokens,
        'auto'
    );
    assert.equal(
        buildVoiceSection({ VOICE_MAX_ANSWER_TOKENS: '240' }, warn)
            .maxAnswerTokens,
        240
    );
    assert.equal(
        buildVoiceSection({ VOICE_MAX_ANSWER_TOKENS: '0' }, warn)
            .maxAnswerTokens,
        'auto'
    );
    assert.equal(
        buildVoiceSection({ VOICE_MAX_ANSWER_TOKENS: 'not-a-limit' }, warn)
            .maxAnswerTokens,
        'auto'
    );
    assert.equal(warnings.length, 2);
    assert.ok(
        warnings.every((warning) => /VOICE_MAX_ANSWER_TOKENS/.test(warning))
    );
});
