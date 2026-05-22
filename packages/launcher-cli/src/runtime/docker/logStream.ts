/**
 * @description: Docker logs process streaming helper for launcher runtime log tailing behavior.
 * @footnote-scope: utility
 * @footnote-module: LauncherDockerLogStream
 * @footnote-risk: medium - Stream handling errors can hide diagnostics during startup and incident response.
 * @footnote-ethics: low - Reliable log delivery supports transparent troubleshooting.
 */

import { spawn } from 'node:child_process';
import { LauncherError, type LogLine } from '@footnote/launcher-core';

const readLinesFromChunk = (
    state: { buffered: string },
    chunk: Buffer,
    stream: LogLine['stream'],
    enqueue: (line: LogLine) => void
): void => {
    state.buffered += chunk.toString('utf8');

    let lineBreakIndex = state.buffered.indexOf('\n');
    while (lineBreakIndex >= 0) {
        const raw = state.buffered.slice(0, lineBreakIndex);
        const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        if (text.length > 0) {
            enqueue({ text, stream });
        }
        state.buffered = state.buffered.slice(lineBreakIndex + 1);
        lineBreakIndex = state.buffered.indexOf('\n');
    }
};

export const streamDockerLogs = async function* ({
    containerName,
    follow,
}: {
    containerName: string;
    follow: boolean;
}): AsyncIterable<LogLine> {
    const args = ['logs'];
    if (follow) {
        args.push('--follow');
    }
    args.push(containerName);

    const child = spawn('docker', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    const queue: Array<LogLine | null> = [];
    let resolveNext: (() => void) | null = null;
    let terminalError: unknown;

    const notify = (): void => {
        if (resolveNext) {
            resolveNext();
            resolveNext = null;
        }
    };

    const enqueue = (line: LogLine | null): void => {
        queue.push(line);
        notify();
    };

    const stdoutState = { buffered: '' };
    const stderrState = { buffered: '' };

    child.stdout.on('data', (chunk: Buffer) => {
        readLinesFromChunk(stdoutState, chunk, 'stdout', enqueue);
    });
    child.stderr.on('data', (chunk: Buffer) => {
        readLinesFromChunk(stderrState, chunk, 'stderr', enqueue);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
            terminalError = new LauncherError(
                'environment',
                'Docker CLI was not found while streaming logs.',
                error
            );
            enqueue(null);
            return;
        }
        terminalError = error;
        enqueue(null);
    });

    child.on('close', (code) => {
        if (stdoutState.buffered.length > 0) {
            enqueue({ text: stdoutState.buffered, stream: 'stdout' });
        }
        if (stderrState.buffered.length > 0) {
            enqueue({ text: stderrState.buffered, stream: 'stderr' });
        }
        if (code !== 0) {
            terminalError ??= new LauncherError(
                'runtime',
                `Docker command failed: docker ${args.join(' ')}\ndocker logs exited with status ${code ?? 1}`
            );
        }
        enqueue(null);
    });

    while (true) {
        if (queue.length === 0) {
            await new Promise<void>((resolve) => {
                resolveNext = resolve;
            });
        }

        const item = queue.shift();
        if (item === null) {
            if (terminalError) {
                throw terminalError;
            }
            return;
        }
        if (item) {
            yield item;
        }
    }
};
