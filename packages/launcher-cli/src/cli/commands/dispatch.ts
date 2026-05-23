/**
 * @description: Command dispatcher for launcher CLI command-to-handler routing.
 * @footnote-scope: core
 * @footnote-module: LauncherCliCommandDispatch
 * @footnote-risk: high - Misrouted commands can cause incorrect lifecycle operations.
 * @footnote-ethics: low - Explicit dispatch preserves predictable user intent mapping.
 */

import { LauncherError } from '@footnote/launcher-core';
import type { LauncherCommand } from '../../args.js';
import { printHelp } from '../help.js';
import type { CommandContext } from '../types.js';
import { handleLogsCommand } from './logs.js';
import { handleOpenCommand } from './open.js';
import { handleSetupCommand } from './setup.js';
import { handleStartCommand } from './start.js';
import { handleStatusCommand } from './status.js';
import { handleStopCommand } from './stop.js';
import { handleUpdateCommand } from './update.js';

export const executeCommand = async (
    command: LauncherCommand,
    context: CommandContext
): Promise<number> => {
    switch (command) {
        case 'start':
            return handleStartCommand(context, {
                headless: context.parsed.headless,
                tagOverride: context.parsed.tag,
            });
        case 'setup':
            return handleSetupCommand(context, {
                force: context.parsed.setupForce,
            });
        case 'update':
            return handleUpdateCommand(context);
        case 'status':
            return handleStatusCommand(context);
        case 'open':
            return handleOpenCommand(context);
        case 'logs':
            return handleLogsCommand(context, context.parsed.follow);
        case 'stop':
            return handleStopCommand(context);
        case 'help':
            printHelp(context.dependencies);
            return 0;
        case 'info':
            return 0;
        default:
            throw new LauncherError('usage', `Unsupported command: ${command}`);
    }
};
