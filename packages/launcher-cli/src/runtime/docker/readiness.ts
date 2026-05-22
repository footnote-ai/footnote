/**
 * @description: Runtime readiness polling and timeout diagnostics for Docker-backed launcher startup.
 * @footnote-scope: utility
 * @footnote-module: LauncherDockerReadiness
 * @footnote-risk: medium - Polling logic errors can report false readiness or premature timeout failures.
 * @footnote-ethics: low - Clear timeout guidance improves accountable troubleshooting.
 */

import { LauncherError } from '@footnote/launcher-core';
import { formatCommand } from './invocation.js';

export const waitForReadiness = async (
    url: string,
    timeoutMs: number
): Promise<void> => {
    const startedAt = Date.now();
    const delayMs = 1_000;

    while (true) {
        const elapsedMs = Date.now() - startedAt;
        const remainingMs = timeoutMs - elapsedMs;
        if (remainingMs <= 0) {
            break;
        }

        const attemptTimeoutMs = Math.max(1, Math.min(delayMs, remainingMs));
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(attemptTimeoutMs),
            });
            if (response.status < 500) {
                return;
            }
        } catch {
            // Keep polling until timeout.
        }

        await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), attemptTimeoutMs);
        });
    }

    throw new LauncherError(
        'runtime',
        [
            `Runtime readiness timed out after ${Math.round(timeoutMs / 1_000)}s.`,
            `URL: ${url}`,
            `Run \`${formatCommand('logs')}\` for diagnostic output.`,
        ].join(' ')
    );
};
