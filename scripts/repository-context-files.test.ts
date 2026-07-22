/**
 * @description: Verifies repository context parsing, Git intersection, path safety, and selection limits.
 * Temporary repositories keep file-tracking behavior isolated from the developer's checkout.
 * @footnote-scope: test
 * @footnote-module: RepositoryContextFilesTests
 * @footnote-risk: medium - Missing safety coverage could allow unintended files into later context loaders.
 * @footnote-ethics: high - Context selection tests protect repository privacy and reviewability.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
    parseRepositoryContextPatterns,
    resolveRepositoryContextFiles,
} from './lib/repository-context-files.js';

const execFileAsync = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const checkedInRepositoryRoot = path.resolve(testDirectory, '..');

type TemporaryRepository = {
    root: string;
    cleanup: () => Promise<void>;
    track: (filePaths: string[], force?: boolean) => Promise<void>;
    write: (filePath: string, contents: string) => Promise<void>;
};

const createTemporaryRepository = async (): Promise<TemporaryRepository> => {
    const root = await fs.mkdtemp(
        path.join(os.tmpdir(), 'footnote-repository-context-')
    );
    await execFileAsync('git', ['init', '--quiet', root]);

    const write = async (filePath: string, contents: string): Promise<void> => {
        const absolutePath = path.join(root, filePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, contents);
    };
    const track = async (filePaths: string[], force = false): Promise<void> => {
        await execFileAsync('git', [
            '-C',
            root,
            'add',
            ...(force ? ['--force'] : []),
            '--',
            ...filePaths,
        ]);
    };

    return {
        root,
        cleanup: () => fs.rm(root, { recursive: true, force: true }),
        track,
        write,
    };
};

const writeAllowlist = async (
    repository: TemporaryRepository,
    contents: string
): Promise<void> => {
    await repository.write('.footnote/context-files', contents);
};

test('checked-in allowlist resolves successfully', async () => {
    const result = await resolveRepositoryContextFiles({
        repositoryRoot: checkedInRepositoryRoot,
    });

    assert.equal(
        result.files.some((file) => file.path === 'README.md'),
        true
    );
    assert.equal(
        result.files.some((file) => file.path === 'AGENTS.md'),
        true
    );
    assert.equal(result.totalBytes > 0, true);
});

test('pattern parsing ignores comments and blank lines', () => {
    assert.deepEqual(
        parseRepositoryContextPatterns(`
# context docs

README.md
docs/**/*.md

!docs/archive/**
`),
        {
            include: ['README.md', 'docs/**/*.md'],
            exclude: ['docs/archive/**'],
        }
    );
});

test('include and exclude patterns select and report tracked files', async () => {
    const repository = await createTemporaryRepository();
    try {
        await writeAllowlist(repository, 'docs/**/*.md\n!docs/archive/**\n');
        await repository.write('docs/current.md', 'current');
        await repository.write('docs/archive/old.md', 'old');
        await repository.track([
            '.footnote/context-files',
            'docs/current.md',
            'docs/archive/old.md',
        ]);

        const result = await resolveRepositoryContextFiles({
            repositoryRoot: repository.root,
        });

        assert.deepEqual(
            result.files.map((file) => file.path),
            ['docs/current.md']
        );
        assert.deepEqual(result.skipped, [
            {
                path: 'docs/archive/old.md',
                reason: 'excluded by pattern',
            },
        ]);
    } finally {
        await repository.cleanup();
    }
});

test('gitignored files are excluded even when tracked', async () => {
    const repository = await createTemporaryRepository();
    try {
        await writeAllowlist(repository, '*.md\n');
        await repository.write('.gitignore', 'ignored.md\n');
        await repository.write('README.md', 'safe');
        await repository.write('ignored.md', 'ignored');
        await repository.track([
            '.footnote/context-files',
            '.gitignore',
            'README.md',
        ]);
        await repository.track(['ignored.md'], true);

        const result = await resolveRepositoryContextFiles({
            repositoryRoot: repository.root,
        });

        assert.deepEqual(
            result.files.map((file) => file.path),
            ['README.md']
        );
    } finally {
        await repository.cleanup();
    }
});

test('untracked files are excluded', async () => {
    const repository = await createTemporaryRepository();
    try {
        await writeAllowlist(repository, '*.md\n');
        await repository.write('README.md', 'tracked');
        await repository.write('draft.md', 'untracked');
        await repository.track(['.footnote/context-files', 'README.md']);

        const result = await resolveRepositoryContextFiles({
            repositoryRoot: repository.root,
        });

        assert.deepEqual(
            result.files.map((file) => file.path),
            ['README.md']
        );
    } finally {
        await repository.cleanup();
    }
});

