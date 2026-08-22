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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
    createProjectDocumentSource,
    loadPackagedProjectDocumentSet,
    loadGitProjectDocumentSet,
    parseProjectContextManifest,
    projectGlobToRegex,
} from '../src/services/contextIntegrations/projectContext/documentSource.js';

const execFileAsync = promisify(execFile);

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

test('packaged project context loads only manifest entries and preserves its revision', async () => {
    const root = path.join(
        os.tmpdir(),
        `footnote-project-bundle-${randomUUID()}`
    );
    await fs.mkdir(path.join(root, '.footnote', 'context-bundle', 'docs'), {
        recursive: true,
    });
    try {
        await fs.writeFile(
            path.join(root, '.footnote', 'context-files'),
            'README.md\ndocs/status.md\n',
            'utf8'
        );
        await fs.writeFile(
            path.join(root, '.footnote', 'context-manifest.json'),
            JSON.stringify([
                {
                    path: 'README.md',
                    category: 'documented_behavior',
                    priority: 2,
                },
                {
                    path: 'docs/status.md',
                    category: 'current_state',
                    priority: 3,
                },
            ]),
            'utf8'
        );
        await fs.writeFile(
            path.join(root, '.footnote', 'context-bundle', 'revision.txt'),
            '0123456789abcdef\n',
            'utf8'
        );
        await fs.writeFile(
            path.join(root, '.footnote', 'context-bundle', 'README.md'),
            'Bundled behavior.',
            'utf8'
        );
        await fs.writeFile(
            path.join(root, '.footnote', 'context-bundle', 'docs', 'status.md'),
            'Bundled current state.',
            'utf8'
        );
        await fs.writeFile(
            path.join(root, '.footnote', 'context-bundle', 'unlisted.md'),
            'Must not be loaded.',
            'utf8'
        );

        const result = await loadPackagedProjectDocumentSet(root);
        assert.ok(result);
        assert.equal(result?.source, 'bundle');
        assert.equal(result?.revision, '0123456789abcdef');
        assert.deepEqual(
            result?.documents.map((document) => [
                document.path,
                document.category,
            ]),
            [
                ['docs/status.md', 'current_state'],
                ['README.md', 'documented_behavior'],
            ]
        );
        assert.deepEqual(
            parseProjectContextManifest(
                await fs.readFile(
                    path.join(root, '.footnote', 'context-manifest.json'),
                    'utf8'
                )
            ).map((entry) => entry.path),
            ['README.md', 'docs/status.md']
        );
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('git-backed project context reads the captured commit, not dirty working-tree bytes', async () => {
    const root = path.join(os.tmpdir(), `footnote-project-git-${randomUUID()}`);
    await fs.mkdir(path.join(root, '.footnote'), { recursive: true });
    try {
        await execFileAsync('git', ['-C', root, 'init', '-q']);
        await execFileAsync('git', [
            '-C',
            root,
            'config',
            'user.email',
            'test@example.com',
        ]);
        await execFileAsync('git', [
            '-C',
            root,
            'config',
            'user.name',
            'Footnote Test',
        ]);
        await fs.writeFile(
            path.join(root, '.footnote', 'context-files'),
            'README.md\n',
            'utf8'
        );
        await fs.writeFile(
            path.join(root, '.footnote', 'context-manifest.json'),
            JSON.stringify([
                {
                    path: 'README.md',
                    category: 'documented_behavior',
                    priority: 1,
                },
            ]),
            'utf8'
        );
        await fs.writeFile(
            path.join(root, 'README.md'),
            'Committed bytes.',
            'utf8'
        );
        await execFileAsync('git', ['-C', root, 'add', '.']);
        await execFileAsync('git', [
            '-C',
            root,
            'commit',
            '-qm',
            'test context revision',
        ]);
        await fs.writeFile(
            path.join(root, 'README.md'),
            'Dirty bytes.',
            'utf8'
        );

        const result = await loadGitProjectDocumentSet(root);
        assert.equal(result.source, 'git');
        assert.match(result.revision ?? '', /^[0-9a-f]{40}$/u);
        assert.equal(result.documents[0]?.content, 'Committed bytes.');
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
