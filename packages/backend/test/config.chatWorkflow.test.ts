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

const workflowLimitOverrides = [
    {
        envKey: 'CHAT_WORKFLOW_MAX_WORKFLOW_STEPS_OVERRIDE',
        settingKey: 'maxWorkflowStepsOverride',
        maximum: 12,
        zeroAllowed: false,
        malformed: '12steps',
    },
    {
        envKey: 'CHAT_WORKFLOW_MAX_TOOL_CALLS_OVERRIDE',
        settingKey: 'maxToolCallsOverride',
        maximum: 5,
        zeroAllowed: true,
        malformed: '-1',
    },
    {
        envKey: 'CHAT_WORKFLOW_MAX_DELIBERATION_CALLS_OVERRIDE',
        settingKey: 'maxDeliberationCallsOverride',
        maximum: 6,
        zeroAllowed: true,
        malformed: '6.5',
    },
    {
        envKey: 'CHAT_WORKFLOW_MAX_TOKENS_TOTAL_OVERRIDE',
        settingKey: 'maxTokensTotalOverride',
        maximum: 512_000,
        zeroAllowed: false,
        malformed: '512000tokens',
    },
    {
        envKey: 'CHAT_WORKFLOW_MAX_DURATION_MS_OVERRIDE',
        settingKey: 'maxDurationMsOverride',
        maximum: 300_000,
        zeroAllowed: false,
        malformed: 'Infinity',
    },
] as const;

type WorkflowLimitOverride = (typeof workflowLimitOverrides)[number];

const runWorkflowLimitOverrides = (
    valueFor: (override: WorkflowLimitOverride) => string
) => {
    const warnings: string[] = [];
    const env: NodeJS.ProcessEnv = {};
    for (const override of workflowLimitOverrides) {
        env[override.envKey] = valueFor(override);
    }
    const { chatWorkflow } = buildServiceSections(env, (warning) =>
        warnings.push(warning)
    );
    return { chatWorkflow, warnings };
};

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
    const { chatWorkflow, warnings } = runWorkflowLimitOverrides((override) =>
        String(override.maximum)
    );

    for (const override of workflowLimitOverrides) {
        assert.equal(chatWorkflow[override.settingKey], override.maximum);
    }
    assert.equal(warnings.length, 0);
});

test('workflow allowance overrides accept zero only for tools and deliberation', () => {
    const { chatWorkflow, warnings } = runWorkflowLimitOverrides(() => '0');

    for (const override of workflowLimitOverrides) {
        assert.equal(
            chatWorkflow[override.settingKey],
            override.zeroAllowed ? 0 : undefined
        );
    }
    assert.equal(
        warnings.length,
        workflowLimitOverrides.filter((override) => !override.zeroAllowed)
            .length
    );
});

test('workflow allowance overrides reject values beyond their finite caps', () => {
    const { chatWorkflow, warnings } = runWorkflowLimitOverrides((override) =>
        String(override.maximum + 1)
    );

    for (const override of workflowLimitOverrides) {
        assert.equal(chatWorkflow[override.settingKey], undefined);
    }
    assert.equal(warnings.length, workflowLimitOverrides.length);
});

test('workflow allowance overrides reject malformed values and fail open', () => {
    const { chatWorkflow, warnings } = runWorkflowLimitOverrides(
        (override) => override.malformed
    );

    for (const override of workflowLimitOverrides) {
        assert.equal(chatWorkflow[override.settingKey], undefined);
    }
    assert.equal(warnings.length, workflowLimitOverrides.length);
});
