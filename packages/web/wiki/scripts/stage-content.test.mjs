/**
 * @description: Verifies the generated wiki source map, lifecycle metadata, and canonical links.
 * @footnote-scope: test
 * @footnote-module: WikiContentStagerTests
 * @footnote-risk: medium - A staging regression can publish stale or misattributed documentation.
 * @footnote-ethics: high - Tests protect the authority boundary between repository Markdown and its presentation.
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execPath } from 'node:process';
import { promisify } from 'node:util';
import test from 'node:test';
import {
    stripFirstDocumentHeading,
    titleForMarkdown,
} from './stage-content.mjs';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const generatedRoot = path.join(packageRoot, 'wiki', 'src', 'content', 'docs');
const machineReadableRoot = path.join(packageRoot, 'wiki', 'public');
const stageScript = path.join(
    packageRoot,
    'wiki',
    'scripts',
    'stage-content.mjs'
);

test('keeps shorter and annotated fence lines opaque', () => {
    const content = [
        '```',
        '# inside the fence',
        '``',
        '# still inside the fence',
        '``` trailing text',
        '# also inside the fence',
        '````',
        '# first heading outside the fence',
        '# second heading outside the fence',
    ].join('\n');

    const stripped = stripFirstDocumentHeading(content);
    assert.match(stripped, /# inside the fence/u);
    assert.match(stripped, /# still inside the fence/u);
    assert.match(stripped, /# also inside the fence/u);
    assert.doesNotMatch(stripped, /# first heading outside the fence/u);
    assert.match(stripped, /# second heading outside the fence/u);
});

test('uses and removes the first Setext H1 outside fenced code', () => {
    const content = [
        '```',
        'Fenced text',
        '===',
        '```',
        '',
        'Setext title',
        '===',
        '',
        'Body',
    ].join('\n');

    assert.equal(titleForMarkdown('fallback.md', content), 'Setext title');
    const stripped = stripFirstDocumentHeading(content);
    assert.equal(
        stripped,
        ['```', 'Fenced text', '===', '```', '', '', 'Body'].join('\n')
    );
});

test('stages canonical sources with route, lifecycle, and edit-link metadata', async () => {
    const documentationSourcePath = path.join(
        repositoryRoot,
        'docs',
        'README.md'
    );
    const documentationSource = await fs.readFile(
        documentationSourcePath,
        'utf8'
    );
    const fixtureStem = `fixture-${randomUUID()}`;
    const assetPath = path.join(
        repositoryRoot,
        'docs',
        'assets',
        `${fixtureStem}.png`
    );
    const unsafeAssetPath = path.join(
        repositoryRoot,
        'docs',
        'assets',
        `${fixtureStem}.svg`
    );
    const assetContents = Buffer.from([137, 80, 78, 71]);
    try {
        await execFileAsync(execPath, [stageScript], {
            cwd: packageRoot,
        });
        const readGenerated = async (relativePath) =>
            await fs.readFile(path.join(generatedRoot, relativePath), 'utf8');

        const documentation = await readGenerated('documentation.md');
        const proposal = await readGenerated('proposals/winter.md');
        const history = await readGenerated('history.md');
        const architectureGuide = await readGenerated('architecture.md');
        const architecture = await readGenerated(
            'architecture/public-web-surfaces.md'
        );
        const machineIndex = await fs.readFile(
            path.join(machineReadableRoot, 'llms.txt'),
            'utf8'
        );
        const machineFull = await fs.readFile(
            path.join(machineReadableRoot, 'llms-full.txt'),
            'utf8'
        );

        assert.match(documentation, /lifecycle: current/);
        assert.match(documentation, /slug: "documentation"/);
        assert.match(documentation, /lastUpdated: \d{4}-\d{2}-\d{2}T/u);
        assert.match(documentation, /\/wiki\/getting-started\/#quickstart/);
        assert.match(architectureGuide, /^##\s+Important Concepts/mu);
        assert.match(documentation, /blob\/main\/docs\/README\.md/);
        assert.match(documentation, /commits\/main\/docs\/README\.md/);
        assert.match(documentation, /edit\/main\/docs\/README\.md/);
        assert.match(proposal, /lifecycle: proposal/);
        assert.match(history, /lifecycle: historical/);
        assert.match(architecture, /slug: "architecture\/public-web-surfaces"/);
        const landing = await readGenerated('index.md');
        assert.match(
            landing,
            /Footnote is an AI assistant that shows how its answers were made\./u
        );
        assert.doesNotMatch(landing, /transparency-first AI framework/u);
        assert.match(landing, /slug: ""/);
        assert.match(machineIndex, /^# Footnote Documentation$/mu);
        assert.match(machineIndex, /\/wiki\/getting-started\//u);
        assert.match(
            machineIndex,
            /source revision: (?:`[0-9a-f]{40}`|unavailable for this build)/u
        );
        assert.match(machineFull, /source path: `docs\/README\.md`/u);
        assert.match(machineFull, /lifecycle: current/u);

        await fs.writeFile(
            documentationSourcePath,
            `${documentationSource}\n# Second temporary heading\n`,
            'utf8'
        );
        await execFileAsync(execPath, [stageScript], { cwd: packageRoot });
        const stagedWithTwoHeadings = await readGenerated('documentation.md');
        assert.doesNotMatch(stagedWithTwoHeadings, /^# Documentation Map$/mu);
        assert.match(stagedWithTwoHeadings, /^# Second temporary heading$/mu);
        const dirtySourceMachineFull = await fs.readFile(
            path.join(machineReadableRoot, 'llms-full.txt'),
            'utf8'
        );
        assert.match(
            dirtySourceMachineFull,
            /source revision: unavailable for this build/u
        );

        await fs.mkdir(path.dirname(assetPath), { recursive: true });
        await fs.writeFile(assetPath, assetContents);
        await fs.writeFile(
            unsafeAssetPath,
            '<svg xmlns="http://www.w3.org/2000/svg" />',
            'utf8'
        );
        await fs.writeFile(
            documentationSourcePath,
            `${documentationSource}\n![fixture](assets/${fixtureStem}.png)\n`,
            'utf8'
        );
        await execFileAsync(execPath, [stageScript], { cwd: packageRoot });
        assert.match(
            await fs.readFile(
                path.join(generatedRoot, 'documentation.md'),
                'utf8'
            ),
            new RegExp(`/wiki/assets/${fixtureStem}\\.png`, 'u')
        );
        assert.deepEqual(
            await fs.readFile(
                path.join(
                    packageRoot,
                    'wiki',
                    'public',
                    'assets',
                    `${fixtureStem}.png`
                )
            ),
            assetContents
        );
        await assert.rejects(
            fs.access(
                path.join(
                    packageRoot,
                    'wiki',
                    'public',
                    'assets',
                    `${fixtureStem}.svg`
                )
            ),
            /ENOENT/u
        );
    } finally {
        await Promise.all(
            [assetPath, unsafeAssetPath].map((temporaryAssetPath) =>
                fs.rm(temporaryAssetPath, { force: true })
            )
        );
        await fs.writeFile(
            documentationSourcePath,
            documentationSource,
            'utf8'
        );
        await fs.rm(generatedRoot, { recursive: true, force: true });
        await fs.rm(path.join(packageRoot, 'wiki', 'public', 'assets'), {
            recursive: true,
            force: true,
        });
        await Promise.all(
            ['llms.txt', 'llms-full.txt'].map((fileName) =>
                fs.rm(path.join(machineReadableRoot, fileName), {
                    force: true,
                })
            )
        );
    }
});

test('marks the revision unavailable when a tracked Markdown source is deleted', async () => {
    const sourcePath = path.join(
        repositoryRoot,
        'docs',
        'architecture',
        'embedding.md'
    );
    const source = await fs.readFile(sourcePath, 'utf8');

    try {
        await fs.rm(sourcePath);
        await execFileAsync(execPath, [stageScript], { cwd: packageRoot });

        const machineFull = await fs.readFile(
            path.join(machineReadableRoot, 'llms-full.txt'),
            'utf8'
        );
        assert.match(
            machineFull,
            /source revision: unavailable for this build/u
        );
    } finally {
        await fs.writeFile(sourcePath, source, 'utf8');
        await fs.rm(generatedRoot, { recursive: true, force: true });
        await fs.rm(path.join(packageRoot, 'wiki', 'public', 'assets'), {
            recursive: true,
            force: true,
        });
        await Promise.all(
            ['llms.txt', 'llms-full.txt'].map((fileName) =>
                fs.rm(path.join(machineReadableRoot, fileName), {
                    force: true,
                })
            )
        );
    }
});
