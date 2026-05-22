/**
 * @description: Shared launcher CLI line writer helper for consistent stdout output.
 * @footnote-scope: utility
 * @footnote-module: LauncherCliWriteLine
 * @footnote-risk: low - Output helper changes only affect display formatting.
 * @footnote-ethics: low - Consistent output improves operator clarity.
 */

import type { CommandContext } from './types.js';

export const writeLine = (context: CommandContext, line: string): void => {
    context.dependencies.writeStdout(`${line}\n`);
};
