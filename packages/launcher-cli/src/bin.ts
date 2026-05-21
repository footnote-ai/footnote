#!/usr/bin/env node
/**
 * @description: Executable entrypoint for the standalone footnote launcher binary and npm bin.
 * @footnote-scope: core
 * @footnote-module: LauncherCliBin
 * @footnote-risk: medium - Entrypoint failures block all launcher command execution.
 * @footnote-ethics: low - Entrypoint delegates to typed command handling and explicit diagnostics.
 */

import { runCliWithExitCode } from './cli.js';

const pauseBeforeClose = async (): Promise<void> =>
    new Promise((resolve) => {
        process.stdout.write('\nPress Enter to close this window.\n');

        if (!process.stdin.isTTY) {
            setTimeout(resolve, 8_000);
            return;
        }

        process.stdin.resume();
        process.stdin.once('data', () => resolve());
    });

const main = async (): Promise<void> => {
    const argv = process.argv.slice(2);
    await runCliWithExitCode(argv);

    const shouldPauseForDoubleClickFailure =
        process.platform === 'win32' &&
        argv.length === 0 &&
        (process.exitCode ?? 0) !== 0;

    if (shouldPauseForDoubleClickFailure) {
        await pauseBeforeClose();
    }
};

void main();
