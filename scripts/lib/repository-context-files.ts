/**
 * @description: Parses and resolves the repository-owned context file allowlist without loading file contents.
 * It limits the preview to safe, tracked, regular files inside the repository.
 * @footnote-scope: utility
 * @footnote-module: RepositoryContextFiles
 * @footnote-risk: medium - Unsafe path matching could expose unintended repository files to later context loaders.
 * @footnote-ethics: high - Repository context selection controls which project information may influence AI output.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

export type RepositoryContextFile = {
    path: string;
    sizeBytes: number;
};

export type RepositoryContextResult = {
    files: RepositoryContextFile[];
    skipped: Array<{
        path: string;
        reason: string;
    }>;
    totalBytes: number;
};

export type RepositoryContextPatterns = {
    include: string[];
    exclude: string[];
};

export type RepositoryContextLimits = {
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
};

export type ResolveRepositoryContextOptions = {
    repositoryRoot?: string;
    limits?: Partial<RepositoryContextLimits>;
};

export const DEFAULT_REPOSITORY_CONTEXT_LIMITS: RepositoryContextLimits = {
    maxFiles: 250,
    maxFileBytes: 1024 * 1024,
    maxTotalBytes: 10 * 1024 * 1024,
};

const CONTEXT_FILES_PATH = '.footnote/context-files';
const execFileAsync = promisify(execFile);

const toForwardSlashes = (filePath: string): string =>
    filePath.replaceAll('\\', '/');

const comparePaths = (left: string, right: string): number => {
    if (left < right) {
        return -1;
    }
    if (left > right) {
        return 1;
    }
    return 0;
};

const formatLimitBytes = (bytes: number): string => {
    if (bytes > 0 && bytes % (1024 * 1024) === 0) {
        return `${bytes / (1024 * 1024)} MiB`;
    }
    return `${bytes} bytes`;
};

const assertSafePattern = (pattern: string, lineNumber: number): void => {
    const normalized = toForwardSlashes(pattern);
    const isAbsolute =
        path.posix.isAbsolute(normalized) ||
        path.win32.isAbsolute(pattern) ||
        /^[a-zA-Z]:\//u.test(normalized);
    const escapesRepository = normalized.split('/').includes('..');

    if (isAbsolute || escapesRepository) {
        throw new Error(
            `Invalid repository context pattern on line ${lineNumber}: "${pattern}". Patterns must stay inside the repository.`
        );
    }
};

/**
 * Parses repository context patterns without consulting Git or the filesystem.
 */
export const parseRepositoryContextPatterns = (
    contents: string
): RepositoryContextPatterns => {
    const include: string[] = [];
    const exclude: string[] = [];

    for (const [index, rawLine] of contents.split(/\r?\n/u).entries()) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith('#')) {
            continue;
        }

        const isExclude = line.startsWith('!');
        const pattern = isExclude ? line.slice(1).trim() : line;
        if (pattern.length === 0) {
            throw new Error(
                `Invalid repository context pattern on line ${index + 1}: a pattern is required.`
            );
        }
        assertSafePattern(pattern, index + 1);

        (isExclude ? exclude : include).push(toForwardSlashes(pattern));
    }

    if (include.length === 0) {
        throw new Error(
            'Repository context allowlist must contain at least one include pattern.'
        );
    }

    return { include, exclude };
};

const isPathInsideRepository = (
    repositoryRoot: string,
    absolutePath: string
): boolean => {
    const relativePath = path.relative(repositoryRoot, absolutePath);
    return (
        relativePath.length > 0 &&
        relativePath !== '..' &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath)
    );
};

const listTrackedFiles = async (
    repositoryRoot: string
): Promise<Set<string>> => {
    const { stdout } = await execFileAsync(
        'git',
        ['-C', repositoryRoot, 'ls-files', '-z', '--'],
        {
            encoding: 'utf8',
            maxBuffer: 20 * 1024 * 1024,
        }
    );

    return new Set(
        stdout
            .split('\0')
            .filter((filePath) => filePath.length > 0)
            .map(toForwardSlashes)
    );
};

