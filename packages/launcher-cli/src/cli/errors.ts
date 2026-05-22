/**
 * @description: Error-to-exit-code mapping for launcher CLI process semantics.
 * @footnote-scope: utility
 * @footnote-module: LauncherCliErrors
 * @footnote-risk: medium - Incorrect mapping can hide usage or environment failures.
 * @footnote-ethics: low - Clear exit status preserves accountable automation behavior.
 */

import { isLauncherError } from '@footnote/launcher-core';

export const mapErrorToExitCode = (error: unknown): number => {
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
