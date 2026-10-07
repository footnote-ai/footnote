/**
 * @description: Verifies source-neutral path normalization and bounded previews.
 * This package test covers selected-file facts without requiring a Git checkout or TrustGraph.
 * @footnote-scope: test
 * @footnote-module: RepositoryContextFilesTests
 * @footnote-risk: low - Test-only assertions protect preview bounds and safe path behavior.
 * @footnote-ethics: medium - Preview tests keep selected context bounded and inspectable.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createRepositoryContextPreview,
    normalizeRepositoryRelativePath,
    parseRepositoryContextPatterns,
} from '../src/files.js';

test('shared preview normalizes approved paths and reports bounded file metadata', () => {
    assert.deepEqual(
        createRepositoryContextPreview({
            files: [
                { path: 'docs\\guide.md', sizeBytes: 4 },
                { path: '../outside.md', sizeBytes: 4 },
                { path: 'large.md', sizeBytes: 5 },
            ],
            limits: { maxFileBytes: 4 },
        }),
        {
            files: [{ path: 'docs/guide.md', sizeBytes: 4 }],
            skipped: [
                { path: '../outside.md', reason: 'unsafe repository path' },
                { path: 'large.md', reason: 'larger than 4 bytes' },
            ],
            totalBytes: 4,
        }
    );
});

test('shared pattern parsing rejects paths outside the supplied source root', () => {
    assert.deepEqual(
        parseRepositoryContextPatterns('docs/**/*.md\n!docs/private/**'),
        {
            include: ['docs/**/*.md'],
            exclude: ['docs/private/**'],
        }
    );
    assert.equal(
        normalizeRepositoryRelativePath('C:\\repo\\private.md'),
        undefined
    );
    assert.throws(
        () => parseRepositoryContextPatterns('../outside.md'),
        /stay inside the repository/u
    );
});
