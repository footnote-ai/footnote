/**
 * @description: Interactive launcher info-menu prompt and static menu definitions.
 * @footnote-scope: utility
 * @footnote-module: LauncherCliMenu
 * @footnote-risk: medium - Menu parsing errors can route operators to unintended actions.
 * @footnote-ethics: low - Clear interactive prompts improve operator control without policy impact.
 */

import { createInterface } from 'node:readline/promises';
import { formatMessage } from '@footnote/launcher-core';
import type { InfoMenuAction } from './types.js';

export const INFO_MENU_ITEMS: ReadonlyArray<{
    action: InfoMenuAction;
    label: string;
}> = [
    { action: 'start', label: 'Start' },
    { action: 'setup', label: 'Setup' },
    { action: 'update', label: 'Update' },
    { action: 'status', label: 'Status' },
    { action: 'open', label: 'Open' },
    { action: 'logs_no_follow', label: 'Logs (no-follow)' },
    { action: 'stop', label: 'Stop' },
    { action: 'help', label: 'Help' },
    { action: 'exit', label: 'Exit' },
];

export const promptInfoMenuActionDefault =
    async (): Promise<InfoMenuAction> => {
        const readline = createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        try {
            while (true) {
                process.stdout.write('\nFootnote Launcher Menu\n');
                for (const [index, item] of INFO_MENU_ITEMS.entries()) {
                    process.stdout.write(`${index + 1}. ${item.label}\n`);
                }
                const answer = (
                    await readline.question('Choose an action: ')
                ).trim();
                const selectedIndex = Number.parseInt(answer, 10);

                if (
                    Number.isInteger(selectedIndex) &&
                    selectedIndex >= 1 &&
                    selectedIndex <= INFO_MENU_ITEMS.length
                ) {
                    return INFO_MENU_ITEMS[selectedIndex - 1].action;
                }

                process.stdout.write(
                    `${formatMessage('warn', `Invalid selection "${answer}". Enter a number from 1-${INFO_MENU_ITEMS.length}.`)}\n`
                );
            }
        } finally {
            readline.close();
        }
    };
