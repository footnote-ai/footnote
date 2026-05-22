/**
 * @description: Default dependency wiring for launcher CLI composition and test-time overrides.
 * @footnote-scope: core
 * @footnote-module: LauncherCliDependencies
 * @footnote-risk: high - Miswired dependencies can break command execution or runtime ownership checks.
 * @footnote-ethics: low - Explicit wiring preserves predictable operator behavior.
 */

import { access } from 'node:fs/promises';
import {
    bootstrapConfigFiles,
    computeConfigRootHash,
    openInBrowser,
    readLauncherMetadata,
    resolveConfigPaths,
    resolveDefaultConfigRoot,
    writeLauncherMetadata,
} from '@footnote/launcher-core';
import { parseLauncherArgs } from '../args.js';
import { DockerRuntime } from '../runtime/dockerRuntime.js';
import {
    formatCommandForInvocation,
    resolveInvocationName,
} from './invocation.js';
import { promptInfoMenuActionDefault } from './menu.js';
import type { CliDependencies } from './types.js';

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

export const DEFAULT_CLI_DEPENDENCIES: CliDependencies = {
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
    promptInfoMenuAction: promptInfoMenuActionDefault,
    nowIso: () => new Date().toISOString(),
    formatCommand: (command: string) =>
        formatCommandForInvocation('footnote', command),
    writeStdout: (text: string) => {
        process.stdout.write(text);
    },
};

export const buildCliDependencies = (
    dependencyOverrides: Partial<CliDependencies> = {}
): CliDependencies => {
    const invocationName = resolveInvocationName(process.argv);
    return {
        ...DEFAULT_CLI_DEPENDENCIES,
        formatCommand: (command: string) =>
            formatCommandForInvocation(invocationName, command),
        ...dependencyOverrides,
    };
};
