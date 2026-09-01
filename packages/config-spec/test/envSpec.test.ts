/**
 * @description: Verifies canonical environment defaults shared across runtime packages.
 * @footnote-scope: test
 * @footnote-module: EnvironmentSpecTests
 * @footnote-risk: medium - Incorrect defaults can silently route production requests to the wrong model.
 * @footnote-ethics: medium - Model defaults affect cost, quality, and the provenance users receive.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    envConfigSourceByKey,
    envDefaultValues,
    envSpecByKey,
} from '../src/index.js';

test('OpenAI defaults use the balanced GPT-5.6 Terra profile', () => {
    assert.equal(envDefaultValues.DEFAULT_MODEL, 'gpt-5.6-terra');
    assert.equal(envDefaultValues.DEFAULT_PROFILE_ID, 'openai-text-medium');
});

test('image prompting defaults to the request-local GPT-5.6 Luna model', () => {
    assert.equal(envDefaultValues.IMAGE_DEFAULT_TEXT_MODEL, 'gpt-5.6-luna');
    assert.equal(
        envDefaultValues.IMAGE_DEFAULT_IMAGE_MODEL,
        'gpt-image-1-mini'
    );
});

test('presentation defaults stay disabled but select the tested profile and timeout', () => {
    assert.equal(envDefaultValues.CHAT_PRESENTATION_ENABLED, false);
    assert.equal(
        envDefaultValues.CHAT_PRESENTATION_PROFILE_ID,
        'openrouter-deepseek-v4-flash-0731'
    );
    assert.equal(envDefaultValues.CHAT_PRESENTATION_TIMEOUT_MS, 90000);
    assert.equal(
        envSpecByKey.CHAT_WORKFLOW_MAX_TOKENS_TOTAL_OVERRIDE?.kind,
        'integer'
    );
});

test('retired presentation validator settings are absent from the config spec', () => {
    assert.equal(
        Object.prototype.hasOwnProperty.call(
            envSpecByKey,
            'CHAT_PRESENTATION_VALIDATOR_PROFILE_ID'
        ),
        false
    );
    assert.equal(
        Object.prototype.hasOwnProperty.call(
            envSpecByKey,
            'CHAT_PRESENTATION_VALIDATOR_TIMEOUT_MS'
        ),
        false
    );
});

test('account auth keeps bootstrap values out of settings and the secret in env', () => {
    assert.equal(envConfigSourceByKey.OIDC_ISSUER_URL, 'bootstrap_env');
    assert.equal(envConfigSourceByKey.OIDC_CLIENT_ID, 'bootstrap_env');
    assert.equal(envConfigSourceByKey.OIDC_REDIRECT_URI, 'bootstrap_env');
    assert.equal(envConfigSourceByKey.OIDC_CLIENT_SECRET, 'secret_env');
    assert.equal(envSpecByKey.OIDC_CLIENT_SECRET.secret, true);
});

test('TrustGraph target sets remain deployment configuration instead of settings YAML', () => {
    assert.equal(
        envConfigSourceByKey.EXECUTION_CONTRACT_TRUSTGRAPH_TARGETS,
        'bootstrap_env'
    );
    assert.equal(
        envSpecByKey.EXECUTION_CONTRACT_TRUSTGRAPH_TARGETS.secret,
        false
    );
});
