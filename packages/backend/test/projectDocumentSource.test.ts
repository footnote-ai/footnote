/**
 * @description: Covers backend-owned project-document source resolution from .footnote/context-files.
 * @footnote-scope: test
 * @footnote-module: ProjectDocumentSourceTests
 * @footnote-risk: medium - Unsafe resolution could read unintended repository files.
 * @footnote-ethics: high - Allowlist resolution controls which project docs may influence output.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';

import {
    createProjectDocumentSource,
    projectGlobToRegex,
} from '../src/services/contextIntegrations/projectContext/documentSource.js';

test('projectGlobToRegex converts glob patterns to anchored regexes', () => {
    assert.equal(projectGlobToRegex('README.md'), '^README\\.md$');
    assert.equal(
        projectGlobToRegex('docs/**/*.md'),
        '^docs\\/(?:.*/)?[^/]*\\.md$'
    );
    assert.match(
        'docs/architecture/workflow.md',
        new RegExp(projectGlobToRegex('docs/**/*.md'))
    );
    assert.match(
        'docs/status/plan.md',
        new RegExp(projectGlobToRegex('docs/**/*.md'))
    );
    assert.match(
        'docs/Philosophy.md',
        new RegExp(projectGlobToRegex('docs/**/*.md'))
    );
});

test('createProjectDocumentSource reads allowlisted tracked file contents', async () => {
    const root = path.join(
        os.tmpdir(),
        `footnote-project-source-${randomUUID()}`
    );
    await fs.mkdir(root, { recursive: true });
    try {
        await fs.writeFile(
            path.join(root, 'README.md'),
            '# Footnote\nTransparency first.',
            'utf8'
        );

        const source = createProjectDocumentSource({
            repositoryRoot: root,
            trackedPaths: ['README.md', 'SECURITY.md'],
            readFile: async (filePath) => {
                if (filePath.endsWith('README.md')) {
                    return '# Footnote\nTransparency first.';
                }
                throw new Error('unexpected read');
            },
            allowlistContents: 'README.md\nSECURITY.md\n',
        });
        const result = await source.loadDocuments();
        assert.equal(result.length, 1);
        assert.equal(result[0]?.path, 'README.md');
        assert.match(result[0]?.content ?? '', /Transparency first/);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('createProjectDocumentSource excludes untracked and over-limit files', async () => {
    const root = path.join(
        os.tmpdir(),
        `footnote-project-source-limits-${randomUUID()}`
    );
    await fs.mkdir(root, { recursive: true });
    try {
        await fs.writeFile(path.join(root, 'README.md'), 'small file', 'utf8');
        await fs.writeFile(
            path.join(root, 'large.md'),
            'large file content',
            'utf8'
        );
        const createSource = (maxFileBytes: number) =>
            createProjectDocumentSource({
                repositoryRoot: root,
                trackedPaths: ['README.md', 'large.md'],
                readFile: (filePath) => fs.readFile(filePath, 'utf8'),
                allowlistContents: 'README.md\nlarge.md\nuntracked.md\n',
                maxFileBytes,
            });

        assert.deepEqual(await createSource(5).loadDocuments(), []);
        const result = await createSource(100).loadDocuments();
        assert.deepEqual(
            result.map((document) => document.path),
            ['README.md', 'large.md']
        );
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
