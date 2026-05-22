/**
 * @description: CLI orchestration for standalone footnote runtime lifecycle commands.
 * @footnote-scope: core
 * @footnote-module: LauncherCli
 * @footnote-risk: high - Command orchestration errors can break startup safety and user runtime control.
 * @footnote-ethics: medium - Clear, fail-open diagnostics support accountable operations and user autonomy.
 */

import path from 'node:path';
import { access } from 'node:fs/promises';
import {
    bootstrapConfigFiles,
    computeConfigRootHash,
    DEFAULT_IMAGE_REPOSITORY,
    DEFAULT_IMAGE_TAG,
    formatMessage,
    formatSteps,
    isLauncherError,
    LauncherError,
    openInBrowser,
    readLauncherMetadata,
    resolveConfigPaths,
    resolveDefaultConfigRoot,
    parseSetupBootstrapEventLine,
    isSetupBootstrapEventUsable,
    writeLauncherMetadata,
    type LauncherMetadata,
    type SetupBootstrapEvent,
    type StatusResult,
} from '@footnote/launcher-core';
import {
    DEFAULT_CONTAINER_NAME,
    DEFAULT_PREFERRED_PORT,
    DEFAULT_READINESS_TIMEOUT_MS,
    DEFAULT_VOLUME_NAME,
    LAUNCHER_ID,
} from './constants.js';
import { parseLauncherArgs } from './args.js';
import { DockerRuntime } from './runtime/dockerRuntime.js';

