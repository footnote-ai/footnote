/**
 * @description: Stages canonical repository Markdown for the isolated Starlight build.
 * @footnote-scope: web
 * @footnote-module: WikiContentStager
 * @footnote-risk: medium - Incorrect source mapping can publish stale or misleading documentation links.
 * @footnote-ethics: high - The staging boundary must preserve canonical authority and avoid silently changing meaning.
 */
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
    readVerifiedSourceRevision,
    writeMachineReadableFiles,
} from './machine-readable.mjs';

const packageRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const repositoryRoot = path.resolve(packageRoot, '../..');
const sourceRoot = path.join(packageRoot, 'wiki', 'src', 'content', 'docs');
const documentationAssetsRoot = path.join(repositoryRoot, 'docs', 'assets');
const stagedAssetsRoot = path.join(packageRoot, 'wiki', 'public', 'assets');
const machineReadableOutputRoot = path.join(packageRoot, 'wiki', 'public');
const sourceUrlBase = 'https://github.com/footnote-ai/footnote/blob/main/';
const editUrlBase = 'https://github.com/footnote-ai/footnote/edit/main/';
const historyUrlBase = 'https://github.com/footnote-ai/footnote/commits/main/';
const execFileAsync = promisify(execFile);
const bundledRevisionDatePath = path.join(
    repositoryRoot,
    '.footnote',
    'context-bundle',
    'revision-date.txt'
);

const sourceFiles = [
    'README.md',
    'SECURITY.md',
    'MIT_LICENSE.md',
    'HIPPOCRATIC_LICENSE.md',
    'deploy/README.md',
    'docs/Philosophy.md',
    'docs/History.md',
    'docs/README.md',
    'docs/ai/README.md',
    'docs/ai/ai-use-disclosure.md',
    'docs/ai/github-work-management.md',
    'docs/agents/deepwiki-maintenance.md',
    'docs/agents/domain.md',
    'docs/agents/issue-tracker.md',
    'docs/agents/triage-labels.md',
];

const sourceDirectories = [
    'docs/api',
    'docs/architecture',
    'docs/auth',
    'docs/ci',
    'docs/decisions',
    'docs/proposals',
    'docs/status',
];

const toPosix = (value) => value.split(path.sep).join('/');

const stripMarkdownExtension = (value) => value.replace(/\.md$/u, '');

const routeForSource = (sourcePath) => {
    const normalized = toPosix(sourcePath);
    const specialRoutes = new Map([
        ['README.md', 'getting-started'],
        ['SECURITY.md', 'security'],
        ['MIT_LICENSE.md', 'licenses/mit'],
        ['HIPPOCRATIC_LICENSE.md', 'licenses/hippocratic'],
        ['deploy/README.md', 'deployment'],
        ['docs/README.md', 'documentation'],
        ['docs/Philosophy.md', 'philosophy'],
        ['docs/History.md', 'history'],
    ]);
    const specialRoute = specialRoutes.get(normalized);
    if (specialRoute) {
        return specialRoute;
    }

    if (!normalized.startsWith('docs/')) {
        return stripMarkdownExtension(normalized);
    }

    const docsPath = normalized.slice('docs/'.length);
    if (docsPath.endsWith('/README.md')) {
        return docsPath.slice(0, -'/README.md'.length);
    }
    if (docsPath.endsWith('/index.md')) {
        return docsPath.slice(0, -'/index.md'.length);
    }
    return stripMarkdownExtension(docsPath);
};

const lifecycleForSource = (sourcePath) => {
    const normalized = toPosix(sourcePath);
    if (normalized.startsWith('docs/proposals/')) {
        return 'proposal';
    }
    if (
        normalized === 'docs/History.md' ||
        normalized.startsWith('docs/status/completed/')
    ) {
        return 'historical';
    }
    return 'current';
};

