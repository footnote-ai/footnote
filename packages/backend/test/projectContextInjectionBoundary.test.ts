/**
 * @description: Proves the untrusted-project-context boundary: injected context never joins the trusted instructions run.
 * @footnote-scope: test
 * @footnote-module: ProjectContextInjectionBoundaryTests
 * @footnote-risk: high - If injection order changes, untrusted docs could read as system authority.
 * @footnote-ethics: high - The safe envelope keeps project documents as data, never instructions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { RuntimeMessage } from '@footnote/agent-runtime';
import { injectContextMessagesIntoPrompt } from '../src/services/workflowEngine/contextStepHelpers.js';
import { PROJECT_CONTEXT_UNTRUSTED_LABEL } from '../src/services/contextIntegrations/projectContext/index.js';

const TRUSTED_SYSTEM_PROMPT =
    'You are the Footnote response engine. This is trusted system policy.';
const PLANNER_MARKER = '// BEGIN Planner Output';

const buildBaseMessages = (): RuntimeMessage[] => [
    { role: 'system', content: TRUSTED_SYSTEM_PROMPT },
    { role: 'user', content: 'What is Footnote?' },
    {
        role: 'system',
        content: `${PLANNER_MARKER}\nPlanner chose repo_explainer.`,
    },
];

test('injected untrusted project context stays after user messages, never in the leading trusted run', () => {
    const injected = injectContextMessagesIntoPrompt(buildBaseMessages(), [
        PROJECT_CONTEXT_UNTRUSTED_LABEL,
    ]);
    const firstSystemIndex = injected.findIndex(
        (message) => message.role === 'system'
    );
    const contextIndex = injected.findIndex((message) =>
        message.content.includes('UNTRUSTED PROJECT CONTEXT')
    );
    const userIndex = injected.findIndex((message) => message.role === 'user');
    assert.ok(firstSystemIndex >= 0);
    assert.ok(userIndex >= 0);
    // The context block must land after user content, not in the leading run.
    assert.ok(contextIndex > userIndex);
    assert.equal(injected[contextIndex]?.role, 'system');
});

test('project context can use the lower-authority user channel', () => {
    const injected = injectContextMessagesIntoPrompt(buildBaseMessages(), [
        { role: 'user', content: PROJECT_CONTEXT_UNTRUSTED_LABEL },
    ]);
    const context = injected.find((message) =>
        message.content.includes('UNTRUSTED PROJECT CONTEXT')
    );
    assert.ok(context);
    assert.equal(context?.role, 'user');
});

test('injected untrusted context never displaces the trusted system prompt', () => {
    const injected = injectContextMessagesIntoPrompt(buildBaseMessages(), [
        PROJECT_CONTEXT_UNTRUSTED_LABEL,
    ]);
    assert.ok(
        injected.some((message) =>
            message.content.includes(TRUSTED_SYSTEM_PROMPT)
        )
    );
    const firstMessage = injected[0];
    assert.ok(firstMessage);
    assert.equal(firstMessage.content, TRUSTED_SYSTEM_PROMPT);
});

test('empty context injection returns the base messages unchanged', () => {
    const base = buildBaseMessages();
    const injected = injectContextMessagesIntoPrompt(base, undefined);
    assert.equal(injected.length, base.length);
    const injectedEmpty = injectContextMessagesIntoPrompt(base, []);
    assert.equal(injectedEmpty.length, base.length);
});
