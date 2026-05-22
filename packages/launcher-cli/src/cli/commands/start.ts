/**
 * @description: Start command orchestration for launcher-managed runtime startup and metadata updates.
 * @footnote-scope: core
 * @footnote-module: LauncherCliStartCommand
 * @footnote-risk: high - Startup orchestration errors can break runtime availability and persisted state.
 * @footnote-ethics: medium - Accurate startup reporting preserves operator trust and accountability.
 */

import { formatMessage, type LauncherMetadata } from '@footnote/launcher-core';
import {
    DEFAULT_CONTAINER_NAME,
    DEFAULT_PREFERRED_PORT,
    DEFAULT_READINESS_TIMEOUT_MS,
    DEFAULT_VOLUME_NAME,
    LAUNCHER_ID,
} from '../../constants.js';
import { resolveMetadataWithDefaults } from '../metadata.js';
import { captureLatestSetupEventFromRuntimeLogs } from '../setupEvents.js';
import type { CommandContext } from '../types.js';

const writeLine = (context: CommandContext, line: string): void => {
    context.dependencies.writeStdout(`${line}\n`);
};

export const handleStartCommand = async (
    context: CommandContext,
    input: {
        headless: boolean;
        tagOverride?: string;
    }
): Promise<number> => {
    const { configRoot, configRootHash, paths, runtime, dependencies } =
        context;
    const bootstrapResult = await dependencies.bootstrapConfigFilesFn(paths);
    const metadata = resolveMetadataWithDefaults(bootstrapResult.metadata);
    const persistedTag = input.tagOverride ?? metadata.defaultTag;
    const metadataForStart: LauncherMetadata = {
        ...metadata,
        defaultTag: persistedTag,
    };

    if (input.tagOverride) {
        await dependencies.writeLauncherMetadataFn(
            paths.launcherMetadataPath,
            metadataForStart
        );
    }

    const preferredPort =
        metadataForStart.lastKnown?.port ?? DEFAULT_PREFERRED_PORT;

    const startResult = await runtime.start({
        configRoot,
        configRootHash,
        instance: metadataForStart.instance,
        launcherId: LAUNCHER_ID,
        containerName: DEFAULT_CONTAINER_NAME,
        volumeName: DEFAULT_VOLUME_NAME,
        imageRepository: metadataForStart.imageRepository,
        defaultTag: metadataForStart.defaultTag,
        tagOverride: input.tagOverride,
        digestByTag: metadataForStart.digestByTag,
        preferredPort,
        envFilePath: paths.envFilePath,
        settingsFilePath: paths.settingsFilePath,
        headless: input.headless,
        readinessTimeoutMs: DEFAULT_READINESS_TIMEOUT_MS,
    });

    let updatedMetadata: LauncherMetadata = {
        ...metadataForStart,
        defaultTag: persistedTag,
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

    try {
        const latestSetupEvent = await captureLatestSetupEventFromRuntimeLogs({
            runtime,
            configRoot,
            configRootHash,
            instance: metadataForStart.instance,
        });
        if (latestSetupEvent) {
            updatedMetadata = {
                ...updatedMetadata,
                setup: {
                    ...updatedMetadata.setup,
                    lastBootstrapEvent: {
                        ...latestSetupEvent,
                        capturedAtIso: dependencies.nowIso(),
                    },
                },
            };
        }
    } catch {
        // Fail-open: setup-event capture is best-effort metadata enrichment.
    }

    await dependencies.writeLauncherMetadataFn(
        paths.launcherMetadataPath,
        updatedMetadata
    );

    if (bootstrapResult.createdPaths.length > 0) {
        writeLine(
            context,
            formatMessage(
                'info',
                `Created config files:\n${bootstrapResult.createdPaths.join('\n')}`
            )
        );
    }

    for (const warning of startResult.warnings) {
        writeLine(context, formatMessage('warn', warning));
    }

    writeLine(
        context,
        formatMessage('success', `Footnote is running at ${startResult.url}`)
    );

    if (!input.headless) {
        try {
            await dependencies.openInBrowserFn(startResult.url);
        } catch (error: unknown) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Unknown browser open error.';
            writeLine(
                context,
                formatMessage(
                    'warn',
                    `Could not open browser automatically: ${message}`
                )
            );
        }
    }

    return 0;
};
