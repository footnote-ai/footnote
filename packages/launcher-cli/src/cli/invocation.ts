/**
 * @description: Invocation label helpers for showing accurate command examples in operator-facing output.
 * @footnote-scope: utility
 * @footnote-module: LauncherCliInvocation
 * @footnote-risk: low - Labeling errors only affect guidance text, not runtime behavior.
 * @footnote-ethics: low - Accurate command hints reduce operator confusion in packaged binaries.
 */

import path from 'node:path';

const isNodeExecutableName = (name: string): boolean =>
    /^node(\.exe)?$/i.test(name);

export const resolveInvocationName = (
    argv: readonly string[] = process.argv
): string => {
    const executablePath = argv[0];
    if (!executablePath) {
        return 'footnote';
    }

    const executableName = path.basename(executablePath);
    if (!executableName || isNodeExecutableName(executableName)) {
        return 'footnote';
    }

    return executableName;
};

export const formatCommandForInvocation = (
    invocationName: string,
    command: string
): string => `${invocationName} ${command}`;
