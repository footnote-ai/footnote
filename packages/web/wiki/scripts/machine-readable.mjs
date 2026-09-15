/**
 * @description: Creates the machine-readable documentation projection from staged Starlight Markdown.
 * @footnote-scope: web
 * @footnote-module: MachineReadableDocumentation
 * @footnote-risk: medium - Projection metadata or links can mislead machine clients about canonical source state.
 * @footnote-ethics: high - Machine access must preserve the same source ownership, lifecycle, and availability boundaries as the public wiki.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const revisionPattern = /^[0-9a-f]{7,64}$/u;
const repositoryName = 'footnote-ai/footnote';
const repositoryUrl = `https://github.com/${repositoryName}`;
const publicWikiPath = '/wiki';
const publicWikiUrl = 'https://ai.jordanmakes.dev/wiki';
const machineDocumentationTitle = 'Footnote Documentation';
const machineDocumentationDescription =
    'Repository-owned public documentation for the transparency-first Footnote AI framework.';

const normalizeNewlines = (value) => value.replace(/\r\n/gu, '\n');

const parseFrontmatter = (content) => {
    const normalized = normalizeNewlines(content);
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n/u);
    if (!match) {
        return { attributes: {}, content: normalized };
    }

    const attributes = {};
    for (const line of match[1].split('\n')) {
        const separator = line.indexOf(':');
        if (separator < 1) continue;
        const key = line.slice(0, separator).trim();
        const rawValue = line.slice(separator + 1).trim();
        if (!key || !rawValue) continue;
        try {
            attributes[key] = JSON.parse(rawValue);
        } catch {
            attributes[key] = rawValue;
        }
    }

    return {
        attributes,
        content: normalized.slice(match[0].length),
    };
};

const sourcePathFromUrl = (sourceUrl) => {
    const prefix = `${repositoryUrl}/blob/main/`;
    return sourceUrl?.startsWith(prefix)
        ? sourceUrl.slice(prefix.length)
        : undefined;
};

const documentFromStagedMarkdown = (relativePath, content) => {
    const parsed = parseFrontmatter(content);
    const sourceUrl = parsed.content.match(
        /\[Canonical source\]\(([^)]+)\)/u
    )?.[1];
    const slug =
        typeof parsed.attributes.slug === 'string'
            ? parsed.attributes.slug
            : relativePath.replace(/\.md$/u, '');
    const publicUrl = `${publicWikiUrl}/${slug.length > 0 ? `${slug}/` : ''}`;

    return {
        title:
            typeof parsed.attributes.title === 'string'
                ? parsed.attributes.title
                : slug || 'Untitled document',
        slug,
        lifecycle:
            typeof parsed.attributes.lifecycle === 'string'
                ? parsed.attributes.lifecycle
                : 'unavailable',
        lastUpdated:
            typeof parsed.attributes.lastUpdated === 'string'
                ? parsed.attributes.lastUpdated
                : undefined,
        publicUrl,
        sourceUrl,
        sourcePath: sourcePathFromUrl(sourceUrl),
        historyUrl: parsed.content.match(/\[File history\]\(([^)]+)\)/u)?.[1],
        content: parsed.content,
    };
};

const markdownFilesUnder = async (root, relativeDirectory = '') => {
    const absoluteDirectory = path.join(root, relativeDirectory);
    const entries = (
        await fs.readdir(absoluteDirectory, {
            withFileTypes: true,
        })
    ).sort((left, right) => left.name.localeCompare(right.name));
    const files = [];
    for (const entry of entries) {
        const relativePath = path.join(relativeDirectory, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await markdownFilesUnder(root, relativePath)));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(relativePath.split(path.sep).join('/'));
        }
    }
    return files;
};

const readStagedDocuments = async (stagedRoot) => {
    const relativePaths = await markdownFilesUnder(stagedRoot);
    const documents = [];
    for (const relativePath of relativePaths) {
        const content = await fs.readFile(
            path.join(stagedRoot, relativePath),
            'utf8'
        );
        documents.push(documentFromStagedMarkdown(relativePath, content));
    }
    return documents.sort((left, right) => {
        if (left.slug === '') return -1;
        if (right.slug === '') return 1;
        return left.publicUrl.localeCompare(right.publicUrl);
    });
};

const revisionDescription = (sourceRevision) =>
    sourceRevision
        ? `source revision: \`${sourceRevision}\``
        : 'source revision: unavailable for this build';

const documentSourceDescription = (document) => {
    if (document.sourceUrl) {
        return `canonical source: ${document.sourceUrl}`;
    }
    return 'canonical source: unavailable (generated wiki landing page)';
};

const documentMetadataLines = (document, sourceRevision) => [
    `- public URL: ${document.publicUrl}`,
    `- ${documentSourceDescription(document)}`,
    ...(document.sourcePath
        ? [`- source path: \`${document.sourcePath}\``]
        : []),
    ...(document.historyUrl ? [`- file history: ${document.historyUrl}`] : []),
    `- lifecycle: ${document.lifecycle}`,
    `- last updated: ${document.lastUpdated ?? 'unavailable'}`,
    `- ${revisionDescription(sourceRevision)}`,
];

/** Render the small discovery index consumed by machine clients. */
const renderMachineReadableIndex = ({ documents, sourceRevision }) => {
    const lines = [
        `# ${machineDocumentationTitle}`,
        '',
        `> ${machineDocumentationDescription}`,
        '',
        `This index is generated during the existing \`${publicWikiPath}/\` build from checked-in repository Markdown. The repository source, Git history, and implementation remain authoritative.`,
        '',
        `- ${revisionDescription(sourceRevision)}`,
        `- repository: \`${repositoryName}\``,
        `- full Markdown projection: ${publicWikiUrl}/llms-full.txt`,
        `- HTML documentation: ${publicWikiUrl}/`,
        '',
        '## Documents',
        '',
    ];

    for (const document of documents) {
        const details = [
            `lifecycle: ${document.lifecycle}`,
            `last updated: ${document.lastUpdated ?? 'unavailable'}`,
            document.sourceUrl
                ? `canonical source: ${document.sourceUrl}`
                : 'canonical source: unavailable (generated wiki landing page)',
        ].join('; ');
        lines.push(`- [${document.title}](${document.publicUrl}) — ${details}`);
    }

    return `${lines.join('\n')}\n`;
};

