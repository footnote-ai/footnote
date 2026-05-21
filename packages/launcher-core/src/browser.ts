/**
 * @description: Browser open helper for launcher commands across supported operating systems.
 * @footnote-scope: utility
 * @footnote-module: LauncherBrowser
 * @footnote-risk: low - Browser launch failures affect convenience but not runtime state.
 * @footnote-ethics: low - Explicit local open behavior preserves user-directed interaction.
 */

import { spawn } from 'node:child_process';

const openWithCommand = (
    command: string,
    args: readonly string[]
): Promise<void> =>
    new Promise((resolve, reject) => {
        const child = spawn(command, [...args], {
            detached: true,
            stdio: 'ignore',
        });

        child.on('error', reject);
        child.on('spawn', () => {
            child.unref();
            resolve();
        });
    });

export const openInBrowser = async (url: string): Promise<void> => {
    if (process.platform === 'win32') {
        await openWithCommand('cmd', ['/c', 'start', '', url]);
        return;
    }

    if (process.platform === 'darwin') {
        await openWithCommand('open', [url]);
        return;
    }

    await openWithCommand('xdg-open', [url]);
};
