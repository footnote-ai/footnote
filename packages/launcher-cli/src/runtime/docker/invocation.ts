/**
 * @description: Invocation-label helpers for Docker runtime diagnostic command hints.
 * @footnote-scope: utility
 * @footnote-module: LauncherDockerInvocation
 * @footnote-risk: low - Labeling errors only affect guidance text and not lifecycle behavior.
 * @footnote-ethics: low - Accurate invocation hints reduce operator confusion.
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

export const formatCommand = (command: string): string =>
    `${resolveInvocationName(process.argv)} ${command}`;
