/**
 * @description: Verifies canonical environment defaults shared across runtime packages.
 * @footnote-scope: test
 * @footnote-module: EnvironmentSpecTests
 * @footnote-risk: medium - Incorrect defaults can silently route production requests to the wrong model.
 * @footnote-ethics: medium - Model defaults affect cost, quality, and the provenance users receive.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { envDefaultValues } from '../src/index.js';

test('OpenAI defaults use the balanced GPT-5.6 Terra profile', () => {
    assert.equal(envDefaultValues.DEFAULT_MODEL, 'gpt-5.6-terra');
    assert.equal(envDefaultValues.DEFAULT_PROFILE_ID, 'openai-text-medium');
});
