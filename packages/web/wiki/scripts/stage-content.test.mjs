/**
 * @description: Verifies the generated wiki source map, lifecycle metadata, and canonical links.
 * @footnote-scope: test
 * @footnote-module: WikiContentStagerTests
 * @footnote-risk: medium - A staging regression can publish stale or misattributed documentation.
 * @footnote-ethics: high - Tests protect the authority boundary between repository Markdown and its presentation.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '../..');
const generatedRoot = path.join(packageRoot, 'wiki', 'src', 'content', 'docs');
const stageScript = path.join(
    packageRoot,
    'wiki',
    'scripts',
    'stage-content.mjs'
);

test('stages canonical sources with route, lifecycle, and edit-link metadata', async () => {
    await execFileAsync(process.execPath, [stageScript], {
        cwd: packageRoot,
    });
    try {
        const readGenerated = async (relativePath) =>
            await fs.readFile(path.join(generatedRoot, relativePath), 'utf8');

        const documentation = await readGenerated('documentation.md');
        const proposal = await readGenerated('proposals/winter.md');
        const history = await readGenerated('history.md');
        const architecture = await readGenerated(
            'architecture/public-web-surfaces.md'
        );

        assert.match(documentation, /lifecycle: current/);
        assert.match(documentation, /slug: "documentation"/);
        assert.match(documentation, /\/wiki\/getting-started\/#quickstart/);
        assert.match(documentation, /edit\/main\/docs\/README\.md/);
        assert.match(proposal, /lifecycle: proposal/);
        assert.match(history, /lifecycle: historical/);
        assert.match(architecture, /slug: "architecture\/public-web-surfaces"/);
        assert.match(await readGenerated('index.md'), /slug: ""/);
    } finally {
        await fs.rm(generatedRoot, { recursive: true, force: true });
    }
});
