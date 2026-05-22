/**
 * @description: Docker CLI command execution and basic inspect parsing helpers for launcher runtime modules.
 * @footnote-scope: utility
 * @footnote-module: LauncherDockerCommand
 * @footnote-risk: high - Command execution failures directly impact runtime lifecycle control paths.
 * @footnote-ethics: low - Explicit process error mapping improves transparent operator diagnostics.
 */

import { spawn } from 'node:child_process';
import { LauncherError } from '@footnote/launcher-core';

export type DockerCommandResult = {
    code: number;
    stdout: string;
    stderr: string;
};

export const runDocker = async (
    args: readonly string[],
    allowFailure: boolean = false,
    failureKind: 'environment' | 'runtime' = 'runtime'
): Promise<DockerCommandResult> =>
    new Promise((resolve, reject) => {
        const child = spawn('docker', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
        });

        child.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') {
                reject(
                    new LauncherError(
                        'environment',
                        [
                            'Docker CLI was not found.',
                            'Install Docker Desktop (or Docker Engine) and confirm `docker --version` works.',
                        ].join(' '),
                        error
                    )
                );
                return;
            }
            reject(error);
        });

        child.on('close', (code) => {
            const result: DockerCommandResult = {
                code: code ?? 1,
                stdout,
                stderr,
            };
            if (!allowFailure && result.code !== 0) {
                reject(
                    new LauncherError(
                        failureKind,
                        `Docker command failed: docker ${args.join(' ')}\n${stderr.trim() || stdout.trim()}`
                    )
                );
                return;
            }
            resolve(result);
        });
    });

export const parseInspect = <T>(stdout: string): T | null => {
    const trimmed = stdout.trim();
    if (!trimmed) {
        return null;
    }
    const parsed = JSON.parse(trimmed) as T[];
    return parsed[0] ?? null;
};
