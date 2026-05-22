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

const writeLine = (context: CommandContext, line: string): void => {
    context.dependencies.writeStdout(`${line}\n`);
};

const ensureLiveUrl = async (
    url: string,
    formatCommand: (command: string) => string
): Promise<void> => {
    try {
        const response = await fetch(url);
        if (response.status >= 500) {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch {
        const startCommand = formatCommand('start');
        const logsCommand = formatCommand('logs');
        throw new LauncherError(
            'environment',
            formatSteps('Runtime is not reachable at the saved URL.', [
                `Run \`${startCommand}\` to start the runtime.`,
                `Run \`${logsCommand}\` to inspect startup output.`,
            ])
        );
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
    await ensureLiveUrl(liveUrl, dependencies.formatCommand);
    await dependencies.openInBrowserFn(liveUrl);
    writeLine(context, formatMessage('success', `Opened ${liveUrl}`));
    return 0;
};