const matchFiles = async (
    repositoryRoot: string,
    include: string[],
    exclude: string[]
): Promise<string[]> => {
    // Keep the ESM-only dependency behind a native dynamic import because the
    // repository's tsx scripts currently run from a CommonJS package root.
    const { globby } = await import('globby');
    return globby(include, {
        cwd: repositoryRoot,
        gitignore: true,
        ignore: exclude,
        onlyFiles: true,
        followSymbolicLinks: false,
    });
};

/**
 * Resolves the canonical allowlist to a serializable preview of safe, tracked files.
 * This function intentionally returns metadata only and never reads file contents.
 */
export const resolveRepositoryContextFiles = async (
    options: ResolveRepositoryContextOptions = {}
): Promise<RepositoryContextResult> => {
    const repositoryRoot = path.resolve(
        options.repositoryRoot ?? process.cwd()
    );
    const limits: RepositoryContextLimits = {
        ...DEFAULT_REPOSITORY_CONTEXT_LIMITS,
        ...options.limits,
    };
    const allowlistPath = path.join(repositoryRoot, CONTEXT_FILES_PATH);
    const allowlistContents = await fs.readFile(allowlistPath, 'utf8');
    const patterns = parseRepositoryContextPatterns(allowlistContents);
    const trackedFiles = await listTrackedFiles(repositoryRoot);
    const [includedMatches, selectedMatches] = await Promise.all([
        matchFiles(repositoryRoot, patterns.include, []),
        matchFiles(repositoryRoot, patterns.include, patterns.exclude),
    ]);
    const includedTracked = new Set(
        includedMatches
            .map(toForwardSlashes)
            .filter((filePath) => trackedFiles.has(filePath))
    );
    const selectedTracked = new Set(
        selectedMatches
            .map(toForwardSlashes)
            .filter((filePath) => trackedFiles.has(filePath))
    );

    if (selectedTracked.size === 0) {
        throw new Error(
            'Repository context allowlist matched no safe, tracked files. Add or broaden an include pattern.'
        );
    }

    const skipped: RepositoryContextResult['skipped'] = [...includedTracked]
        .filter((filePath) => !selectedTracked.has(filePath))
        .map((filePath) => ({
            path: filePath,
            reason: 'excluded by pattern',
        }));
    const files: RepositoryContextFile[] = [];

    for (const filePath of selectedTracked) {
        const absolutePath = path.resolve(repositoryRoot, filePath);
        if (!isPathInsideRepository(repositoryRoot, absolutePath)) {
            throw new Error(
                `Resolved repository context path escapes the repository: ${filePath}. Narrow the allowlist.`
            );
        }

        const fileStats = await fs.lstat(absolutePath);
        if (fileStats.isSymbolicLink()) {
            skipped.push({ path: filePath, reason: 'symbolic link' });
            continue;
        }
        if (!fileStats.isFile()) {
            skipped.push({ path: filePath, reason: 'not a regular file' });
            continue;
        }
        if (fileStats.size > limits.maxFileBytes) {
            skipped.push({
                path: filePath,
                reason: `larger than ${formatLimitBytes(limits.maxFileBytes)}`,
            });
            continue;
        }

        files.push({ path: filePath, sizeBytes: fileStats.size });
    }

    files.sort((left, right) => comparePaths(left.path, right.path));
    skipped.sort((left, right) => comparePaths(left.path, right.path));

    if (files.length > limits.maxFiles) {
        throw new Error(
            `Repository context selects ${files.length} files, above the ${limits.maxFiles}-file limit. Narrow .footnote/context-files and try again.`
        );
    }

    const totalBytes = files.reduce(
        (sum, repositoryFile) => sum + repositoryFile.sizeBytes,
        0
    );
    if (totalBytes > limits.maxTotalBytes) {
        throw new Error(
            `Repository context selects ${totalBytes} bytes, above the ${formatLimitBytes(limits.maxTotalBytes)} combined limit. Narrow .footnote/context-files and try again.`
        );
    }

    return { files, skipped, totalBytes };
};
