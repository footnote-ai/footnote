/**
 * @description: Thin launcher CLI composition root for argument parsing, context creation, and top-level dispatch.
 * @footnote-scope: core
 * @footnote-module: LauncherCli
 * @footnote-risk: high - Root routing mistakes can break all launcher command execution.
 * @footnote-ethics: medium - Clear top-level error handling preserves accountable operator feedback.
 */

import path from 'node:path';
import { formatMessage } from '@footnote/launcher-core';
import { printHelp } from './cli/help.js';
import { mapErrorToExitCode } from './cli/errors.js';
import { buildCliDependencies } from './cli/dependencies.js';
import { executeCommand } from './cli/commands/dispatch.js';
import { handleInfoCommand } from './cli/info.js';
import type { CliDependencies, CommandContext } from './cli/types.js';

/**
 * Parses launcher CLI arguments and orchestrates command routing for runtime operations.
 * This function decides command flow and exit semantics, while delegating runtime actions to extracted command modules.
 * @param argv Raw CLI arguments after the executable name.
 * @returns Promise<number> Exit code following launcher contract (0/1/2/3).
 */
export const runCliWithDeps = async (
    argv: readonly string[],
    dependencyOverrides: Partial<CliDependencies> = {}
): Promise<number> => {
    const dependencies = buildCliDependencies(dependencyOverrides);
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
