#!/usr/bin/env node
/* eslint-env node */

/**
 * @description: Shared synchronous command runner for script orchestration with Windows batch compatibility.
 * @footnote-scope: utility
 * @footnote-module: ScriptCommandRunner
 * @footnote-risk: medium - Command launch behavior affects all setup/start scripts and failure handling.
 * @footnote-ethics: low - Local developer execution helper with no direct user-facing decisions.
 */
const { spawnSync } = require('node:child_process');

const isWindows = process.platform === 'win32';

const escapeForCmdExe = (value) => {
    const stringValue = String(value);
    const escapedQuotes = stringValue.replace(/(\\*)"/g, '$1$1\\"');
    const escapedTrailingBackslashes = escapedQuotes.replace(/(\\+)$/g, '$1$1');
    return `"${escapedTrailingBackslashes}"`;
};

const runCommand = (command, args = [], options = {}) => {
    const normalizedCommand = String(command).toLowerCase();
    const isWindowsBatchCommand =
        isWindows &&
        (normalizedCommand.endsWith('.cmd') ||
            normalizedCommand.endsWith('.bat'));

    // Windows batch files need `cmd.exe` for reliable spawn behavior.
    const executable = isWindowsBatchCommand ? 'cmd.exe' : command;
    const executableArgs = isWindowsBatchCommand
        ? [
              '/d',
              '/s',
              '/c',
              escapeForCmdExe(command),
              ...args.map(escapeForCmdExe),
          ]
        : args;

    const spawnOptions = {
        cwd: options.cwd,
        env: options.env,
        stdio: options.stdio ?? 'inherit',
    };

    if (options.encoding) {
        spawnOptions.encoding = options.encoding;
    }

    if (isWindowsBatchCommand) {
        spawnOptions.windowsVerbatimArguments = true;
    }

    return spawnSync(executable, executableArgs, spawnOptions);
};

module.exports = {
    runCommand,
};
