/**
 * @description: Stop command orchestration for launcher-managed container shutdown/removal.
 * @footnote-scope: core
 * @footnote-module: LauncherCliStopCommand
 * @footnote-risk: medium - Stop flow errors can leave runtime resources in inconsistent lifecycle state.
 * @footnote-ethics: low - Ownership-aware stopping protects unrelated operator resources.
 */

import { formatMessage } from '@footnote/launcher-core';
import {
    DEFAULT_CONTAINER_NAME,
    DEFAULT_VOLUME_NAME,
    LAUNCHER_ID,
} from '../../constants.js';
import type { CommandContext } from '../types.js';

const writeLine = (context: CommandContext, line: string): void => {
    context.dependencies.writeStdout(`${line}\n`);
};

export const handleStopCommand = async (
    context: CommandContext
): Promise<number> => {
    const { configRoot, configRootHash, paths, runtime, dependencies } =
        context;
    const metadata = await dependencies.readLauncherMetadataFn(
        paths.launcherMetadataPath
    );

    if (!metadata) {
        writeLine(
            context,
            formatMessage(
                'info',
                'No launcher metadata found; nothing to stop.'
            )
        );
        return 0;
    }

    const stopResult = await runtime.stop({
        configRoot,
        configRootHash,
        instance: metadata.instance,
        launcherId: LAUNCHER_ID,
        containerName: DEFAULT_CONTAINER_NAME,
        volumeName: DEFAULT_VOLUME_NAME,
    });

    writeLine(context, formatMessage('info', stopResult.message));
    return 0;
};
