/**
 * @description: CLI orchestration for standalone footnote runtime lifecycle commands.
 * @footnote-scope: core
 * @footnote-module: LauncherCli
 * @footnote-risk: high - Command orchestration errors can break startup safety and user runtime control.
 * @footnote-ethics: medium - Clear, fail-open diagnostics support accountable operations and user autonomy.
 */

import path from 'node:path';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
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
    type FootnoteRuntime,
    type LauncherConfigPaths,
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
import {
    parseLauncherArgs,
    type LauncherArgs,
    type LauncherCommand,
} from './args.js';
import { DockerRuntime } from './runtime/dockerRuntime.js';

type InfoMenuAction =
    | 'start'
    | 'setup'
    | 'update'
    | 'status'
    | 'open'
    | 'logs_no_follow'
    | 'stop'
    | 'help'
    | 'exit';

type CliDependencies = {
    parseArgs: (argv: readonly string[]) => LauncherArgs;
    createRuntime: () => FootnoteRuntime;
    bootstrapConfigFilesFn: typeof bootstrapConfigFiles;
    readLauncherMetadataFn: typeof readLauncherMetadata;
    writeLauncherMetadataFn: typeof writeLauncherMetadata;
    openInBrowserFn: typeof openInBrowser;
    resolveDefaultConfigRootFn: typeof resolveDefaultConfigRoot;
    resolveConfigPathsFn: typeof resolveConfigPaths;
    computeConfigRootHashFn: typeof computeConfigRootHash;
    isSettingsFileMissingFn: (settingsFilePath: string) => Promise<boolean>;
    isInteractiveTty: () => boolean;
    promptInfoMenuAction: () => Promise<InfoMenuAction>;
    nowIso: () => string;
    writeStdout: (text: string) => void;
};

type CommandContext = {
    parsed: LauncherArgs;
    configRoot: string;
    paths: LauncherConfigPaths;
    configRootHash: string;
    runtime: FootnoteRuntime;
    dependencies: CliDependencies;
};

const INFO_MENU_ITEMS: ReadonlyArray<{
    action: InfoMenuAction;
    label: string;
}> = [
    { action: 'start', label: 'Start' },
    { action: 'setup', label: 'Setup' },
    { action: 'update', label: 'Update' },
    { action: 'status', label: 'Status' },
    { action: 'open', label: 'Open' },
    { action: 'logs_no_follow', label: 'Logs (no-follow)' },
    { action: 'stop', label: 'Stop' },
    { action: 'help', label: 'Help' },
    { action: 'exit', label: 'Exit' },
];

const writeLine = (dependencies: CliDependencies, line: string): void => {
    dependencies.writeStdout(`${line}\n`);
};

const printHelp = (dependencies: CliDependencies): void => {
    const lines = [
        'footnote <command> [options]',
        'No command defaults to: footnote info',
        '',
        'Commands:',
        '  info    Show launcher info and interactive menu in TTY mode',
        '  start   Start Footnote using Docker + GHCR image',
        '  setup   Open first-setup link when footnote.yaml is missing',
        '  update  Restart launcher-managed runtime with persisted/default tag',
        '  stop    Stop/remove launcher-managed container',
        '  status  Show runtime status without bootstrapping config files',
        '  open    Open the running launcher-managed URL if live',
        '  logs    Stream logs from launcher-managed container',
        '',
        'Options:',
        '  --config-dir <path>  Override launcher config root',
        '  --tag <imageTag>     Start with a specific GHCR tag and persist it',
        '  --headless           Do not auto-open browser on start',
        '  --no-follow          For logs, print current logs and exit',
    ];
    dependencies.writeStdout(`${lines.join('\n')}\n`);
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
    dependencies: CliDependencies,
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

    dependencies.writeStdout(`${lines.join('\n')}\n`);
};

