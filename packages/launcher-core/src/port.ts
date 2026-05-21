/**
 * @description: Host port probing helpers for launcher runtime allocation.
 * @footnote-scope: utility
 * @footnote-module: LauncherPorts
 * @footnote-risk: medium - Port mis-selection can block startup or bind unexpected endpoints.
 * @footnote-ethics: low - Deterministic local port selection supports operator predictability.
 */

import net from 'node:net';

const isPortAvailable = async (port: number): Promise<boolean> =>
    new Promise((resolve) => {
        const server = net.createServer();

        server.once('error', () => {
            resolve(false);
        });

        server.once('listening', () => {
            server.close(() => {
                resolve(true);
            });
        });

        server.listen(port, '127.0.0.1');
    });

export const selectAvailablePort = async (
    preferredPort: number,
    maxAttempts: number = 100
): Promise<number> => {
    if (!Number.isInteger(preferredPort)) {
        throw new Error(
            'preferredPort must be an integer between 1 and 65535.'
        );
    }
    if (preferredPort < 1 || preferredPort > 65_535) {
        throw new Error(
            'preferredPort must be within the valid TCP port range (1-65535).'
        );
    }

    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
        throw new Error('maxAttempts must be a positive integer.');
    }

    if (preferredPort + (maxAttempts - 1) > 65_535) {
        throw new Error(
            'preferredPort + (maxAttempts - 1) must not exceed 65535.'
        );
    }

    for (let offset = 0; offset < maxAttempts; offset += 1) {
        const candidate = preferredPort + offset;
        if (await isPortAvailable(candidate)) {
            return candidate;
        }
    }

    throw new Error(
        `Unable to find an available port after ${maxAttempts} attempts starting from ${preferredPort}.`
    );
};
