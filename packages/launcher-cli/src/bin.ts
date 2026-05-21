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
        let finished = false;
        const finish = (): void => {
            if (finished) {
                return;
            }
            finished = true;
            process.stdin.pause();
            resolve();
        };

        if (!process.stdin.isTTY) {
            setTimeout(finish, 8_000);
            return;
        }

        process.stdin.resume();
        process.stdin.once('data', finish);
        setTimeout(finish, 30_000);
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
