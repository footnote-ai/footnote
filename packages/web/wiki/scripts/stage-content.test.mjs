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
import { execPath } from 'node:process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '../..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const generatedRoot = path.join(packageRoot, 'wiki', 'src', 'content', 'docs');
const stageScript = path.join(
    packageRoot,
    'wiki',
    'scripts',
    'stage-content.mjs'
);

test('stages canonical sources with route, lifecycle, and edit-link metadata', async () => {
    await execFileAsync(execPath, [stageScript], {
        cwd: packageRoot,
    });
    let documentationSource;
    try {
        const readGenerated = async (relativePath) =>
            await fs.readFile(path.join(generatedRoot, relativePath), 'utf8');

        const documentation = await readGenerated('documentation.md');
        const proposal = await readGenerated('proposals/winter.md');
        const history = await readGenerated('history.md');
        const architectureGuide = await readGenerated('architecture.md');
        const architecture = await readGenerated(
            'architecture/public-web-surfaces.md'
        );

        assert.match(documentation, /lifecycle: current/);
        assert.match(documentation, /slug: "documentation"/);
        assert.match(documentation, /lastUpdated: \d{4}-\d{2}-\d{2}T/u);
        assert.match(documentation, /\/wiki\/getting-started\/#quickstart/);
        assert.doesNotMatch(documentation, /^#\s+/mu);
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

        const assetPath = path.join(
            repositoryRoot,
            'docs',
            'assets',
            'fixture.svg'
        );
        const documentationSourcePath = path.join(
            repositoryRoot,
            'docs',
            'README.md'
        );
        documentationSource = await fs.readFile(
            documentationSourcePath,
            'utf8'
        );
        await fs.mkdir(path.dirname(assetPath), { recursive: true });
        await fs.writeFile(
            assetPath,
            '<svg xmlns="http://www.w3.org/2000/svg" />',
            'utf8'
        );
        await fs.writeFile(
            documentationSourcePath,
            `${documentationSource}\n![fixture](assets/fixture.svg)\n`,
            'utf8'
        );
        await execFileAsync(execPath, [stageScript], { cwd: packageRoot });
        assert.match(
            await fs.readFile(
                path.join(generatedRoot, 'documentation.md'),
                'utf8'
            ),
            /\/wiki\/assets\/fixture\.svg/u
        );
        assert.equal(
            await fs.readFile(
                path.join(
                    packageRoot,
                    'wiki',
                    'public',
                    'assets',
                    'fixture.svg'
                ),
                'utf8'
            ),
            '<svg xmlns="http://www.w3.org/2000/svg" />'
        );
    } finally {
        await fs.rm(
            path.join(repositoryRoot, 'docs', 'assets', 'fixture.svg'),
            {
                force: true,
            }
        );
        if (typeof documentationSource !== 'undefined') {
            await fs.writeFile(
                path.join(repositoryRoot, 'docs', 'README.md'),
                documentationSource,
                'utf8'
            );
        }
        await fs.rm(generatedRoot, { recursive: true, force: true });
        await fs.rm(path.join(packageRoot, 'wiki', 'public', 'assets'), {
            recursive: true,
            force: true,
        });
    }
});
