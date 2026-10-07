/**
 * @description: Adapts a local Git checkout to the repository-context core.
 * It limits selection to tracked regular files and never returns source contents in previews.
 * @footnote-scope: utility
 * @footnote-module: RepositoryContextGitSource
 * @footnote-risk: medium - Unsafe path matching could expose files outside the checked-out repository.
 * @footnote-ethics: high - Local source selection controls which repository data may be loaded.
 */

import { execFile } from 'node:child_process';
import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
    createRepositoryContextPreview,
    DEFAULT_REPOSITORY_CONTEXT_LIMITS,
    normalizeRepositoryRelativePath,
    parseRepositoryContextPatterns,
    type RepositoryContextFile,
    type RepositoryContextFileReadResult,
    type RepositoryContextFileSource,
    type RepositoryContextLimits,
    type RepositoryContextResult,
} from '@footnote/repository-context';

export {
    createRepositoryContextPreview,
    DEFAULT_REPOSITORY_CONTEXT_LIMITS,
    normalizeRepositoryRelativePath,
    parseRepositoryContextPatterns,
};
export type {
    RepositoryContextFile,
    RepositoryContextFileReadResult,
    RepositoryContextFileSource,
    RepositoryContextLimits,
    RepositoryContextResult,
};

export type ResolveRepositoryContextOptions = {
    repositoryRoot?: string;
    limits?: Partial<RepositoryContextLimits>;
};
const CONTEXT_FILES_PATH = '.footnote/context-files';
const execFileAsync = promisify(execFile);
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

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
        { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
    );
    return new Set(
        stdout
            .split('\0')
            .filter((filePath) => filePath.length > 0)
            .map(normalizeRepositoryRelativePath)
            .filter((filePath): filePath is string => filePath !== undefined)
    );
};

const matchFiles = async (
    repositoryRoot: string,
    include: string[],
    exclude: string[]
): Promise<string[]> => {
    const { globby } = await import('globby');
    return globby(include, {
        cwd: repositoryRoot,
        gitignore: true,
        ignore: exclude,
        onlyFiles: true,
        followSymbolicLinks: false,
    });
};

/** Resolves the local tracked allowlist into the shared metadata-only preview. */
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
            .map(normalizeRepositoryRelativePath)
            .filter((filePath): filePath is string => filePath !== undefined)
            .filter((filePath) => trackedFiles.has(filePath))
    );
    const selectedTracked = new Set(
        selectedMatches
            .map(normalizeRepositoryRelativePath)
            .filter((filePath): filePath is string => filePath !== undefined)
            .filter((filePath) => trackedFiles.has(filePath))
    );
    if (selectedTracked.size === 0) {
        throw new Error(
            'Repository context allowlist matched no safe, tracked files. Add or broaden an include pattern.'
        );
    }

    const skipped = [...includedTracked]
        .filter((filePath) => !selectedTracked.has(filePath))
        .map((filePath) => ({ path: filePath, reason: 'excluded by pattern' }));
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
        files.push({ path: filePath, sizeBytes: fileStats.size });
    }
    return createRepositoryContextPreview({ files, skipped, limits });
};

const hasStableStats = (before: Stats, after: Stats): boolean =>
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs;

/** Creates the CLI-owned Git/file source consumed by the shared TrustGraph loader. */
export const createGitRepositoryContextFileSource = (
    repositoryRoot: string
): RepositoryContextFileSource => {
    const absoluteRoot = path.resolve(repositoryRoot);
    return {
        preview: (limits) =>
            resolveRepositoryContextFiles({
                repositoryRoot: absoluteRoot,
                limits,
            }),
        readFile: async (filePath, maxFileBytes) => {
            const normalizedPath = normalizeRepositoryRelativePath(filePath);
            if (normalizedPath === undefined) {
                return { status: 'failed', reason: 'unsafe repository path' };
            }
            const fullPath = path.resolve(absoluteRoot, normalizedPath);
            if (!isPathInsideRepository(absoluteRoot, fullPath)) {
                return {
                    status: 'failed',
                    reason: 'resolved path escapes the repository',
                };
            }
            let fileHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
            try {
                const pathStats = await fs.lstat(fullPath);
                if (pathStats.isSymbolicLink()) {
                    return { status: 'skipped', reason: 'symbolic link' };
                }
                if (!pathStats.isFile()) {
                    return { status: 'skipped', reason: 'not a regular file' };
                }
                const realRoot = await fs.realpath(absoluteRoot);
                const realPath = await fs.realpath(fullPath);
                if (!isPathInsideRepository(realRoot, realPath)) {
                    return {
                        status: 'failed',
                        reason: 'real path escapes the repository',
                    };
                }
                fileHandle = await fs.open(realPath, 'r');
                const before = await fileHandle.stat();
                if (!before.isFile()) {
                    return { status: 'skipped', reason: 'not a regular file' };
                }
                if (before.size > maxFileBytes) {
                    return {
                        status: 'skipped',
                        sizeBytes: before.size,
                        reason: `larger than ${maxFileBytes} bytes`,
                    };
                }
                const bytes = await fileHandle.readFile();
                const after = await fileHandle.stat();
                if (!hasStableStats(before, after)) {
                    return {
                        status: 'failed',
                        reason: 'file changed while it was being read',
                    };
                }
                if (bytes.byteLength > maxFileBytes) {
                    return {
                        status: 'skipped',
                        sizeBytes: bytes.byteLength,
                        reason: `larger than ${maxFileBytes} bytes`,
                    };
                }
                try {
                    if (UTF8_DECODER.decode(bytes).includes('\0')) {
                        return {
                            status: 'skipped',
                            sizeBytes: bytes.byteLength,
                            reason: 'contains a NUL byte',
                        };
                    }
                } catch {
                    return {
                        status: 'skipped',
                        sizeBytes: bytes.byteLength,
                        reason: 'not valid UTF-8 text',
                    };
                }
                return { status: 'readable', bytes };
            } catch (error) {
                const reason =
                    error instanceof Error ? error.message : String(error);
                return {
                    status: 'failed',
                    reason: `could not read file: ${reason}`,
                };
            } finally {
                await fileHandle?.close().catch(() => undefined);
            }
        },
    };
};
