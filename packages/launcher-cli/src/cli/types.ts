/**
 * @description: Shared internal CLI orchestration types for command handlers and dependency injection.
 * @footnote-scope: interface
 * @footnote-module: LauncherCliTypes
 * @footnote-risk: medium - Type drift can break command routing contracts across extracted modules.
 * @footnote-ethics: low - Strong typing preserves predictable operator-visible behavior.
 */

import type {
    bootstrapConfigFiles,
    computeConfigRootHash,
    openInBrowser,
    readLauncherMetadata,
    resolveConfigPaths,
    resolveDefaultConfigRoot,
    writeLauncherMetadata,
    FootnoteRuntime,
    LauncherConfigPaths,
} from '@footnote/launcher-core';
import type { LauncherArgs } from '../args.js';

export type InfoMenuAction =
    | 'start'
    | 'setup'
    | 'update'
    | 'status'
    | 'open'
    | 'logs_no_follow'
    | 'stop'
    | 'help'
    | 'exit';

export type CliDependencies = {
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
    promptSetupForceConfirmation: () => Promise<boolean>;
    nowIso: () => string;
    formatCommand: (command: string) => string;
    writeStdout: (text: string) => void;
};

export type CommandContext = {
    parsed: LauncherArgs;
    configRoot: string;
    paths: LauncherConfigPaths;
    configRootHash: string;
    runtime: FootnoteRuntime;
    dependencies: CliDependencies;
};
