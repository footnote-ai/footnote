/**
 * @description: Defines bounded repository-context selection and file-source contracts.
 * Callers provide approved paths and reads; this package never opens a checkout or invokes Git.
 * @footnote-scope: utility
 * @footnote-module: RepositoryContextFiles
 * @footnote-risk: medium - Incorrect path or size bounds could expose unintended repository files.
 * @footnote-ethics: high - Context selection controls which project information may influence AI output.
 */

import path from 'node:path';

export type RepositoryContextFile = {
    path: string;
    sizeBytes: number;
};

export type RepositoryContextSkippedFile = {
    path: string;
    reason: string;
};

export type RepositoryContextResult = {
    files: RepositoryContextFile[];
    skipped: RepositoryContextSkippedFile[];
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

export type RepositoryContextFileReadResult =
    | { status: 'readable'; bytes: Uint8Array }
    | { status: 'skipped' | 'failed'; reason: string; sizeBytes?: number };

/** A caller-owned source keeps local Git access and approved server bundles outside this package. */
export type RepositoryContextFileSource = {
    preview: (
        limits: RepositoryContextLimits
    ) => Promise<RepositoryContextResult>;
    readFile: (
        filePath: string,
        maxFileBytes: number
    ) => Promise<RepositoryContextFileReadResult>;
};

export type RepositoryContextPreviewInput = {
    files: RepositoryContextFile[];
    skipped?: RepositoryContextSkippedFile[];
    limits?: Partial<RepositoryContextLimits>;
};

export const DEFAULT_REPOSITORY_CONTEXT_LIMITS: RepositoryContextLimits = {
    maxFiles: 250,
    maxFileBytes: 1024 * 1024,
    maxTotalBytes: 10 * 1024 * 1024,
};

const toForwardSlashes = (filePath: string): string =>
    filePath.replaceAll('\\', '/');

/** Normalizes a concrete repository-relative path for stable identity and metadata. */
export const normalizeRepositoryRelativePath = (
    filePath: string
): string | undefined => {
    const forwardPath = toForwardSlashes(filePath);
    if (
        forwardPath.length === 0 ||
        path.posix.isAbsolute(forwardPath) ||
        path.win32.isAbsolute(filePath) ||
        /^[a-zA-Z]:\//u.test(forwardPath)
    ) {
        return undefined;
    }

    const normalizedPath = path.posix.normalize(forwardPath);
    if (
        normalizedPath === '.' ||
        normalizedPath === '..' ||
        normalizedPath.startsWith('../') ||
        path.posix.isAbsolute(normalizedPath) ||
        normalizedPath.split('/').some((segment) => segment.length === 0)
    ) {
        return undefined;
    }

    return normalizedPath;
};

const comparePaths = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;

const formatLimitBytes = (bytes: number): string =>
    bytes > 0 && bytes % (1024 * 1024) === 0
        ? `${bytes / (1024 * 1024)} MiB`
        : `${bytes} bytes`;

const assertSafePattern = (pattern: string, lineNumber: number): void => {
    const normalized = toForwardSlashes(pattern);
    const isAbsolute =
        path.posix.isAbsolute(normalized) ||
        path.win32.isAbsolute(pattern) ||
        /^[a-zA-Z]:\//u.test(normalized);
    if (isAbsolute || normalized.split('/').includes('..')) {
        throw new Error(
            `Invalid repository context pattern on line ${lineNumber}: "${pattern}". Patterns must stay inside the repository.`
        );
    }
};

/** Parses repository context patterns without consulting Git or the filesystem. */
export const parseRepositoryContextPatterns = (
    contents: string
): RepositoryContextPatterns => {
    const include: string[] = [];
    const exclude: string[] = [];

    for (const [index, rawLine] of contents.split(/\r?\n/u).entries()) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith('#')) continue;
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

/**
 * Creates the serializable, size-bounded preview shared by CLI and backend sources.
 * Sources remain responsible for deciding which files are approved and for reading them.
 */
export const createRepositoryContextPreview = (
    input: RepositoryContextPreviewInput
): RepositoryContextResult => {
    const limits: RepositoryContextLimits = {
        ...DEFAULT_REPOSITORY_CONTEXT_LIMITS,
        ...input.limits,
    };
    for (const [name, value] of Object.entries(limits)) {
        if (!Number.isInteger(value) || value <= 0) {
            throw new Error(`${name} must be a positive integer.`);
        }
    }

    const skipped = [...(input.skipped ?? [])];
    const files: RepositoryContextFile[] = [];
    const seen = new Set<string>();
    for (const candidate of input.files) {
        const normalizedPath = normalizeRepositoryRelativePath(candidate.path);
        if (normalizedPath === undefined) {
            skipped.push({
                path: candidate.path,
                reason: 'unsafe repository path',
            });
            continue;
        }
        if (seen.has(normalizedPath)) {
            skipped.push({
                path: normalizedPath,
                reason: 'duplicate selected path',
            });
            continue;
        }
        seen.add(normalizedPath);
        if (!Number.isInteger(candidate.sizeBytes) || candidate.sizeBytes < 0) {
            skipped.push({ path: normalizedPath, reason: 'invalid file size' });
            continue;
        }
        if (candidate.sizeBytes > limits.maxFileBytes) {
            skipped.push({
                path: normalizedPath,
                reason: `larger than ${formatLimitBytes(limits.maxFileBytes)}`,
            });
            continue;
        }
        files.push({ path: normalizedPath, sizeBytes: candidate.sizeBytes });
    }
    files.sort((left, right) => comparePaths(left.path, right.path));
    skipped.sort((left, right) => comparePaths(left.path, right.path));

    if (files.length > limits.maxFiles) {
        throw new Error(
            `Repository context selects ${files.length} files, above the ${limits.maxFiles}-file limit. Narrow .footnote/context-files and try again.`
        );
    }
    const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    if (totalBytes > limits.maxTotalBytes) {
        throw new Error(
            `Repository context selects ${totalBytes} bytes, above the ${formatLimitBytes(limits.maxTotalBytes)} combined limit. Narrow .footnote/context-files and try again.`
        );
    }
    return { files, skipped, totalBytes };
};
