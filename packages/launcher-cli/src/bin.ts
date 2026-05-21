#!/usr/bin/env node
/**
 * @description: Executable entrypoint for the standalone footnote launcher binary and npm bin.
 * @footnote-scope: core
 * @footnote-module: LauncherCliBin
 * @footnote-risk: medium - Entrypoint failures block all launcher command execution.
 * @footnote-ethics: low - Entrypoint delegates to typed command handling and explicit diagnostics.
 */

import { runCliWithExitCode } from './cli.js';

void runCliWithExitCode(process.argv.slice(2));
