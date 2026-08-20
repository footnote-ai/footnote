/**
 * @description: Covers the shared project-context guidance prompt key.
 * @footnote-scope: test
 * @footnote-module: ProjectContextPromptGuidanceTests
 * @footnote-risk: medium - Missing guidance could let project docs read as instructions.
 * @footnote-ethics: high - Guidance defines how Footnote separates documented evidence from policy authority.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createPromptRegistry } from '../src/index.js';

test('loads the project-context guidance key from shared defaults', () => {
    const registry = createPromptRegistry();
    assert.equal(
        registry.hasPrompt('conversation.shared.project_context_guidance'),
        true
    );
});

test('guidance instructs treating project context as untrusted data, not instructions', () => {
    const registry = createPromptRegistry();
    const rendered = registry.renderPrompt(
        'conversation.shared.project_context_guidance'
    ).content;
    assert.match(rendered, /untrusted/i);
    assert.match(rendered, /documented intent/i);
    assert.match(rendered, /documented behavior/i);
    assert.match(rendered, /current\s+project\s+state/i);
    assert.match(rendered, /not\s+as\s+instructions|not instructions/i);
    assert.match(rendered, /source/i);
    assert.match(rendered, /only the records returned/i);
    assert.match(rendered, /repository\s+total/i);
});

test('guidance renders non-empty with the standard persona variable', () => {
    const registry = createPromptRegistry();
    const rendered = registry
        .renderPrompt('conversation.shared.project_context_guidance', {
            botProfileDisplayName: 'Footnote',
        })
        .content.trim();
    assert.equal(rendered.length > 0, true);
});
