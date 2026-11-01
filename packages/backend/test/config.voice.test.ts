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

test('Voice answer ceiling defaults from the config spec and accepts positive integer overrides', () => {
    const warnings: string[] = [];
    const warn = (message: string): void => {
        warnings.push(message);
    };
    assert.equal(buildVoiceSection({}, warn).maxAnswerTokens, 160);
    assert.equal(
        buildVoiceSection({ VOICE_MAX_ANSWER_TOKENS: '240' }, warn)
            .maxAnswerTokens,
        240
    );
    assert.equal(
        buildVoiceSection({ VOICE_MAX_ANSWER_TOKENS: '0' }, warn)
            .maxAnswerTokens,
        160
    );
    assert.match(warnings[0] ?? '', /VOICE_MAX_ANSWER_TOKENS/);
});
