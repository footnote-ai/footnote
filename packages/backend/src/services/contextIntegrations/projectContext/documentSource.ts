/**
 * @description: Loads one commit-pinned set of allowed project documents.
 * Development reads come from `git show`; production reads come from an image-bundled corpus.
 * @footnote-scope: core
 * @footnote-module: ProjectDocumentSource
 * @footnote-risk: high - A wrong commit or allowlist could produce false citations or unsafe retrieval.
 * @footnote-ethics: high - Only approved documents from one source revision may affect an answer.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ProjectContextCategory } from '@footnote/contracts/policy';
import type { ProjectDocumentSource } from './documentLoader.js';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/iu;

export type ProjectContextManifestEntry = {
    path: string;
    category: ProjectContextCategory;
    priority: number;
};

export type ProjectDocumentSet = {
    revision: string | null;
    documents: ProjectDocumentSource[];
    source: 'git' | 'bundle';
};

export type ProjectDocumentSetLoadOptions = {
    onSkip?: (filePath: string, reason: string) => void;
};

export type ProjectDocumentSourceOptions = {
    repositoryRoot: string;
    trackedPaths: string[];
    readFile: (filePath: string) => Promise<string>;
    allowlistContents: string;
    manifestEntries?: readonly ProjectContextManifestEntry[];
    statFile?: (filePath: string) => Promise<{
        isFile: boolean;
        isSymbolicLink: boolean;
        size: number;
    }>;
    onSkip?: (filePath: string, reason: string) => void;
    maxFileBytes?: number;
};

const isSafeRelativePath = (filePath: string): boolean => {
    const normalized = filePath.replaceAll('\\', '/');
    return (
        normalized.length > 0 &&
        !path.posix.isAbsolute(normalized) &&
        !normalized.split('/').includes('..')
    );
};

const parseAllowlist = (
    contents: string
): { include: string[]; exclude: string[] } => {
    const include: string[] = [];
    const exclude: string[] = [];
    for (const rawLine of contents.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith('#')) continue;
        if (line.startsWith('!')) {
            exclude.push(line.slice(1).trim());
        } else {
            include.push(line);
        }
    }
    return { include, exclude };
};

/** Converts the supported context-file globs to an anchored regular expression. */
export const projectGlobToRegex = (pattern: string): string => {
    const normalized = pattern.replaceAll('\\', '/');
    let regex = '^';
    let index = 0;
    while (index < normalized.length) {
        const char = normalized[index];
        if (
            char === '*' &&
            normalized[index + 1] === '*' &&
            normalized[index + 2] === '/'
        ) {
            regex += '(?:.*/)?';
            index += 3;
            continue;
        }
        if (char === '*' && normalized[index + 1] === '*') {
            regex += '.*';
            index += 2;
            continue;
        }
        if (char === '*') {
            regex += '[^/]*';
            index += 1;
            continue;
        }
        if (char === '?') {
            regex += '[^\\/]';
            index += 1;
            continue;
        }
        regex += char.replace(/[/.+?^${}()|[\]\\]/gu, '\\$&');
        index += 1;
    }
    return `${regex}$`;
};

const matchesPattern = (filePath: string, pattern: RegExp): boolean =>
    pattern.test(filePath.replaceAll('\\', '/'));

const relativePathFromRoot = (
    repositoryRoot: string,
    filePath: string
): string => {
    const resolvedRoot = path.resolve(repositoryRoot);
    const absolutePath = path.resolve(filePath);
    const relativePath = path.relative(resolvedRoot, absolutePath);
    return relativePath.replaceAll('\\', '/');
};

const normalizeRevision = (revision: string): string | null => {
    const normalized = revision.trim();
    return COMMIT_SHA_PATTERN.test(normalized) ? normalized : null;
};

const parseManifest = (contents: string): ProjectContextManifestEntry[] => {
    const parsed: unknown = JSON.parse(contents);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry: unknown) => {
        if (typeof entry !== 'object' || entry === null) return [];
        const candidate = entry as Record<string, unknown>;
        const filePath =
            typeof candidate.path === 'string'
                ? candidate.path.replaceAll('\\', '/')
                : '';
        const category = candidate.category;
        const priority = candidate.priority;
        if (
            !isSafeRelativePath(filePath) ||
            (category !== 'documented_intent' &&
                category !== 'documented_behavior' &&
                category !== 'current_state') ||
            typeof priority !== 'number' ||
            !Number.isFinite(priority)
        ) {
            return [];
        }
        return [{ path: filePath, category, priority }];
    });
};

/**
 * Parses a project-context manifest. Valid entries are returned; malformed
 * entries are discarded. Syntactically invalid JSON throws to the caller.
 */
export const parseProjectContextManifest = parseManifest;

