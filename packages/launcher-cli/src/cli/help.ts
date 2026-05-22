/**
 * @description: User-facing launcher help and non-interactive info snapshot output.
 * @footnote-scope: utility
 * @footnote-module: LauncherCliHelp
 * @footnote-risk: low - Copy drift can confuse operators but does not mutate runtime state.
 * @footnote-ethics: low - Actionable help text supports transparent user control.
 */

import { formatMessage } from '@footnote/launcher-core';
import type { CliDependencies, CommandContext } from './types.js';
import { writeLine } from './writeLine.js';

export const printHelp = (dependencies: CliDependencies): void => {
    const launcherCommand = dependencies.formatCommand('<command> [options]');
    const infoCommand = dependencies.formatCommand('info');
    const lines = [
        launcherCommand,
        `No command defaults to: ${infoCommand}`,
        '',
        'Commands:',
        '  info    Show launcher info and interactive menu in TTY mode',
        '  start   Start Footnote using Docker + GHCR image',
        '  setup   Open first-setup link when footnote.yaml is missing',
        '  update  Restart launcher-managed runtime with persisted/default tag',
        '  stop    Stop/remove launcher-managed container',
        '  status  Show runtime status without bootstrapping config files',
        '  open    Open the running launcher-managed URL if live',
        '  logs    Stream logs from launcher-managed container',
        '',
        'Options:',
        '  --config-dir <path>  Override launcher config root',
        '  --tag <imageTag>     Start with a specific GHCR tag and persist it',
        '  --headless           Do not auto-open browser on start',
        '  --no-follow          For logs, print current logs and exit',
    ];
    dependencies.writeStdout(`${lines.join('\n')}\n`);
};

export const printReadOnlyInfoSnapshot = (
    dependencies: CliDependencies,
    configRoot: string
): void => {
    const infoCommand = dependencies.formatCommand('info');
    const actions = [
        dependencies.formatCommand('start'),
        dependencies.formatCommand('setup'),
        dependencies.formatCommand('update'),
        dependencies.formatCommand('status'),
        dependencies.formatCommand('open'),
        dependencies.formatCommand('logs --no-follow'),
        dependencies.formatCommand('stop'),
    ].join(' | ');

    writeLine(
        { dependencies } as CommandContext,
        formatMessage(
            'info',
            'Read-only launcher snapshot (non-interactive mode).'
        )
    );
    writeLine(
        { dependencies } as CommandContext,
        formatMessage(
            'info',
            `Use \`${infoCommand}\` in a terminal for the interactive menu.`
        )
    );
    writeLine(
        { dependencies } as CommandContext,
        formatMessage('info', `configRoot: ${configRoot}`)
    );
    writeLine(
        { dependencies } as CommandContext,
        formatMessage('info', `Actions: ${actions}`)
    );
};