const firstDocumentHeading = (content) => {
    const lines = content.split('\n');
    let fence;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].replace(/\r$/u, '');
        if (fence) {
            const closingFence = line.match(/^ {0,3}([`~]+)([ \t]*)$/u);
            if (
                closingFence &&
                closingFence[1][0] === fence.marker &&
                closingFence[1].length >= fence.length
            ) {
                fence = undefined;
            }
            continue;
        }

        const openingFence = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
        if (openingFence) {
            fence = {
                marker: openingFence[0],
                length: openingFence.length,
            };
            continue;
        }

        const atxHeading = line.match(/^ {0,3}#\s+(.+)$/u)?.[1]?.trim();
        if (atxHeading) {
            return { end: index, start: index, text: atxHeading };
        }

        const setextHeading = lines[index + 1]
            ?.replace(/\r$/u, '')
            .match(/^ {0,3}=+[ \t]*$/u);
        if (line.trim() && setextHeading) {
            return { end: index + 1, start: index, text: line.trim() };
        }
    }
    return undefined;
};

const titleForMarkdown = (sourcePath, content) => {
    const heading = firstDocumentHeading(content)?.text;
    if (heading) {
        return heading;
    }
    return path
        .basename(sourcePath, path.extname(sourcePath))
        .replace(/[_-]+/gu, ' ');
};

const quoteYaml = (value) => JSON.stringify(value);

const routeBySource = new Map();
const githubSourceUrl = (sourcePath) =>
    `${sourceUrlBase}${toPosix(sourcePath)}`;
const githubHistoryUrl = (sourcePath) =>
    `${historyUrlBase}${toPosix(sourcePath)}`;

const readGitDate = async (sourcePath) => {
    const { stdout } = await execFileAsync(
        'git',
        ['-C', repositoryRoot, 'log', '-1', '--format=%cI', '--', sourcePath],
        { encoding: 'utf8' }
    );
    const value = stdout.trim();
    return value.length > 0 ? value : undefined;
};

const readBundledRevisionDate = async () => {
    try {
        const value = (
            await fs.readFile(bundledRevisionDatePath, 'utf8')
        ).trim();
        return value.length > 0 ? value : undefined;
    } catch (error) {
        const err = error;
        if (err?.code === 'ENOENT') return undefined;
        throw err;
    }
};

const lastUpdatedForSource = async (sourcePath) => {
    let value;
    try {
        value = await readGitDate(sourcePath);
    } catch {
        value = await readBundledRevisionDate();
    }
    if (!value || Number.isNaN(Date.parse(value))) {
        throw new Error(
            `Unable to determine a trusted Git date for ${sourcePath}.`
        );
    }
    return value;
};

const markdownFilesUnder = async (relativeDirectory) => {
    const directory = path.join(repositoryRoot, relativeDirectory);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const relativePath = path.join(relativeDirectory, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await markdownFilesUnder(relativePath)));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(toPosix(relativePath));
        }
    }
    return files;
};

const resolveSourceTarget = (sourcePath, target) => {
    const [targetPath, anchor = ''] = target.split('#', 2);
    const resolved = path.normalize(
        path.join(
            path.dirname(path.join(repositoryRoot, sourcePath)),
            targetPath
        )
    );
    if (!resolved.startsWith(repositoryRoot)) {
        return undefined;
    }
    const relative = toPosix(path.relative(repositoryRoot, resolved));
    return { relative, anchor: anchor.length > 0 ? `#${anchor}` : '' };
};

const publicLinkForTarget = (sourcePath, target) => {
    if (target.startsWith('#')) {
        return target;
    }
    const resolved = resolveSourceTarget(sourcePath, target);
    if (!resolved) {
        return target;
    }
    if (resolved.relative.startsWith('docs/assets/')) {
        const assetPath = resolved.relative.slice('docs/assets/'.length);
        return `/wiki/assets/${assetPath}${resolved.anchor}`;
    }
    const markdownRoute = routeBySource.get(resolved.relative);
    if (markdownRoute) {
        return `/wiki/${markdownRoute}/${resolved.anchor}`;
    }
    return `${githubSourceUrl(resolved.relative)}${resolved.anchor}`;
};

const stripFirstDocumentHeading = (content) => {
    const lines = content.split('\n');
    const heading = firstDocumentHeading(content);
    if (heading) {
        lines.splice(heading.start, heading.end - heading.start + 1);
        return lines.join('\n');
    }
    return content;
};

const safeDocumentationAssetExtensions = new Set([
    '.avif',
    '.bmp',
    '.gif',
    '.jpeg',
    '.jpg',
    '.mp3',
    '.mp4',
    '.ogg',
    '.png',
    '.wav',
    '.webm',
    '.webp',
]);

const isSafeDocumentationAsset = (sourcePath) =>
    safeDocumentationAssetExtensions.has(
        path.extname(sourcePath).toLowerCase()
    );

const copyDocumentationAssets = async () => {
    await fs.rm(stagedAssetsRoot, { recursive: true, force: true });
    try {
        await fs.cp(documentationAssetsRoot, stagedAssetsRoot, {
            filter: async (sourcePath) => {
                const stats = await fs.lstat(sourcePath);
                return (
                    stats.isDirectory() ||
                    (stats.isFile() && isSafeDocumentationAsset(sourcePath))
                );
            },
            recursive: true,
        });
    } catch (error) {
        const err = error;
        if (err?.code !== 'ENOENT') {
            throw error;
        }
    }
};

const adaptMarkdownLinks = (sourcePath, content) =>
    content.replace(
        /(\]\()([^\s)]+)(\))/gu,
        (match, prefix, target, suffix) => {
            if (
                target.startsWith('http://') ||
                target.startsWith('https://') ||
                target.startsWith('mailto:')
            ) {
                return match;
            }
            return `${prefix}${publicLinkForTarget(sourcePath, target)}${suffix}`;
        }
    );

const stageFile = async (sourcePath) => {
    const absoluteSource = path.join(repositoryRoot, sourcePath);
    const content = await fs.readFile(absoluteSource, 'utf8');
    const route = routeForSource(sourcePath);
    const targetPath = path.join(sourceRoot, `${route}.md`);
    const title = titleForMarkdown(sourcePath, content);
    const lifecycle = lifecycleForSource(sourcePath);
    const lastUpdated = await lastUpdatedForSource(sourcePath);
    const frontmatter = [
        '---',
        `title: ${quoteYaml(title)}`,
        `slug: ${quoteYaml(route)}`,
        `lifecycle: ${lifecycle}`,
        `lastUpdated: ${lastUpdated}`,
        `editUrl: ${quoteYaml(`${editUrlBase}${toPosix(sourcePath)}`)}`,
        '---',
        '',
    ].join('\n');
    const adaptedContent = adaptMarkdownLinks(
        sourcePath,
        stripFirstDocumentHeading(content)
    );
    const contentWithCanonicalLinks = `${adaptedContent}${
        adaptedContent.endsWith('\n') ? '' : '\n'
    }\n---\n\n[Canonical source](${githubSourceUrl(sourcePath)}) · [File history](${githubHistoryUrl(sourcePath)})\n`;
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(
        targetPath,
        `${frontmatter}${contentWithCanonicalLinks}`,
        'utf8'
    );
};

const main = async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
    await copyDocumentationAssets();
    const allFiles = [
        ...sourceFiles,
        ...(
            await Promise.all(sourceDirectories.map(markdownFilesUnder))
        ).flat(),
    ];
    for (const sourcePath of allFiles) {
        routeBySource.set(toPosix(sourcePath), routeForSource(sourcePath));
    }
    for (const sourcePath of allFiles) {
        await stageFile(sourcePath);
    }
    await fs.writeFile(
        path.join(sourceRoot, 'index.md'),
        [
            '---',
            'title: "Welcome"',
            'slug: ""',
            'lifecycle: current',
            'editUrl: false',
            '---',
            '',
            'Footnote is an AI assistant that shows how its answers were made.',
            '',
            'Use the navigation to explore sources, workflows, and the canonical repository documentation. The published wiki presents checked-in Markdown; Git history and implementation remain the authority.',
            '',
            '[Read the documentation map](/wiki/documentation/)',
            '',
        ].join('\n'),
        'utf8'
    );
    const sourceRevision = await readVerifiedSourceRevision(
        repositoryRoot,
        allFiles
    );
    await writeMachineReadableFiles({
        stagedRoot: sourceRoot,
        outputRoot: machineReadableOutputRoot,
        sourceRevision,
    });
};

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    await main();
}

export { stripFirstDocumentHeading, titleForMarkdown };