/**
 * Creates a source loader with a fixed path list. Callers supply the reader so
 * Git and image bundles use the same allowlist rules.
 */
export const createProjectDocumentSource = (
    options: ProjectDocumentSourceOptions
): { loadDocuments: () => Promise<ProjectDocumentSource[]> } => {
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    const statFile =
        options.statFile ??
        (async (filePath: string) => {
            const stats = await fs.lstat(filePath);
            return {
                isFile: stats.isFile(),
                isSymbolicLink: stats.isSymbolicLink(),
                size: stats.size,
            };
        });

    return {
        async loadDocuments() {
            const { include, exclude } = parseAllowlist(
                options.allowlistContents
            );
            const includePatterns = include.map(
                (pattern) => new RegExp(projectGlobToRegex(pattern), 'u')
            );
            const excludePatterns = exclude.map(
                (pattern) => new RegExp(projectGlobToRegex(pattern), 'u')
            );
            const manifestByPath = new Map(
                (options.manifestEntries ?? []).map((entry) => [
                    entry.path.replaceAll('\\', '/'),
                    entry,
                ])
            );
            const tracked = new Set(
                options.trackedPaths.map((filePath) =>
                    filePath.replaceAll('\\', '/')
                )
            );
            const documents: ProjectDocumentSource[] = [];

            for (const filePath of tracked) {
                const normalized = filePath.replaceAll('\\', '/');
                const manifestEntry = manifestByPath.get(normalized);
                if (
                    !isSafeRelativePath(normalized) ||
                    excludePatterns.some((pattern) =>
                        matchesPattern(normalized, pattern)
                    ) ||
                    !includePatterns.some((pattern) =>
                        matchesPattern(normalized, pattern)
                    ) ||
                    (manifestByPath.size > 0 && manifestEntry === undefined)
                ) {
                    options.onSkip?.(normalized, 'not_allowlisted');
                    continue;
                }
                const absolutePath = path.resolve(
                    options.repositoryRoot,
                    normalized
                );
                const relativePath = relativePathFromRoot(
                    options.repositoryRoot,
                    absolutePath
                );
                if (!isSafeRelativePath(relativePath)) {
                    options.onSkip?.(normalized, 'unsafe_relative_path');
                    continue;
                }
                try {
                    const stats = await statFile(absolutePath);
                    if (
                        !stats.isFile ||
                        stats.isSymbolicLink ||
                        stats.size > maxFileBytes
                    ) {
                        options.onSkip?.(
                            normalized,
                            !stats.isFile
                                ? 'not_file'
                                : stats.isSymbolicLink
                                  ? 'symbolic_link'
                                  : 'file_too_large'
                        );
                        continue;
                    }
                    const content = await options.readFile(absolutePath);
                    if (Buffer.byteLength(content, 'utf8') > maxFileBytes) {
                        options.onSkip?.(normalized, 'content_too_large');
                        continue;
                    }
                    documents.push({
                        path: normalized,
                        content,
                        ...(manifestEntry?.category !== undefined && {
                            category: manifestEntry.category,
                        }),
                        ...(manifestEntry?.priority !== undefined && {
                            priority: manifestEntry.priority,
                        }),
                    });
                } catch (error) {
                    options.onSkip?.(
                        normalized,
                        error instanceof Error
                            ? 'read_failed'
                            : 'read_failed_unknown'
                    );
                    continue;
                }
            }

            documents.sort(
                (left, right) =>
                    (right.priority ?? 0) - (left.priority ?? 0) ||
                    (left.path < right.path
                        ? -1
                        : left.path > right.path
                          ? 1
                          : 0)
            );
            return documents;
        },
    };
};

const readGitRevisionFile = async (
    repositoryRoot: string,
    revision: string,
    filePath: string
): Promise<string> => {
    if (!isSafeRelativePath(filePath)) {
        throw new Error(`Unsafe project context path: ${filePath}`);
    }
    const { stdout } = await execFileAsync(
        'git',
        ['-C', repositoryRoot, 'show', `${revision}:${filePath}`],
        { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }
    );
    return stdout;
};

