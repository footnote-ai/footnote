/**
 * @description: Verifies reader-facing context summaries preserve status and bounded-result semantics.
 * @footnote-scope: test
 * @footnote-module: ContextPresentationTests
 * @footnote-risk: low - Summary wording is a small presentation contract.
 * @footnote-ethics: high - Users must not mistake bounded context counts for complete totals.
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
    assert.match(summaries[1] ?? '', /GitHub: partial/);
    assert.match(
        summaries[1] ?? '',
        /Results may be limited; counts are not repository totals/
    );
});
