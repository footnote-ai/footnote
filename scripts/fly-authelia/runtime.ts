/**
 * @description: Provides the real command and prompt adapters plus failure handling for the provisioning seam.
 * @footnote-scope: utility
 * @footnote-module: FlyAutheliaRuntime
 * @footnote-risk: high - Adapter mistakes can leak credentials or misreport remote provisioning results.
 * @footnote-ethics: high - Interactive credential handling must keep plaintext out of arguments and logs.
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
    CommandResult,
    CommandRunner,
    CommandSpec,
    Prompt,
} from './types.js';

export const realPrompt: Prompt = {
    async text(message: string): Promise<string> {
        const readline = await import('node:readline/promises');
        const input = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        try {
            return await input.question(message);
        } finally {
            input.close();
        }
    },
};

const runProcess = (
    spec: CommandSpec,
    interactive: boolean
): Promise<CommandResult> =>
    new Promise((resolve, reject) => {
        const child = spawn(spec.command, spec.args, {
            cwd: process.cwd(),
            env: { ...process.env, ...spec.env },
            stdio: interactive
                ? ['inherit', 'pipe', 'inherit']
                : ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk: Buffer) => {
            const value = chunk.toString();
            stdout += value;
            if (interactive) {
                process.stdout.write(value);
            }
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
            resolve({ code: code ?? 1, stdout, stderr });
        });
        if (!interactive && child.stdin) {
            child.stdin.on('error', (error: NodeJS.ErrnoException) => {
                if (error.code !== 'EPIPE') {
                    reject(error);
                }
            });
            if (spec.stdin !== undefined) {
                child.stdin.end(spec.stdin);
            } else {
                child.stdin.end();
            }
        }
    });

export const realRunner: CommandRunner = {
    run: (spec) => runProcess(spec, false),
    runInteractive: (spec) => runProcess(spec, true),
};

export const readText = async (filePath: string): Promise<string> =>
    readFile(filePath, 'utf8');

export const writeText = async (
    filePath: string,
    contents: string
): Promise<void> => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, { encoding: 'utf8', mode: 0o600 });
};

export const commandOrThrow = async (
    runner: CommandRunner,
    spec: CommandSpec,
    interactive = false
): Promise<CommandResult> => {
    const result = await (interactive
        ? runner.runInteractive(spec)
        : runner.run(spec));
    if (result.code !== 0) {
        throw new Error(
            `Command failed: ${spec.command} ${spec.args.join(' ')}`
        );
    }
    return result;
};
