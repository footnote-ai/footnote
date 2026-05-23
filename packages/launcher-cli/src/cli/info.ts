/**
 * @description: Info command orchestration for interactive launcher menu and non-TTY snapshot behavior.
 * @footnote-scope: core
 * @footnote-module: LauncherCliInfoCommand
 * @footnote-risk: medium - Info-flow errors can block discoverability of runtime actions.
 * @footnote-ethics: low - Read-only fallback preserves safe visibility in automation contexts.
 */

import { formatMessage } from '@footnote/launcher-core';
import { printHelp, printReadOnlyInfoSnapshot } from './help.js';
import type { CommandContext } from './types.js';
import { executeCommand } from './commands/dispatch.js';
import { handleLogsCommand } from './commands/logs.js';
import { handleStatusCommand } from './commands/status.js';
import { writeLine } from './writeLine.js';

export const handleInfoCommand = async (
    context: CommandContext
): Promise<number> => {
    const { dependencies, parsed, paths } = context;

    if (!dependencies.isInteractiveTty()) {
        // Fail-open behavior for automation: status errors are downgraded to warnings
        // so read-only info output still prints via printReadOnlyInfoSnapshot.
        try {
            await handleStatusCommand(context);
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : String(error);
            writeLine(context, formatMessage('warn', message));
        }
        printReadOnlyInfoSnapshot(dependencies, context.configRoot);
        return 0;
    }

    while (true) {
        const action = await dependencies.promptInfoMenuAction();

        if (action === 'exit') {
            writeLine(context, formatMessage('info', 'Exiting launcher menu.'));
            return 0;
        }

        if (action === 'help') {
            printHelp(dependencies);
            continue;
        }

        try {
            if (action === 'logs_no_follow') {
                await handleLogsCommand(context, false);
                continue;
            }
            if (action === 'setup') {
                const setupRequiredNow =
                    await dependencies.isSettingsFileMissingFn(
                        paths.settingsFilePath
                    );
                const setupForce =
                    !setupRequiredNow &&
                    (await dependencies.promptSetupForceConfirmation());
                await executeCommand(action, {
                    ...context,
                    parsed: {
                        ...parsed,
                        setupForce,
                    },
                });
                continue;
            }
            await executeCommand(action, context);
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : String(error);
            writeLine(context, formatMessage('error', message));
        }
    }
};