const printHelp = (): void => {
    const lines = [
        'footnote <command> [options]',
        'No command defaults to: footnote start',
        '',
        'Commands:',
        '  start   Start Footnote using Docker + GHCR image',
        '  stop    Stop/remove launcher-managed container',
        '  status  Show runtime status without bootstrapping config files',
        '  open    Open the running launcher-managed URL if live',
        '  setup   Open first-setup link when footnote.yaml is missing',
        '  logs    Stream logs from launcher-managed container',
        '',
        'Options:',
        '  --config-dir <path>  Override launcher config root',
        '  --tag <imageTag>     Start with a specific GHCR tag and persist it',
        '  --headless           Do not auto-open browser on start',
        '  --no-follow          For logs, print current logs and exit',
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
};

const mapErrorToExitCode = (error: unknown): number => {
    if (isLauncherError(error)) {
        if (error.kind === 'usage') {
            return 2;
        }
        if (error.kind === 'environment') {
            return 1;
        }
        return 3;
    }
    return 3;
};

const resolveMetadataWithDefaults = (
    metadata: LauncherMetadata | null
): LauncherMetadata => {
    if (metadata) {
        return metadata;
    }
    return {
        version: 1,
        runtime: 'docker',
        instance: 'default',
        imageRepository: DEFAULT_IMAGE_REPOSITORY,
        defaultTag: DEFAULT_IMAGE_TAG,
    };
};

const printStatus = (
    status: StatusResult,
    metadata: LauncherMetadata | null,
    configRoot: string
): void => {
    const lines: string[] = [];

    lines.push(formatMessage('info', `runtime: docker`));
    lines.push(formatMessage('info', `state: ${status.state}`));
    lines.push(formatMessage('info', `configRoot: ${configRoot}`));

    if (status.port !== undefined && status.url) {
        lines.push(formatMessage('info', `url: ${status.url}`));
        lines.push(formatMessage('info', `port: ${status.port}`));
    } else if (metadata?.lastKnown) {
        lines.push(formatMessage('info', `url: ${metadata.lastKnown.url}`));
        lines.push(formatMessage('info', `port: ${metadata.lastKnown.port}`));
    }

    const imageRef = status.imageRef ?? metadata?.lastKnown?.imageRef;
    if (imageRef) {
        lines.push(formatMessage('info', `image: ${imageRef}`));
    }

    const tag = status.tag ?? metadata?.lastKnown?.tag ?? metadata?.defaultTag;
    if (tag) {
        lines.push(formatMessage('info', `tag: ${tag}`));
    }

    lines.push(formatMessage('info', `container: ${status.containerName}`));
    lines.push(formatMessage('info', `volume: ${status.volumeName}`));

    if (status.state !== 'not_found') {
        lines.push(
            formatMessage(
                status.ownershipMatches ? 'info' : 'warn',
                `ownershipLabels: ${status.ownershipMatches ? 'matched' : 'mismatch'}`
            )
        );
    }

    process.stdout.write(`${lines.join('\n')}\n`);
};

const ensureLiveUrl = async (url: string): Promise<void> => {
    try {
        const response = await fetch(url);
        if (response.status >= 500) {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch {
        throw new LauncherError(
            'environment',
            formatSteps('Runtime is not reachable at the saved URL.', [
                'Run `footnote start` to start the runtime.',
                'Run `footnote logs` to inspect startup output.',
            ])
        );
    }
};

const readUsableSetupEventFromMetadata = (
    metadata: LauncherMetadata | null,
    allowMetadataFallback: boolean
): SetupBootstrapEvent | null => {
    if (!allowMetadataFallback) {
        return null;
    }
    const setupEvent = metadata?.setup?.lastBootstrapEvent;
    if (!setupEvent) {
        return null;
    }
    if (!isSetupBootstrapEventUsable(setupEvent)) {
        return null;
    }
    return {
        event: 'footnote.setup.bootstrap',
        setupPath: setupEvent.setupPath,
        setupUrl: setupEvent.setupUrl,
        expiresAt: setupEvent.expiresAt,
    };
};

const captureLatestSetupEventFromRuntimeLogs = async ({
    runtime,
    configRoot,
    configRootHash,
    instance,
}: {
    runtime: DockerRuntime;
    configRoot: string;
    configRootHash: string;
    instance: string;
}): Promise<SetupBootstrapEvent | null> => {
    const lines = runtime.logs({
        configRoot,
        configRootHash,
        instance,
        launcherId: LAUNCHER_ID,
        containerName: DEFAULT_CONTAINER_NAME,
        follow: false,
    });
    let latest: SetupBootstrapEvent | null = null;
    for await (const line of lines) {
        const parsed = parseSetupBootstrapEventLine(line.text);
        if (parsed) {
            latest = parsed;
        }
    }
    return latest;
};

const resolveSetupUrlForLauncher = ({
    setupEvent,
    runtimeUrl,
}: {
    setupEvent: SetupBootstrapEvent;
    runtimeUrl?: string;
}): string => {
    if (!runtimeUrl) {
        return setupEvent.setupUrl;
    }
    try {
        const baseUrl = new URL(runtimeUrl);
        return new URL(setupEvent.setupPath, baseUrl).toString();
    } catch {
        return setupEvent.setupUrl;
    }
};

const isSetupRequiredByMissingSettingsFile = async (
    settingsFilePath: string
): Promise<boolean> => {
    try {
        await access(settingsFilePath);
        return false;
    } catch {
        return true;
    }
};

/**
 * Parses launcher CLI arguments and orchestrates command routing for runtime operations.
 * This function decides command flow and exit semantics, while delegating runtime actions to DockerRuntime and shared launcher-core helpers.
 * @param argv Raw CLI arguments after the executable name.
 * @returns Promise<number> Exit code following launcher contract (0/1/2/3).
 */
export const runCli = async (argv: readonly string[]): Promise<number> => {
    const parsed = parseLauncherArgs(argv);

    if (parsed.command === 'help') {
        printHelp();
        return 0;
    }

    const configRoot = path.resolve(
        parsed.configDir ??
            resolveDefaultConfigRoot(process.platform, process.env)
    );
    const paths = resolveConfigPaths(configRoot);
    const configRootHash = computeConfigRootHash(configRoot);

    const runtime = new DockerRuntime();

    if (parsed.command === 'start') {
        const bootstrapResult = await bootstrapConfigFiles(paths);
        const metadata = resolveMetadataWithDefaults(bootstrapResult.metadata);
        const persistedTag = parsed.tag ?? metadata.defaultTag;
        const metadataForStart: LauncherMetadata = {
            ...metadata,
            defaultTag: persistedTag,
        };

        if (parsed.tag) {
            await writeLauncherMetadata(
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
            tagOverride: parsed.tag,
            digestByTag: metadataForStart.digestByTag,
            preferredPort,
            envFilePath: paths.envFilePath,
            settingsFilePath: paths.settingsFilePath,
            headless: parsed.headless,
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
                updatedAtIso: new Date().toISOString(),
            },
        };

        try {
            const latestSetupEvent =
                await captureLatestSetupEventFromRuntimeLogs({
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
                            capturedAtIso: new Date().toISOString(),
                        },
                    },
                };
            }
        } catch {
            // Fail-open: setup-event capture is best-effort metadata enrichment.
        }

        await writeLauncherMetadata(
            paths.launcherMetadataPath,
            updatedMetadata
        );

        if (bootstrapResult.createdPaths.length > 0) {
            process.stdout.write(
                `${formatMessage('info', `Created config files:\n${bootstrapResult.createdPaths.join('\n')}`)}\n`
            );
        }

        for (const warning of startResult.warnings) {
            process.stdout.write(`${formatMessage('warn', warning)}\n`);
        }

        process.stdout.write(
            `${formatMessage('success', `Footnote is running at ${startResult.url}`)}\n`
        );

        if (!parsed.headless) {
            try {
                await openInBrowser(startResult.url);
            } catch (error: unknown) {
                const message =
                    error instanceof Error
                        ? error.message
                        : 'Unknown browser open error.';
                process.stdout.write(
                    `${formatMessage('warn', `Could not open browser automatically: ${message}`)}\n`
                );
            }
        }

        return 0;
    }

    if (parsed.command === 'setup') {
        const bootstrapResult = await bootstrapConfigFiles(paths, {
            createSettingsFile: false,
        });
        const metadata = resolveMetadataWithDefaults(bootstrapResult.metadata);
        const setupRequiredNow = await isSetupRequiredByMissingSettingsFile(
            paths.settingsFilePath
        );

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
                    updatedAtIso: new Date().toISOString(),
                },
            };
            await writeLauncherMetadata(
                paths.launcherMetadataPath,
                activeMetadata
            );

            for (const warning of startResult.warnings) {
                process.stdout.write(`${formatMessage('warn', warning)}\n`);
            }
        }

        let setupEvent = readUsableSetupEventFromMetadata(
            activeMetadata,
            setupRequiredNow
        );
        if (!setupEvent) {
            const latestFromLogs = await captureLatestSetupEventFromRuntimeLogs(
                {
                    runtime,
                    configRoot,
                    configRootHash,
                    instance: activeMetadata.instance,
                }
            );
            if (latestFromLogs) {
                activeMetadata = {
                    ...activeMetadata,
                    setup: {
                        ...activeMetadata.setup,
                        lastBootstrapEvent: {
                            ...latestFromLogs,
                            capturedAtIso: new Date().toISOString(),
                        },
                    },
                };
                await writeLauncherMetadata(
                    paths.launcherMetadataPath,
                    activeMetadata
                );
                if (isSetupBootstrapEventUsable(latestFromLogs)) {
                    setupEvent = latestFromLogs;
                }
            }
        }

        if (!setupEvent) {
            throw new LauncherError(
                'environment',
                formatSteps(
                    'No usable setup bootstrap link is available from launcher-managed state or runtime logs.',
                    [
                        'Confirm setup is required (footnote.yaml missing).',
                        'If the previous setup code expired, restart the runtime and run `footnote setup` again.',
                        'Run `footnote logs --no-follow` to inspect setup startup events.',
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
            await openInBrowser(setupUrl);
            process.stdout.write(
                `${formatMessage('success', `Opened setup link: ${setupUrl}`)}\n`
            );
        } catch (error: unknown) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Unknown browser open error.';
            process.stdout.write(
                `${formatMessage('warn', `Could not open browser automatically: ${message}`)}\n`
            );
            process.stdout.write(
                `${formatMessage('info', `Setup link: ${setupUrl}`)}\n`
            );
        }
        return 0;
    }

    const metadata = await readLauncherMetadata(paths.launcherMetadataPath);

    if (parsed.command === 'status') {
        if (!metadata) {
            printStatus(
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

        printStatus(status, metadata, configRoot);
        return 0;
    }

    if (parsed.command === 'stop') {
        if (!metadata) {
            process.stdout.write(
                `${formatMessage('info', 'No launcher metadata found; nothing to stop.')}\n`
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

        process.stdout.write(`${formatMessage('info', stopResult.message)}\n`);
        return 0;
    }

    if (parsed.command === 'open') {
        if (!metadata?.lastKnown?.url) {
            throw new LauncherError(
                'environment',
                formatSteps('No saved runtime URL is available.', [
                    'Run `footnote start` to initialize and start the runtime.',
                    'Run `footnote status` to inspect current runtime state.',
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
            throw new LauncherError(
                'environment',
                formatSteps('Runtime is not currently live.', [
                    'Run `footnote start` to start the launcher-managed runtime.',
                    'Run `footnote logs` to inspect startup output.',
                ])
            );
        }

        const liveUrl = status.url ?? metadata.lastKnown.url;
        await ensureLiveUrl(liveUrl);
        await openInBrowser(liveUrl);
        process.stdout.write(
            `${formatMessage('success', `Opened ${liveUrl}`)}\n`
        );
        return 0;
    }

    if (parsed.command === 'logs') {
        if (!metadata) {
            throw new LauncherError(
                'environment',
                formatSteps('No launcher metadata found for logs.', [
                    'Run `footnote start` to create launcher-managed resources.',
                    'Run `footnote status` to inspect runtime state.',
                ])
            );
        }

        const lines = runtime.logs({
            configRoot,
            configRootHash,
            instance: metadata.instance,
            launcherId: LAUNCHER_ID,
            containerName: DEFAULT_CONTAINER_NAME,
            follow: parsed.follow,
        });

        for await (const line of lines) {
            process.stdout.write(`${line.text}\n`);
        }

        return 0;
    }

    throw new LauncherError('usage', `Unsupported command: ${parsed.command}`);
};

/**
 * Executes the CLI orchestration and writes process exit code plus error output.
 * This wrapper is responsible for translating thrown errors into operator-facing stderr messages without suppressing failures.
 * @param argv Raw CLI arguments after the executable name.
 * @returns Promise<void> Completion after setting process.exitCode.
 */
export const runCliWithExitCode = async (
    argv: readonly string[]
): Promise<void> => {
    try {
        const exitCode = await runCli(argv);
        process.exitCode = exitCode;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${formatMessage('error', message)}\n`);
        process.exitCode = mapErrorToExitCode(error);
    }
};
