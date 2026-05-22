/**
 * @description: Update command orchestration for managed container restart with persisted/default tag.
 * @footnote-scope: core
 * @footnote-module: LauncherCliUpdateCommand
 * @footnote-risk: high - Incorrect stop/start sequencing can interrupt or misconfigure runtime state.
 * @footnote-ethics: low - Deterministic update flow supports transparent operator control.
 */

import path from 'node:path';
import {
    formatMessage,
    formatSteps,
    LauncherError,
    type LauncherMetadata,
} from '@footnote/launcher-core';
import {
    DEFAULT_CONTAINER_NAME,
    DEFAULT_PREFERRED_PORT,
    DEFAULT_READINESS_TIMEOUT_MS,
    DEFAULT_VOLUME_NAME,
    LAUNCHER_ID,
} from '../../constants.js';
import { resolveMetadataWithDefaults } from '../metadata.js';
import type { CommandContext } from '../types.js';

const writeLine = (context: CommandContext, line: string): void => {
    context.dependencies.writeStdout(`${line}\n`);
};

export const handleUpdateCommand = async (
    context: CommandContext
): Promise<number> => {
    const { configRoot, configRootHash, paths, runtime, dependencies } =
        context;

    const bootstrapResult = await dependencies.bootstrapConfigFilesFn(paths, {
        createSettingsFile: false,
    });
    const metadata = resolveMetadataWithDefaults(bootstrapResult.metadata);

    const settingsMissing = await dependencies.isSettingsFileMissingFn(
        paths.settingsFilePath
    );
    if (settingsMissing) {
        const setupCommand = dependencies.formatCommand('setup');
        const updateCommand = dependencies.formatCommand('update');
        throw new LauncherError(
            'environment',
            formatSteps(
                `Cannot run update because ${path.basename(paths.settingsFilePath)} is missing.`,
                [
                    `Run \`${setupCommand}\` to complete first-time setup.`,
                    `Then run \`${updateCommand}\` again.`,
                ]
            )
        );
    }

    if (bootstrapResult.createdPaths.length > 0) {
        writeLine(
            context,
            formatMessage(
                'info',
                `Created config files:\n${bootstrapResult.createdPaths.join('\n')}`
            )
        );
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

    const preferredPort = metadata.lastKnown?.port ?? DEFAULT_PREFERRED_PORT;
    const startResult = await runtime.start({
        configRoot,
        configRootHash,
        instance: metadata.instance,
        launcherId: LAUNCHER_ID,
        containerName: DEFAULT_CONTAINER_NAME,
        volumeName: DEFAULT_VOLUME_NAME,
        imageRepository: metadata.imageRepository,
        defaultTag: metadata.defaultTag,
        digestByTag: metadata.digestByTag,
        preferredPort,
        envFilePath: paths.envFilePath,
        settingsFilePath: paths.settingsFilePath,
        headless: true,
        readinessTimeoutMs: DEFAULT_READINESS_TIMEOUT_MS,
    });

    const updatedMetadata: LauncherMetadata = {
        ...metadata,
        lastKnown: {
            url: startResult.url,
            port: startResult.port,
            tag: startResult.tag,
            imageRef: startResult.imageRef,
            containerName: DEFAULT_CONTAINER_NAME,
            volumeName: DEFAULT_VOLUME_NAME,
            updatedAtIso: dependencies.nowIso(),
        },
    };

    await dependencies.writeLauncherMetadataFn(
        paths.launcherMetadataPath,
        updatedMetadata
    );

    for (const warning of startResult.warnings) {
        writeLine(context, formatMessage('warn', warning));
    }

    writeLine(
        context,
        formatMessage(
            'success',
            `Footnote update complete at ${startResult.url}`
        )
    );

    return 0;
};
