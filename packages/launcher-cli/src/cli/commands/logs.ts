/**
 * @description: Logs command orchestration for launcher-managed runtime log streaming.
 * @footnote-scope: core
 * @footnote-module: LauncherCliLogsCommand
 * @footnote-risk: medium - Log routing failures can block runtime diagnostics during incidents.
 * @footnote-ethics: low - Reliable logs support transparent troubleshooting.
 */

import { formatSteps, LauncherError } from '@footnote/launcher-core';
import { DEFAULT_CONTAINER_NAME, LAUNCHER_ID } from '../../constants.js';
import type { CommandContext } from '../types.js';

const writeLine = (context: CommandContext, line: string): void => {
    context.dependencies.writeStdout(`${line}\n`);
};

export const handleLogsCommand = async (
    context: CommandContext,
    follow: boolean
): Promise<number> => {
    const { configRoot, configRootHash, paths, runtime, dependencies } =
        context;
    const metadata = await dependencies.readLauncherMetadataFn(
        paths.launcherMetadataPath
    );

    if (!metadata) {
        const startCommand = dependencies.formatCommand('start');
        const statusCommand = dependencies.formatCommand('status');
        throw new LauncherError(
            'environment',
            formatSteps('No launcher metadata found for logs.', [
                `Run \`${startCommand}\` to create launcher-managed resources.`,
                `Run \`${statusCommand}\` to inspect runtime state.`,
            ])
        );
    }

    const lines = runtime.logs({
        configRoot,
        configRootHash,
        instance: metadata.instance,
        launcherId: LAUNCHER_ID,
        containerName: DEFAULT_CONTAINER_NAME,
        follow,
    });

    for await (const line of lines) {
        writeLine(context, line.text);
    }

    return 0;
};
