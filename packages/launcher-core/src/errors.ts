/**
 * @description: Shared launcher error categories for deterministic exit-code mapping.
 * @footnote-scope: core
 * @footnote-module: LauncherError
 * @footnote-risk: medium - Misclassified failures can produce misleading remediation guidance.
 * @footnote-ethics: low - Clear failure categories improve operator comprehension and control.
 */

export type LauncherErrorKind = 'usage' | 'environment' | 'runtime';

export class LauncherError extends Error {
    public readonly kind: LauncherErrorKind;

    public constructor(
        kind: LauncherErrorKind,
        message: string,
        cause?: unknown
    ) {
        super(message);
        this.name = 'LauncherError';
        this.kind = kind;
        if (cause !== undefined) {
            this.cause = cause;
        }
    }
}

export const isLauncherError = (value: unknown): value is LauncherError =>
    value instanceof LauncherError;
