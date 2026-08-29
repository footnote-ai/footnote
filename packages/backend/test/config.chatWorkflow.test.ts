/**
 * @description: Verifies presentation runtime defaults and explicit operator overrides.
 * @footnote-scope: test
 * @footnote-module: BackendChatWorkflowConfigTests
 * @footnote-risk: medium - Wrong presentation defaults can enable an unintended provider or make fallback too eager.
 * @footnote-ethics: medium - Presentation routing changes whose prose is offered to users while authority remains backend-owned.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServiceSections } from '../src/config/sections/services.js';

test('presentation stays disabled but has the tested DeepSeek profile and timeout defaults', () => {
    const { chatWorkflow } = buildServiceSections({}, () => undefined);

    assert.equal(chatWorkflow.presentation.enabled, false);
    assert.equal(
        chatWorkflow.presentation.profileId,
        'openrouter-deepseek-v4-flash-0731'
    );
    assert.equal(chatWorkflow.presentation.timeoutMs, 30000);
});

test('presentation settings accept an explicit deployment override', () => {
    const { chatWorkflow } = buildServiceSections(
        {
            CHAT_PRESENTATION_ENABLED: 'true',
            CHAT_PRESENTATION_PROFILE_ID: 'explicit-presentation-profile',
            CHAT_PRESENTATION_TIMEOUT_MS: '45000',
        },
        () => undefined
    );

    assert.equal(chatWorkflow.presentation.enabled, true);
    assert.equal(
        chatWorkflow.presentation.profileId,
        'explicit-presentation-profile'
    );
    assert.equal(chatWorkflow.presentation.timeoutMs, 45000);
});