test('directories are excluded', async () => {
    const repository = await createTemporaryRepository();
    try {
        await writeAllowlist(repository, 'docs/**\n');
        await repository.write('docs/guide.md', 'guide');
        await repository.track(['.footnote/context-files', 'docs/guide.md']);

        const result = await resolveRepositoryContextFiles({
            repositoryRoot: repository.root,
        });

        assert.deepEqual(
            result.files.map((file) => file.path),
            ['docs/guide.md']
        );
    } finally {
        await repository.cleanup();
    }
});

test('symbolic links are not followed', async () => {
    const repository = await createTemporaryRepository();
    try {
        await writeAllowlist(repository, '**/*.md\n');
        await repository.write('source/target.md', 'target');
        await fs.symlink(
            path.join(repository.root, 'source'),
            path.join(repository.root, 'linked'),
            'junction'
        );
        await repository.track(['.footnote/context-files', 'source/target.md']);
        const { stdout: blobHash } = await execFileAsync('git', [
            '-C',
            repository.root,
            'hash-object',
            '-w',
            'source/target.md',
        ]);
        await execFileAsync('git', [
            '-C',
            repository.root,
            'update-index',
            '--add',
            '--cacheinfo',
            '100644',
            blobHash.trim(),
            'linked/target.md',
        ]);

        const result = await resolveRepositoryContextFiles({
            repositoryRoot: repository.root,
        });

        assert.deepEqual(
            result.files.map((file) => file.path),
            ['source/target.md']
        );
    } finally {
        await repository.cleanup();
    }
});

test('absolute and parent traversal patterns are rejected', () => {
    assert.throws(
        () => parseRepositoryContextPatterns('/outside/*.md'),
        /must stay inside the repository/
    );
    assert.throws(
        () => parseRepositoryContextPatterns('C:\\outside\\*.md'),
        /must stay inside the repository/
    );
    assert.throws(
        () => parseRepositoryContextPatterns('../outside/*.md'),
        /must stay inside the repository/
    );
});

test('empty allowlists fail clearly', () => {
    assert.throws(
        () => parseRepositoryContextPatterns('\n# comments only\n'),
        /at least one include pattern/
    );
});

test('allowlists with no matches fail clearly', async () => {
    const repository = await createTemporaryRepository();
    try {
        await writeAllowlist(repository, 'missing/**/*.md\n');
        await repository.write('README.md', 'tracked');
        await repository.track(['.footnote/context-files', 'README.md']);

        await assert.rejects(
            resolveRepositoryContextFiles({
                repositoryRoot: repository.root,
            }),
            /matched no safe, tracked files/
        );
    } finally {
        await repository.cleanup();
    }
});

test('oversized files are skipped and reported', async () => {
    const repository = await createTemporaryRepository();
    try {
        await writeAllowlist(repository, '*.md\n');
        await repository.write('large.md', '12345');
        await repository.track(['.footnote/context-files', 'large.md']);

        const result = await resolveRepositoryContextFiles({
            repositoryRoot: repository.root,
            limits: { maxFileBytes: 4 },
        });

        assert.deepEqual(result.files, []);
        assert.deepEqual(result.skipped, [
            { path: 'large.md', reason: 'larger than 4 bytes' },
        ]);
        assert.equal(result.totalBytes, 0);
    } finally {
        await repository.cleanup();
    }
});

test('file count and combined size limits stop broad selections', async () => {
    const repository = await createTemporaryRepository();
    try {
        await writeAllowlist(repository, '*.md\n');
        await repository.write('one.md', '1234');
        await repository.write('two.md', '5678');
        await repository.track(['.footnote/context-files', 'one.md', 'two.md']);

        await assert.rejects(
            resolveRepositoryContextFiles({
                repositoryRoot: repository.root,
                limits: { maxFiles: 1 },
            }),
            /above the 1-file limit.*Narrow/u
        );
        await assert.rejects(
            resolveRepositoryContextFiles({
                repositoryRoot: repository.root,
                limits: { maxTotalBytes: 7 },
            }),
            /above the 7 bytes combined limit.*Narrow/u
        );
    } finally {
        await repository.cleanup();
    }
});

test('paths use forward slashes and results sort consistently', async () => {
    const repository = await createTemporaryRepository();
    try {
        await writeAllowlist(repository, '**/*.md\n');
        await repository.write('z-last/guide.md', 'z');
        await repository.write('a-first/guide.md', 'a');
        await repository.track([
            '.footnote/context-files',
            'z-last/guide.md',
            'a-first/guide.md',
        ]);

        const result = await resolveRepositoryContextFiles({
            repositoryRoot: repository.root,
        });

        assert.deepEqual(
            result.files.map((file) => file.path),
            ['a-first/guide.md', 'z-last/guide.md']
        );
        assert.equal(
            result.files.every((file) => !file.path.includes('\\')),
            true
        );
    } finally {
        await repository.cleanup();
    }
});
