/**
 * @description: Setup command orchestration for first-run bootstrap link discovery and opening.
 * @footnote-scope: core
 * @footnote-module: LauncherCliSetupCommand
 * @footnote-risk: high - Setup-link resolution failures can block first-time onboarding.
 * @footnote-ethics: medium - Correct setup handling impacts user autonomy and safe initialization.
 */

import path from 'node:path';
import {
    formatMessage,
    formatSteps,
    isSetupBootstrapEventUsable,
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
import {
    captureLatestSetupEventFromRuntimeLogs,
    readUsableSetupEventFromMetadata,
    resolveSetupUrlForLauncher,
} from '../setupEvents.js';
import type { CommandContext } from '../types.js';

const writeLine = (context: CommandContext, line: string): void => {
    context.dependencies.writeStdout(`${line}\n`);
};

export const handleSetupCommand = async (
    context: CommandContext
): Promise<number> => {
    const { configRoot, configRootHash, paths, runtime, dependencies } =
        context;

    const bootstrapResult = await dependencies.bootstrapConfigFilesFn(paths, {
        createSettingsFile: false,
    });
    const metadata = resolveMetadataWithDefaults(bootstrapResult.metadata);
    const setupRequiredNow = await dependencies.isSettingsFileMissingFn(
        paths.settingsFilePath
    );
    const shouldShowBootstrap = setupRequiredNow;

    if (!shouldShowBootstrap) {
        const openCommand = dependencies.formatCommand('open');
        const statusCommand = dependencies.formatCommand('status');
        throw new LauncherError(
            'environment',
            formatSteps(
                `${path.basename(paths.settingsFilePath)} already exists; setup bootstrap is not required.`,
                [
                    `Run \`${openCommand}\` to open the current runtime URL.`,
                    `Run \`${statusCommand}\` to inspect runtime state.`,
                ]
            )
        );
    }

    const statusBefore = await runtime.status({
        configRoot,
        configRootHash,
        instance: metadata.instance,
        launcherId: LAUNCHER_ID,
        containerName: DEFAULT_CONTAINER_NAME,
        volumeName: DEFAULT_VOLUME_NAME,
    });

    let activeMetadata: LauncherMetadata = metadata;
    if (
        statusBefore.state !== 'running' ||
        !statusBefore.ownershipMatches ||
        !statusBefore.url ||
        statusBefore.port === undefined
    ) {
        const preferredPort =
            metadata.lastKnown?.port ?? DEFAULT_PREFERRED_PORT;
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
            settingsMountMode: 'directory',
            headless: true,
            readinessTimeoutMs: DEFAULT_READINESS_TIMEOUT_MS,
        });

        activeMetadata = {
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
            activeMetadata
        );

        for (const warning of startResult.warnings) {
            writeLine(context, formatMessage('warn', warning));
        }
    }

    let setupEvent = shouldShowBootstrap
        ? readUsableSetupEventFromMetadata(activeMetadata, shouldShowBootstrap)
        : null;
    if (!setupEvent && shouldShowBootstrap) {
        const latestFromLogs = await captureLatestSetupEventFromRuntimeLogs({
            runtime,
            configRoot,
            configRootHash,
            instance: activeMetadata.instance,
        });
        if (latestFromLogs) {
            activeMetadata = {
                ...activeMetadata,
                setup: {
                    ...activeMetadata.setup,
                    lastBootstrapEvent: {
                        ...latestFromLogs,
                        capturedAtIso: dependencies.nowIso(),
                    },
                },
            };
            await dependencies.writeLauncherMetadataFn(
                paths.launcherMetadataPath,
                activeMetadata
            );
            if (isSetupBootstrapEventUsable(latestFromLogs)) {
                setupEvent = latestFromLogs;
            }
        }
    }

    if (!setupEvent) {
        const setupCommand = dependencies.formatCommand('setup');
        const logsCommand = dependencies.formatCommand('logs --no-follow');
        throw new LauncherError(
            'environment',
            formatSteps(
                'No usable setup bootstrap link is available from launcher-managed state or runtime logs.',
                [
                    'Confirm setup is required (footnote.yaml missing).',
                    `If the previous setup code expired, restart the runtime and run \`${setupCommand}\` again.`,
                    `Run \`${logsCommand}\` to inspect setup startup events.`,
                ]
            )
        );
    }

    const runtimeUrlForSetup =
        statusBefore.state === 'running' &&
        statusBefore.ownershipMatches &&
        statusBefore.url
            ? statusBefore.url
            : activeMetadata.lastKnown?.url;

    const setupUrl = resolveSetupUrlForLauncher({
        setupEvent,
        runtimeUrl: runtimeUrlForSetup,
    });

    try {
        await dependencies.openInBrowserFn(setupUrl);
        writeLine(
            context,
            formatMessage('success', `Opened setup link: ${setupUrl}`)
        );
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
        writeLine(context, formatMessage('info', `Setup link: ${setupUrl}`));
    }

    return 0;
};
