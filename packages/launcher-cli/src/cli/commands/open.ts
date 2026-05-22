/**
 * @description: Open command orchestration for validating and launching the live runtime URL.
 * @footnote-scope: core
 * @footnote-module: LauncherCliOpenCommand
 * @footnote-risk: medium - Incorrect liveness checks can open stale or unavailable runtime endpoints.
 * @footnote-ethics: low - Explicit diagnostics help users make informed runtime actions.
 */

import {
    formatMessage,
    formatSteps,
    LauncherError,
} from '@footnote/launcher-core';
import {
    DEFAULT_CONTAINER_NAME,
    DEFAULT_VOLUME_NAME,
    LAUNCHER_ID,
} from '../../constants.js';
import type { CommandContext } from '../types.js';
import { writeLine } from '../writeLine.js';

const isAllowedProtocol = (protocol: string): boolean =>
    protocol === 'http:' || protocol === 'https:';

const ensureLiveUrl = async (
    url: string,
    formatCommand: (command: string) => string
): Promise<void> => {
    const controller = new AbortController();
    const timeoutMs = 5_000;
    const timeoutHandle = setTimeout(() => {
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
        });
        if (response.status >= 500) {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error: unknown) {
        const timeoutSuffix =
            error instanceof Error && error.name === 'AbortError'
                ? ` (timed out after ${timeoutMs / 1_000}s)`
                : '';
        const startCommand = formatCommand('start');
        const logsCommand = formatCommand('logs');
        throw new LauncherError(
            'environment',
            formatSteps(
                `Runtime is not reachable at the saved URL${timeoutSuffix}.`,
                [
                    `Run \`${startCommand}\` to start the runtime.`,
                    `Run \`${logsCommand}\` to inspect startup output.`,
                ]
            )
        );
    } finally {
        clearTimeout(timeoutHandle);
    }
};

export const handleOpenCommand = async (
    context: CommandContext
): Promise<number> => {
    const { configRoot, configRootHash, paths, runtime, dependencies } =
        context;
    const metadata = await dependencies.readLauncherMetadataFn(
        paths.launcherMetadataPath
    );

    if (!metadata?.lastKnown?.url) {
        const startCommand = dependencies.formatCommand('start');
        const statusCommand = dependencies.formatCommand('status');
        throw new LauncherError(
            'environment',
            formatSteps('No saved runtime URL is available.', [
                `Run \`${startCommand}\` to initialize and start the runtime.`,
                `Run \`${statusCommand}\` to inspect current runtime state.`,
            ])
        );
    }

    const status = await runtime.status({
        configRoot,
        configRootHash,
        instance: metadata.instance,
        launcherId: LAUNCHER_ID,
        containerName: DEFAULT_CONTAINER_NAME,
        volumeName: DEFAULT_VOLUME_NAME,
    });

    if (status.state !== 'running' || !status.ownershipMatches) {
        const startCommand = dependencies.formatCommand('start');
        const logsCommand = dependencies.formatCommand('logs');
        throw new LauncherError(
            'environment',
            formatSteps('Runtime is not currently live.', [
                `Run \`${startCommand}\` to start the launcher-managed runtime.`,
                `Run \`${logsCommand}\` to inspect startup output.`,
            ])
        );
    }

    const liveUrl = status.url ?? metadata.lastKnown.url;
    let parsedLiveUrl: URL;
    try {
        parsedLiveUrl = new URL(liveUrl);
    } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new LauncherError(
            'environment',
            `Saved runtime URL is invalid: ${reason}`
        );
    }
    if (!isAllowedProtocol(parsedLiveUrl.protocol)) {
        throw new LauncherError(
            'environment',
            `Refusing to open URL with unsupported protocol: ${parsedLiveUrl.protocol}`
        );
    }

    await ensureLiveUrl(liveUrl, dependencies.formatCommand);
    await dependencies.openInBrowserFn(liveUrl);
    writeLine(context, formatMessage('success', `Opened ${liveUrl}`));
    return 0;
};
