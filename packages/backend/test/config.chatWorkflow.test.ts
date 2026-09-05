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

test('trusted agent token is read from AGENT_API_TOKEN', () => {
    const { agent } = buildServiceSections(
        { AGENT_API_TOKEN: '  agent-secret  ' },
        () => undefined
    );

    assert.equal(agent.apiToken, 'agent-secret');
});

test('presentation stays disabled but has the tested DeepSeek profile and timeout defaults', () => {
    const { chatWorkflow } = buildServiceSections({}, () => undefined);

    assert.equal(chatWorkflow.presentation.enabled, false);
    assert.equal(
        chatWorkflow.presentation.profileId,
        'openrouter-deepseek-v4-flash-0731'
    );
    assert.equal(chatWorkflow.presentation.timeoutMs, 90000);
    assert.equal(chatWorkflow.maxTokensTotalOverride, undefined);
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

test('workflow token override accepts positive safe deployment values', () => {
    const { chatWorkflow } = buildServiceSections(
        { CHAT_WORKFLOW_MAX_TOKENS_TOTAL_OVERRIDE: '1048576' },
        () => undefined
    );

    assert.equal(chatWorkflow.maxTokensTotalOverride, 1_048_576);
});

test('workflow token override rejects unsafe values', () => {
    const warnings: string[] = [];
    const { chatWorkflow } = buildServiceSections(
        { CHAT_WORKFLOW_MAX_TOKENS_TOTAL_OVERRIDE: '9007199254740992' },
        (warning) => warnings.push(warning)
    );

    assert.equal(chatWorkflow.maxTokensTotalOverride, undefined);
    assert.equal(warnings.length, 1);
});

test('workflow token override rejects malformed integer values', () => {
    const warnings: string[] = [];
    const { chatWorkflow } = buildServiceSections(
        { CHAT_WORKFLOW_MAX_TOKENS_TOTAL_OVERRIDE: '512000tokens' },
        (warning) => warnings.push(warning)
    );

    assert.equal(chatWorkflow.maxTokensTotalOverride, undefined);
    assert.equal(warnings.length, 1);
});