const printReadOnlyInfoSnapshot = (
    dependencies: CliDependencies,
    configRoot: string
): void => {
    writeLine(
        dependencies,
        formatMessage(
            'info',
            'Read-only launcher snapshot (non-interactive mode).'
        )
    );
    writeLine(
        dependencies,
        formatMessage(
            'info',
            `Use \`footnote info\` in a terminal for the interactive menu.`
        )
    );
    writeLine(dependencies, formatMessage('info', `configRoot: ${configRoot}`));
    writeLine(
        dependencies,
        formatMessage(
            'info',
            'Actions: footnote start | footnote setup | footnote update | footnote status | footnote open | footnote logs --no-follow | footnote stop'
        )
    );
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
    runtime: FootnoteRuntime;
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

const defaultPromptInfoMenuAction = async (): Promise<InfoMenuAction> => {
    const readline = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        while (true) {
            process.stdout.write('\nFootnote Launcher Menu\n');
            for (const [index, item] of INFO_MENU_ITEMS.entries()) {
                process.stdout.write(`${index + 1}. ${item.label}\n`);
            }
            const answer = (
                await readline.question('Choose an action: ')
            ).trim();
            const selectedIndex = Number.parseInt(answer, 10);

            if (
                Number.isInteger(selectedIndex) &&
                selectedIndex >= 1 &&
                selectedIndex <= INFO_MENU_ITEMS.length
            ) {
                return INFO_MENU_ITEMS[selectedIndex - 1].action;
            }

            process.stdout.write(
                `${formatMessage('warn', `Invalid selection "${answer}". Enter a number from 1-${INFO_MENU_ITEMS.length}.`)}\n`
            );
        }
    } finally {
        readline.close();
    }
};

const DEFAULT_CLI_DEPENDENCIES: CliDependencies = {
    parseArgs: parseLauncherArgs,
    createRuntime: () => new DockerRuntime(),
    bootstrapConfigFilesFn: bootstrapConfigFiles,
    readLauncherMetadataFn: readLauncherMetadata,
    writeLauncherMetadataFn: writeLauncherMetadata,
    openInBrowserFn: openInBrowser,
    resolveDefaultConfigRootFn: resolveDefaultConfigRoot,
    resolveConfigPathsFn: resolveConfigPaths,
    computeConfigRootHashFn: computeConfigRootHash,
    isSettingsFileMissingFn: isSetupRequiredByMissingSettingsFile,
    isInteractiveTty: () =>
        Boolean(process.stdin.isTTY && process.stdout.isTTY),
    promptInfoMenuAction: defaultPromptInfoMenuAction,
    nowIso: () => new Date().toISOString(),
    writeStdout: (text: string) => {
        process.stdout.write(text);
    },
};

const handleStartCommand = async (
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
            dependencies,
            formatMessage(
                'info',
                `Created config files:\n${bootstrapResult.createdPaths.join('\n')}`
            )
        );
    }

    for (const warning of startResult.warnings) {
        writeLine(dependencies, formatMessage('warn', warning));
    }

    writeLine(
        dependencies,
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
                dependencies,
                formatMessage(
                    'warn',
                    `Could not open browser automatically: ${message}`
                )
            );
        }
    }

    return 0;
};

