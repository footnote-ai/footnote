/**
 * @description: Resolves the trusted Git executable and source revision for cache probe checkpoints.
 * @footnote-scope: utility
 * @footnote-module: CacheProbeGit
 * @footnote-risk: medium - Missing provenance must stop a paid probe before provider requests.
 * @footnote-ethics: medium - Checkpoints retain the exact source revision measured.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export const resolveCacheProbeGit = (
    platform: NodeJS.Platform,
    exists: (path: string) => boolean = fs.existsSync
): string => {
    const candidates =
        platform === 'win32'
            ? [
                  String.raw`C:\Program Files\Git\cmd\git.exe`,
                  String.raw`C:\Program Files (x86)\Git\cmd\git.exe`,
              ]
            : ['/usr/bin/git', '/bin/git'];
    const executable = candidates.find(exists);
    if (executable === undefined)
        throw new Error(
            'Cache probe requires Git in a supported install path.'
        );
    return executable;
};

export const readCacheProbeCommit = (
    executable: string,
    root: string
): string => {
    try {
        return execFileSync(executable, ['rev-parse', 'HEAD'], {
            cwd: root,
            encoding: 'utf8',
            env: {
                PATH:
                    process.platform === 'win32'
                        ? String.raw`C:\Windows\System32;C:\Program Files\Git\cmd;C:\Program Files\Git\mingw64\bin;C:\Program Files\Git\usr\bin;C:\Program Files (x86)\Git\cmd;C:\Program Files (x86)\Git\mingw64\bin;C:\Program Files (x86)\Git\usr\bin`
                        : '/usr/bin:/bin',
                ...(process.platform === 'win32' && {
                    SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
                }),
            },
        }).trim();
    } catch (error) {
        throw new Error(
            'Cache probe could not read the current Git revision.',
            {
                cause: error,
            }
        );
    }
};
