/**
 * @description: Resolves approved project documents from .footnote/context-files in the backend.
 * The script-side resolver only previews allowlists; this backend module also reads contents.
 * @footnote-scope: core
 * @footnote-module: ProjectDocumentSource
 * @footnote-risk: medium - Allowlist resolution controls which repository files may influence output.
 * @footnote-ethics: high - Only approved tracked docs should enter the prompt context.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ProjectDocumentSource } from './documentLoader.js';

const execFileAsync = promisify(execFile);

/**
 * Lists git-tracked repository paths with forward slashes, like the script-side
 * resolver. The backend reads tracked file contents only for allowlisted paths.
 */
export const listGitTrackedPaths = async (
    repositoryRoot: string
): Promise<string[]> => {
    try {
        const { stdout } = await execFileAsync(
            'git',
            ['-C', repositoryRoot, 'ls-files', '-z', '--'],
            {
                encoding: 'utf8',
                maxBuffer: 20 * 1024 * 1024,
            }
        );
        return stdout
            .split('\0')
            .filter((filePath) => filePath.length > 0)
            .map((filePath) => filePath.replaceAll('\\', '/'));
    } catch {
        return [];
    }
};

/**
 * Resolves the current HEAD commit for commit-pinned citation URLs.
 * Returns null fail-open when the repository has no resolvable head.
 */
export const resolveHeadCommitSha = async (
    repositoryRoot: string
): Promise<string | null> => {
    try {
        const { stdout } = await execFileAsync(
            'git',
            ['-C', repositoryRoot, 'rev-parse', 'HEAD'],
            { encoding: 'utf8', maxBuffer: 1024 * 1024 }
        );
        const sha = stdout.trim();
        return sha.length > 0 ? sha : null;
    } catch {
        return null;
    }
};

export const readProjectFile = async (
    repositoryRoot: string,
    filePath: string
): Promise<string> => fs.readFile(path.join(repositoryRoot, filePath), 'utf8');

export type ProjectDocumentSourceOptions = {
    repositoryRoot: string;
    trackedPaths: string[];
    readFile: (filePath: string) => Promise<string>;
    allowlistContents: string;
    maxFileBytes?: number;
};

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

/**
 * Converts a .footnote/context-files glob pattern to an anchored regex.
 *
 * Supports `**`, `*`, and `?` wildcards. Patterns are forward-slash
 * normalized and must stay inside the repository.
 */
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
            // Match zero or more directories, like the canonical globby
            // resolver used by the repository-context preview command.
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
        regex += char.replace(/[/.+?^${}()|[\]\\]/g, '\\$&');
        index += 1;
    }
    return `${regex}$`;
};

const matchesPattern = (filePath: string, pattern: string): boolean => {
    const normalizedPath = filePath.replaceAll('\\', '/');
    return new RegExp(projectGlobToRegex(pattern), 'u').test(normalizedPath);
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

export const createProjectDocumentSource = (
    options: ProjectDocumentSourceOptions
): { loadDocuments: () => Promise<ProjectDocumentSource[]> } => {
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

    return {
        async loadDocuments() {
            const { include, exclude } = parseAllowlist(
                options.allowlistContents
            );
            const tracked = new Set(
                options.trackedPaths.map((filePath) =>
                    filePath.replaceAll('\\', '/')
                )
            );
            const documents: ProjectDocumentSource[] = [];

            for (const filePath of tracked) {
                const normalized = filePath.replaceAll('\\', '/');
                if (
                    exclude.some((pattern) =>
                        matchesPattern(normalized, pattern)
                    )
                ) {
                    continue;
                }
                const selected = include.some((pattern) =>
                    matchesPattern(normalized, pattern)
                );
                if (!selected) continue;
                if (
                    path.posix.isAbsolute(normalized) ||
                    normalized.split('/').includes('..')
                ) {
                    continue;
                }
                const resolvedRoot = path.resolve(options.repositoryRoot);
                const absolutePath = path.resolve(
                    options.repositoryRoot,
                    filePath
                );
                const relativePath = path.relative(resolvedRoot, absolutePath);
                if (
                    relativePath.length === 0 ||
                    relativePath === '..' ||
                    relativePath.startsWith(`..${path.sep}`) ||
                    path.isAbsolute(relativePath)
                ) {
                    continue;
                }
                try {
                    const stats = await fs.lstat(absolutePath);
                    if (!stats.isFile() || stats.isSymbolicLink()) {
                        continue;
                    }
                    const content = await options.readFile(filePath);
                    if (Buffer.byteLength(content, 'utf8') > maxFileBytes) {
                        continue;
                    }
                    documents.push({ path: normalized, content });
                } catch {
                    continue;
                }
            }

            documents.sort((left, right) =>
                left.path.localeCompare(right.path)
            );
            return documents;
        },
    };
};
