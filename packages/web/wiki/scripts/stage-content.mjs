/**
 * @description: Stages canonical repository Markdown for the isolated Starlight build.
 * @footnote-scope: web
 * @footnote-module: WikiContentStager
 * @footnote-risk: medium - Incorrect source mapping can publish stale or misleading documentation links.
 * @footnote-ethics: high - The staging boundary must preserve canonical authority and avoid silently changing meaning.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const repositoryRoot = path.resolve(packageRoot, '../..');
const sourceRoot = path.join(packageRoot, 'wiki', 'src', 'content', 'docs');
const sourceUrlBase = 'https://github.com/footnote-ai/footnote/blob/main/';
const editUrlBase = 'https://github.com/footnote-ai/footnote/edit/main/';

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

const titleForMarkdown = (sourcePath, content) => {
    const heading = content.match(/^#\s+(.+)$/mu)?.[1]?.trim();
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
    const markdownRoute = routeBySource.get(resolved.relative);
    if (markdownRoute) {
        return `/wiki/${markdownRoute}/${resolved.anchor}`;
    }
    return `${githubSourceUrl(resolved.relative)}${resolved.anchor}`;
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
    const frontmatter = [
        '---',
        `title: ${quoteYaml(title)}`,
        `slug: ${quoteYaml(route)}`,
        `lifecycle: ${lifecycle}`,
        `editUrl: ${quoteYaml(`${editUrlBase}${toPosix(sourcePath)}`)}`,
        '---',
        '',
    ].join('\n');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(
        targetPath,
        `${frontmatter}${adaptMarkdownLinks(sourcePath, content)}`,
        'utf8'
    );
};

const main = async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true });
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
            'title: "Footnote Documentation"',
            'slug: ""',
            'lifecycle: current',
            'editUrl: false',
            '---',
            '',
            'Footnote is a transparency-first AI framework that pairs responses with inspectable provenance and trace metadata.',
            '',
            'Use the navigation to explore the canonical repository documentation. The published wiki is a presentation of checked-in Markdown; Git history and implementation remain the authority.',
            '',
            '[Read the documentation map](/wiki/documentation/)',
            '',
        ].join('\n'),
        'utf8'
    );
};

await main();
