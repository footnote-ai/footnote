/**
 * @description: Covers explicit Footnote-self routing: repo_explainer intent maps to project-context without slug-in-text.
 * @footnote-scope: test
 * @footnote-module: ProjectContextRoutingTests
 * @footnote-risk: medium - Routing seams decide when Footnote answers from approved docs.
 * @footnote-ethics: high - Canonical Footnote-self routing must not depend on the repo slug appearing in user text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildFootnoteGitHubContextRouteFromPlan,
    buildProjectContextRouteFromPlan,
    PROJECT_CONTEXT_CANONICAL_REPOSITORY,
} from '../src/services/chatGenerationHints.js';

test('repo_explainer plans route project context to the canonical Footnote repository', () => {
    const route = buildProjectContextRouteFromPlan({
        search: {
            query: 'What work is currently open?',
            contextSize: 'medium',
            intent: 'repo_explainer',
        },
    });
    assert.deepEqual(route, {
        repository: PROJECT_CONTEXT_CANONICAL_REPOSITORY,
        query: 'What work is currently open?',
    });
});

test('non-repo_explainer plans do not route to project context', () => {
    assert.equal(
        buildProjectContextRouteFromPlan({ search: undefined }),
        undefined
    );
    assert.equal(
        buildProjectContextRouteFromPlan({
            search: {
                query: 'latest release',
                contextSize: 'low',
                intent: 'current_facts',
            },
        }),
        undefined
    );
});

test('routing never requires the repository slug to appear in user text', () => {
    const route = buildProjectContextRouteFromPlan({
        search: {
            query: 'How does Footnote handle provenance?',
            contextSize: 'medium',
            intent: 'repo_explainer',
        },
    });
    assert.ok(route);
    // The canonical repo is the acceptance target regardless of whether the
    // user typed footnote-ai/footnote.
    assert.equal(route?.repository, PROJECT_CONTEXT_CANONICAL_REPOSITORY);
});

test('generic explanations about how Footnote works do not request live GitHub state', () => {
    assert.equal(
        buildFootnoteGitHubContextRouteFromPlan({
            search: {
                query: 'How does Footnote work?',
                contextSize: 'medium',
                intent: 'repo_explainer',
            },
        }),
        undefined
    );
});

test('stable team explanations do not request live GitHub state', () => {
    assert.equal(
        buildFootnoteGitHubContextRouteFromPlan({
            search: {
                query: 'How does the team work?',
                contextSize: 'medium',
                intent: 'repo_explainer',
            },
        }),
        undefined
    );
});