/** Render the full Markdown projection while retaining per-document metadata. */
const renderMachineReadableFull = ({ documents, sourceRevision }) => {
    const lines = [
        `# ${machineDocumentationTitle}`,
        '',
        `> ${machineDocumentationDescription}`,
        '',
        `This full projection is generated during the existing \`${publicWikiPath}/\` build from staged Markdown. It is a convenience for machine clients, not a second documentation authority.`,
        '',
        `- repository: \`${repositoryName}\``,
        `- ${revisionDescription(sourceRevision)}`,
        '',
    ];

    for (const document of documents) {
        lines.push(`## ${document.title}`, '');
        lines.push(...documentMetadataLines(document, sourceRevision), '');
        if (document.content.trim().length > 0) {
            lines.push(document.content.trimEnd(), '');
        }
    }

    return `${lines.join('\n')}\n`;
};

const readGitRevision = async (repositoryRoot) => {
    const { stdout } = await execFileAsync(
        'git',
        ['-C', repositoryRoot, 'rev-parse', '--verify', 'HEAD^{commit}'],
        { encoding: 'utf8' }
    );
    const revision = stdout.trim();
    return revisionPattern.test(revision) ? revision : undefined;
};

const readGitStatusForSources = async (repositoryRoot, sourcePaths) => {
    const { stdout } = await execFileAsync(
        'git',
        [
            '-C',
            repositoryRoot,
            'status',
            '--short',
            '--untracked-files=all',
            '--',
            ...sourcePaths,
        ],
        { encoding: 'utf8' }
    );
    return stdout.trim();
};

const readBundledRevision = async (repositoryRoot) => {
    try {
        const value = await fs.readFile(
            path.join(
                repositoryRoot,
                '.footnote',
                'context-bundle',
                'revision.txt'
            ),
            'utf8'
        );
        const revision = value.trim();
        return revisionPattern.test(revision) ? revision : undefined;
    } catch {
        return undefined;
    }
};

/**
 * Resolve an exact source revision only when the build can prove the staged source is clean.
 * A packaged build may use the revision-safe context bundle when Git is unavailable; uncertain local state stays explicitly unavailable.
 */
const readVerifiedSourceRevision = async (repositoryRoot, sourcePaths) => {
    try {
        const revision = await readGitRevision(repositoryRoot);
        if (!revision) return undefined;
        const status = await readGitStatusForSources(
            repositoryRoot,
            sourcePaths
        );
        return status.length === 0 ? revision : undefined;
    } catch {
        return readBundledRevision(repositoryRoot);
    }
};

/** Write both machine-readable files into Astro's existing public asset boundary. */
const writeMachineReadableFiles = async ({
    stagedRoot,
    outputRoot,
    sourceRevision,
}) => {
    const documents = await readStagedDocuments(stagedRoot);
    await fs.mkdir(outputRoot, { recursive: true });
    await Promise.all([
        fs.writeFile(
            path.join(outputRoot, 'llms.txt'),
            renderMachineReadableIndex({ documents, sourceRevision }),
            'utf8'
        ),
        fs.writeFile(
            path.join(outputRoot, 'llms-full.txt'),
            renderMachineReadableFull({ documents, sourceRevision }),
            'utf8'
        ),
    ]);
};

export {
    documentFromStagedMarkdown,
    readStagedDocuments,
    readVerifiedSourceRevision,
    renderMachineReadableFull,
    renderMachineReadableIndex,
    writeMachineReadableFiles,
};
