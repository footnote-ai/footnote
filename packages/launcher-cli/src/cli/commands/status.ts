/**
 * @description: Status command orchestration for read-only runtime inspection output.
 * @footnote-scope: core
 * @footnote-module: LauncherCliStatusCommand
 * @footnote-risk: medium - Status routing issues can misreport managed runtime state.
 * @footnote-ethics: low - Accurate status output supports user oversight and safe operations.
 */

import {
    DEFAULT_CONTAINER_NAME,
    DEFAULT_VOLUME_NAME,
    LAUNCHER_ID,
} from '../../constants.js';
import { printStatus } from '../statusOutput.js';
import type { CommandContext } from '../types.js';

export const handleStatusCommand = async (
    context: CommandContext
): Promise<number> => {
    const { configRoot, configRootHash, paths, runtime, dependencies } =
        context;
    const metadata = await dependencies.readLauncherMetadataFn(
        paths.launcherMetadataPath
    );

    if (!metadata) {
        printStatus(
            dependencies,
            {
                state: 'not_found',
                containerName: DEFAULT_CONTAINER_NAME,
                configRoot,
                volumeName: DEFAULT_VOLUME_NAME,
                ownershipMatches: false,
            },
            null,
            configRoot
        );
        return 0;
    }

    const status = await runtime.status({
        configRoot,
        configRootHash,
        instance: metadata.instance,
        launcherId: LAUNCHER_ID,
        containerName: DEFAULT_CONTAINER_NAME,
        volumeName: DEFAULT_VOLUME_NAME,
    });

    printStatus(dependencies, status, metadata, configRoot);
    return 0;
};
