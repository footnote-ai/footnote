/**
 * @description: Lightweight command-line parser for the standalone footnote launcher CLI.
 * @footnote-scope: core
 * @footnote-module: LauncherCliArgs
 * @footnote-risk: medium - Parse errors can route commands incorrectly or hide invalid usage.
 * @footnote-ethics: low - Explicit argument handling helps users understand launcher control paths.
 */

import { LauncherError } from '@footnote/launcher-core';

export type LauncherCommand =
    | 'start'
    | 'stop'
    | 'status'
    | 'open'
    | 'setup'
    | 'logs'
    | 'help';

export type LauncherArgs = {
    command: LauncherCommand;
    configDir?: string;
    headless: boolean;
    tag?: string;
    follow: boolean;
};

const expectValue = (
    argv: readonly string[],
    index: number,
    flag: string
): string => {
    const value = argv[index + 1];
    if (!value || value.startsWith('-')) {
        throw new LauncherError('usage', `Missing value for ${flag}.`);
    }
    return value;
};

export const parseLauncherArgs = (argv: readonly string[]): LauncherArgs => {
    if (argv.length === 0) {
        return {
            command: 'start',
            headless: false,
            follow: true,
        };
    }

    const first = argv[0];
    if (first === '--help' || first === '-h' || first === 'help') {
        return {
            command: 'help',
            headless: false,
            follow: true,
        };
    }

    if (
        first !== 'start' &&
        first !== 'stop' &&
        first !== 'status' &&
        first !== 'open' &&
        first !== 'setup' &&
        first !== 'logs'
    ) {
        throw new LauncherError('usage', `Unknown command "${first}".`);
    }

    const args: LauncherArgs = {
        command: first,
        headless: false,
        follow: true,
    };

    for (let index = 1; index < argv.length; index += 1) {
        const token = argv[index];
        switch (token) {
            case '--help':
            case '-h':
                args.command = 'help';
                return args;
            case '--headless':
                if (args.command !== 'start') {
                    throw new LauncherError(
                        'usage',
                        '--headless is only supported for footnote start.'
                    );
                }
                args.headless = true;
                break;
            case '--tag':
                if (args.command !== 'start') {
                    throw new LauncherError(
                        'usage',
                        '--tag is only supported for footnote start.'
                    );
                }
                args.tag = expectValue(argv, index, token);
                index += 1;
                break;
            case '--config-dir':
                args.configDir = expectValue(argv, index, token);
                index += 1;
                break;
            case '--follow':
                if (args.command !== 'logs') {
                    throw new LauncherError(
                        'usage',
                        '--follow is only supported for footnote logs.'
                    );
                }
                args.follow = true;
                break;
            case '--no-follow':
                if (args.command !== 'logs') {
                    throw new LauncherError(
                        'usage',
                        '--no-follow is only supported for footnote logs.'
                    );
                }
                args.follow = false;
                break;
            default:
                throw new LauncherError('usage', `Unknown option "${token}".`);
        }
    }

    return args;
};