const listGitRevisionFiles = async (
    repositoryRoot: string,
    revision: string
): Promise<string[]> => {
    const { stdout } = await execFileAsync(
        'git',
        ['-C', repositoryRoot, 'ls-tree', '-r', '-z', revision, '--'],
        { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
    );
    return stdout.split('\0').flatMap((record) => {
        const [header, filePath] = record.split('\t');
        const mode = header?.split(' ')[0];
        return (mode === '100644' || mode === '100755') &&
            filePath !== undefined
            ? [filePath]
            : [];
    });
};

/** Lists paths from one captured commit, not a dirty working tree. */
export const listGitTrackedPaths = async (
    repositoryRoot: string,
    revision?: string
): Promise<string[]> => {
    try {
        if (revision !== undefined) {
            return await listGitRevisionFiles(repositoryRoot, revision);
        }
        const { stdout } = await execFileAsync(
            'git',
            ['-C', repositoryRoot, 'ls-files', '-z', '--'],
            { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
        );
        return stdout
            .split('\0')
            .filter((filePath) => filePath.length > 0)
            .map((filePath) => filePath.replaceAll('\\', '/'));
    } catch {
        return [];
    }
};

/** Finds the commit used for a complete project-document read. */
export const resolveHeadCommitSha = async (
    repositoryRoot: string
): Promise<string | null> => {
    try {
        const { stdout } = await execFileAsync(
            'git',
            ['-C', repositoryRoot, 'rev-parse', '--verify', 'HEAD^{commit}'],
            { encoding: 'utf8', maxBuffer: 1024 * 1024 }
        );
        return normalizeRevision(stdout);
    } catch {
        return null;
    }
};

/** Reads a path after callers have validated it against the project allowlist. */
export const readProjectFile = async (
    repositoryRoot: string,
    filePath: string
): Promise<string> => {
    const handle = await fs.open(
        path.isAbsolute(filePath)
            ? filePath
            : path.join(repositoryRoot, filePath),
        'r'
    );
    try {
        return await handle.readFile('utf8');
    } finally {
        await handle.close();
    }
};

const readRootFile = async (
    repositoryRoot: string,
    relativePath: string
): Promise<string> =>
    fs.readFile(path.join(repositoryRoot, relativePath), 'utf8');

/** Loads local development documents from one commit. */
export const loadGitProjectDocumentSet = async (
    repositoryRoot: string,
    options: ProjectDocumentSetLoadOptions = {}
): Promise<ProjectDocumentSet> => {
    const revision = await resolveHeadCommitSha(repositoryRoot);
    if (revision === null) {
        return { revision: null, documents: [], source: 'git' };
    }
    const allowlistContents = await readGitRevisionFile(
        repositoryRoot,
        revision,
        '.footnote/context-files'
    );
    const manifestEntries = parseManifest(
        await readGitRevisionFile(
            repositoryRoot,
            revision,
            '.footnote/context-manifest.json'
        )
    );
    if (manifestEntries.length === 0) {
        throw new Error('Project context manifest contains no valid entries.');
    }
    const trackedPaths = await listGitTrackedPaths(repositoryRoot, revision);
    const source = createProjectDocumentSource({
        repositoryRoot,
        trackedPaths,
        allowlistContents,
        manifestEntries,
        onSkip: options.onSkip,
        readFile: (filePath) =>
            readGitRevisionFile(
                repositoryRoot,
                revision,
                relativePathFromRoot(repositoryRoot, filePath)
            ),
        statFile: async () => ({
            isFile: true,
            isSymbolicLink: false,
            size: 0,
        }),
    });
    return {
        revision,
        documents: await source.loadDocuments(),
        source: 'git',
    };
};

const listBundleFiles = async (bundleRoot: string): Promise<string[]> => {
    const result: string[] = [];
    const visit = async (directory: string, prefix: string): Promise<void> => {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            const relative =
                prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(absolute, relative);
            } else if (entry.isFile()) {
                result.push(relative.replaceAll('\\', '/'));
            }
        }
    };
    await visit(bundleRoot, '');
    return result;
};

/** Loads the fixed document set copied into a production image. */
export const loadPackagedProjectDocumentSet = async (
    repositoryRoot: string,
    options: ProjectDocumentSetLoadOptions = {}
): Promise<ProjectDocumentSet | undefined> => {
    const bundleRoot = path.join(repositoryRoot, '.footnote', 'context-bundle');
    try {
        const revisionText = await readRootFile(bundleRoot, 'revision.txt');
        const revision = normalizeRevision(revisionText);
        if (revision === null) return undefined;
        const allowlistContents = await readRootFile(
            repositoryRoot,
            '.footnote/context-files'
        );
        const manifestEntries = parseManifest(
            await readRootFile(
                repositoryRoot,
                '.footnote/context-manifest.json'
            )
        );
        if (manifestEntries.length === 0) {
            return undefined;
        }
        const trackedPaths = await listBundleFiles(bundleRoot);
        const source = createProjectDocumentSource({
            repositoryRoot: bundleRoot,
            trackedPaths,
            allowlistContents,
            manifestEntries,
            onSkip: options.onSkip,
            readFile: (filePath) => readProjectFile(bundleRoot, filePath),
        });
        return {
            revision,
            documents: await source.loadDocuments(),
            source: 'bundle',
        };
    } catch {
        return undefined;
    }
};