const handleSetupCommand = async (context: CommandContext): Promise<number> => {
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
        throw new LauncherError(
            'environment',
            formatSteps(
                `${path.basename(paths.settingsFilePath)} already exists; setup bootstrap is not required.`,
                [
                    'Run `footnote open` to open the current runtime URL.',
                    'Run `footnote status` to inspect runtime state.',
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
            writeLine(dependencies, formatMessage('warn', warning));
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
        await dependencies.openInBrowserFn(setupUrl);
        writeLine(
            dependencies,
            formatMessage('success', `Opened setup link: ${setupUrl}`)
        );
    } catch (error: unknown) {
        const message =
            error instanceof Error
                ? error.message
                : 'Unknown browser open error.';
        writeLine(
            dependencies,
            formatMessage(
                'warn',
                `Could not open browser automatically: ${message}`
            )
        );
        writeLine(
            dependencies,
            formatMessage('info', `Setup link: ${setupUrl}`)
        );
    }

    return 0;
};

const handleUpdateCommand = async (
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
        throw new LauncherError(
            'environment',
            formatSteps(
                `Cannot run update because ${path.basename(paths.settingsFilePath)} is missing.`,
                [
                    'Run `footnote setup` to complete first-time setup.',
                    'Then run `footnote update` again.',
                ]
            )
        );
    }

    if (bootstrapResult.createdPaths.length > 0) {
        writeLine(
            dependencies,
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
    writeLine(dependencies, formatMessage('info', stopResult.message));

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
        writeLine(dependencies, formatMessage('warn', warning));
    }

    writeLine(
        dependencies,
        formatMessage(
            'success',
            `Footnote update complete at ${startResult.url}`
        )
    );

    return 0;
};

const handleStatusCommand = async (
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

const handleStopCommand = async (context: CommandContext): Promise<number> => {
    const { configRoot, configRootHash, paths, runtime, dependencies } =
        context;
    const metadata = await dependencies.readLauncherMetadataFn(
        paths.launcherMetadataPath
    );

    if (!metadata) {
        writeLine(
            dependencies,
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

    writeLine(dependencies, formatMessage('info', stopResult.message));
    return 0;
};

const handleOpenCommand = async (context: CommandContext): Promise<number> => {
    const { configRoot, configRootHash, paths, runtime, dependencies } =
        context;
    const metadata = await dependencies.readLauncherMetadataFn(
        paths.launcherMetadataPath
    );

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
    await dependencies.openInBrowserFn(liveUrl);
    writeLine(dependencies, formatMessage('success', `Opened ${liveUrl}`));
    return 0;
};

const handleLogsCommand = async (
    context: CommandContext,
    follow: boolean
): Promise<number> => {
    const { configRoot, configRootHash, paths, runtime, dependencies } =
        context;
    const metadata = await dependencies.readLauncherMetadataFn(
        paths.launcherMetadataPath
    );

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
        follow,
    });

    for await (const line of lines) {
        writeLine(dependencies, line.text);
    }

    return 0;
};

const executeCommand = async (
    command: LauncherCommand,
    context: CommandContext
): Promise<number> => {
    switch (command) {
        case 'start':
            return handleStartCommand(context, {
                headless: context.parsed.headless,
                tagOverride: context.parsed.tag,
            });
        case 'setup':
            return handleSetupCommand(context);
        case 'update':
            return handleUpdateCommand(context);
        case 'status':
            return handleStatusCommand(context);
        case 'open':
            return handleOpenCommand(context);
        case 'logs':
            return handleLogsCommand(context, context.parsed.follow);
        case 'stop':
            return handleStopCommand(context);
        case 'help':
            printHelp(context.dependencies);
            return 0;
        case 'info':
            return 0;
        default:
            throw new LauncherError('usage', `Unsupported command: ${command}`);
    }
};

const handleInfoCommand = async (context: CommandContext): Promise<number> => {
    const { dependencies } = context;

    if (!dependencies.isInteractiveTty()) {
        try {
            await handleStatusCommand(context);
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : String(error);
            writeLine(dependencies, formatMessage('warn', message));
        }
        printReadOnlyInfoSnapshot(dependencies, context.configRoot);
        return 0;
    }

    while (true) {
        const action = await dependencies.promptInfoMenuAction();

        if (action === 'exit') {
            writeLine(
                dependencies,
                formatMessage('info', 'Exiting launcher menu.')
            );
            return 0;
        }

        if (action === 'help') {
            printHelp(dependencies);
            continue;
        }

        try {
            if (action === 'logs_no_follow') {
                await handleLogsCommand(context, false);
                continue;
            }
            await executeCommand(action, context);
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : String(error);
            writeLine(dependencies, formatMessage('error', message));
        }
    }
};

/**
 * Parses launcher CLI arguments and orchestrates command routing for runtime operations.
 * This function decides command flow and exit semantics, while delegating runtime actions to DockerRuntime and shared launcher-core helpers.
 * @param argv Raw CLI arguments after the executable name.
 * @returns Promise<number> Exit code following launcher contract (0/1/2/3).
 */
export const runCliWithDeps = async (
    argv: readonly string[],
    dependencyOverrides: Partial<CliDependencies> = {}
): Promise<number> => {
    const dependencies: CliDependencies = {
        ...DEFAULT_CLI_DEPENDENCIES,
        ...dependencyOverrides,
    };

    const parsed = dependencies.parseArgs(argv);

    if (parsed.command === 'help') {
        printHelp(dependencies);
        return 0;
    }

    const configRoot = path.resolve(
        parsed.configDir ??
            dependencies.resolveDefaultConfigRootFn(
                process.platform,
                process.env
            )
    );
    const paths = dependencies.resolveConfigPathsFn(configRoot);
    const configRootHash = dependencies.computeConfigRootHashFn(configRoot);

    const context: CommandContext = {
        parsed,
        configRoot,
        paths,
        configRootHash,
        runtime: dependencies.createRuntime(),
        dependencies,
    };

    if (parsed.command === 'info') {
        return handleInfoCommand(context);
    }

    return executeCommand(parsed.command, context);
};

export const runCli = async (argv: readonly string[]): Promise<number> =>
    runCliWithDeps(argv);

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
