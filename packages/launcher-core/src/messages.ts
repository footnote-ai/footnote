/**
 * @description: Minimal message formatting helpers for consistent CLI output tone.
 * @footnote-scope: utility
 * @footnote-module: LauncherMessages
 * @footnote-risk: low - Formatting issues affect operator clarity but not runtime execution.
 * @footnote-ethics: low - Clear, actionable messages support transparent operation.
 */

export type MessageTone = 'info' | 'success' | 'warn' | 'error';

const TONE_PREFIX: Readonly<Record<MessageTone, string>> = {
    info: '[info]',
    success: '[ok]',
    warn: '[warn]',
    error: '[error]',
};

export const formatMessage = (tone: MessageTone, message: string): string =>
    `${TONE_PREFIX[tone]} ${message}`;

export const formatSteps = (
    header: string,
    steps: readonly string[]
): string => {
    const numbered = steps.map((step, index) => `${index + 1}. ${step}`);
    return [header, ...numbered].join('\n');
};
