/**
 * @description: Verifies reader-facing context summaries show source status and result limits.
 * @footnote-scope: test
 * @footnote-module: ContextPresentationTests
 * @footnote-risk: low - Summary wording is a small presentation contract.
 * @footnote-ethics: high - Users must not mistake partial source counts for complete totals.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildContextPresentationSummary,
    type GitHubContextMetadata,
    type ProjectContextMetadata,
} from '../src/policy';

const projectContext: ProjectContextMetadata = {
    repository: 'footnote-ai/footnote',
    provider: 'openai',
    model: 'text-embedding-3-small',
    chunkerVersion: 1,
    indexVersion: 1,
    indexedAt: '2026-08-20T00:00:00.000Z',
    requestedCategories: ['current_state'],
    returnedCounts: { current_state: 2 },
    maxChunks: 200,
    topKPerCategory: 5,
    status: 'current',
    reasonCodes: [],
};

const githubContext: GitHubContextMetadata = {
    repository: 'footnote-ai/footnote',
    requestedSections: ['issues', 'pulls'],
    status: 'partial',
    fetchTimestamp: '2026-08-20T00:00:00.000Z',
    maxRecordsPerSection: 5,
    returnedCounts: { issues: 5, pulls: 1 },
    failedSections: [],
    reasonCodes: [],
};

test('context summaries show source status and bounded GitHub coverage', () => {
    const summaries = buildContextPresentationSummary({
        projectContext,
        githubContext,
    });

    assert.match(summaries[0] ?? '', /Project documents: current/);
    assert.match(summaries[0] ?? '', /2 document excerpts retrieved/);
    assert.match(summaries[0] ?? '', /indexed at 2026-08-20/);
    assert.match(summaries[1] ?? '', /GitHub: partial/);
    assert.match(summaries[1] ?? '', /fetched at 2026-08-20/);
    assert.match(
        summaries[1] ?? '',
        /Some results may not be shown; these counts are not repository totals/
    );
});

test('project summaries disclose when a category reaches its retrieval limit', () => {
    const [summary] = buildContextPresentationSummary({
        projectContext: {
            repository: 'footnote-ai/footnote',
            provider: 'openai',
            model: 'text-embedding-3-small',
            chunkerVersion: 1,
            indexVersion: 1,
            requestedCategories: ['documented_behavior'],
            returnedCounts: { documented_behavior: 2 },
            maxChunks: 200,
            topKPerCategory: 2,
            status: 'current',
            reasonCodes: [],
        },
    });
    assert.match(summary ?? '', /not a count of all project documents/);
});

test('GitHub summaries use singular labels for one record in every section', () => {
    const summary = buildContextPresentationSummary({
        githubContext: {
            ...githubContext,
            requestedSections: [
                'repository',
                'issues',
                'pulls',
                'releases',
                'commits',
            ],
            returnedCounts: {
                repository: 1,
                issues: 1,
                pulls: 1,
                releases: 1,
                commits: 1,
            },
        },
    })[0];

    assert.match(summary ?? '', /1 repository record/);
    assert.match(summary ?? '', /1 issue/);
    assert.match(summary ?? '', /1 pull request/);
    assert.match(summary ?? '', /1 release/);
    assert.match(summary ?? '', /1 commit/);
});
