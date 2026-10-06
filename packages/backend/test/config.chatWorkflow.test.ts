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
    assert.equal(chatWorkflow.maxWorkflowStepsOverride, undefined);
    assert.equal(chatWorkflow.maxToolCallsOverride, undefined);
    assert.equal(chatWorkflow.maxDeliberationCallsOverride, undefined);
    assert.equal(chatWorkflow.maxDurationMsOverride, undefined);
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

test('workflow allowance overrides accept their finite maximums', () => {
    const { chatWorkflow } = buildServiceSections(
        {
            CHAT_WORKFLOW_MAX_WORKFLOW_STEPS_OVERRIDE: '12',
            CHAT_WORKFLOW_MAX_TOOL_CALLS_OVERRIDE: '5',
            CHAT_WORKFLOW_MAX_DELIBERATION_CALLS_OVERRIDE: '6',
            CHAT_WORKFLOW_MAX_TOKENS_TOTAL_OVERRIDE: '512000',
            CHAT_WORKFLOW_MAX_DURATION_MS_OVERRIDE: '300000',
        },
        () => undefined
    );

    assert.equal(chatWorkflow.maxWorkflowStepsOverride, 12);
    assert.equal(chatWorkflow.maxToolCallsOverride, 5);
    assert.equal(chatWorkflow.maxDeliberationCallsOverride, 6);
    assert.equal(chatWorkflow.maxTokensTotalOverride, 512_000);
    assert.equal(chatWorkflow.maxDurationMsOverride, 300_000);
});

test('workflow allowance overrides accept zero only for tools and deliberation', () => {
    const { chatWorkflow } = buildServiceSections(
        {
            CHAT_WORKFLOW_MAX_TOOL_CALLS_OVERRIDE: '0',
            CHAT_WORKFLOW_MAX_DELIBERATION_CALLS_OVERRIDE: '0',
            CHAT_WORKFLOW_MAX_WORKFLOW_STEPS_OVERRIDE: '0',
            CHAT_WORKFLOW_MAX_TOKENS_TOTAL_OVERRIDE: '0',
            CHAT_WORKFLOW_MAX_DURATION_MS_OVERRIDE: '0',
        },
        () => undefined
    );

    assert.equal(chatWorkflow.maxToolCallsOverride, 0);
    assert.equal(chatWorkflow.maxDeliberationCallsOverride, 0);
    assert.equal(chatWorkflow.maxWorkflowStepsOverride, undefined);
    assert.equal(chatWorkflow.maxTokensTotalOverride, undefined);
    assert.equal(chatWorkflow.maxDurationMsOverride, undefined);
});

test('workflow allowance overrides reject values beyond their finite caps', () => {
    const warnings: string[] = [];
    const { chatWorkflow } = buildServiceSections(
        {
            CHAT_WORKFLOW_MAX_WORKFLOW_STEPS_OVERRIDE: '13',
            CHAT_WORKFLOW_MAX_TOOL_CALLS_OVERRIDE: '6',
            CHAT_WORKFLOW_MAX_DELIBERATION_CALLS_OVERRIDE: '7',
            CHAT_WORKFLOW_MAX_TOKENS_TOTAL_OVERRIDE: '512001',
            CHAT_WORKFLOW_MAX_DURATION_MS_OVERRIDE: '300001',
        },
        (warning) => warnings.push(warning)
    );

    assert.equal(chatWorkflow.maxWorkflowStepsOverride, undefined);
    assert.equal(chatWorkflow.maxToolCallsOverride, undefined);
    assert.equal(chatWorkflow.maxDeliberationCallsOverride, undefined);
    assert.equal(chatWorkflow.maxTokensTotalOverride, undefined);
    assert.equal(chatWorkflow.maxDurationMsOverride, undefined);
    assert.equal(warnings.length, 5);
});

test('workflow allowance overrides reject malformed values and fail open', () => {
    const warnings: string[] = [];
    const { chatWorkflow } = buildServiceSections(
        {
            CHAT_WORKFLOW_MAX_WORKFLOW_STEPS_OVERRIDE: '12steps',
            CHAT_WORKFLOW_MAX_TOOL_CALLS_OVERRIDE: '-1',
            CHAT_WORKFLOW_MAX_DELIBERATION_CALLS_OVERRIDE: '6.5',
            CHAT_WORKFLOW_MAX_TOKENS_TOTAL_OVERRIDE: '512000tokens',
            CHAT_WORKFLOW_MAX_DURATION_MS_OVERRIDE: 'Infinity',
        },
        (warning) => warnings.push(warning)
    );

    assert.equal(chatWorkflow.maxWorkflowStepsOverride, undefined);
    assert.equal(chatWorkflow.maxToolCallsOverride, undefined);
    assert.equal(chatWorkflow.maxDeliberationCallsOverride, undefined);
    assert.equal(chatWorkflow.maxTokensTotalOverride, undefined);
    assert.equal(chatWorkflow.maxDurationMsOverride, undefined);
    assert.equal(warnings.length, 5);
});
