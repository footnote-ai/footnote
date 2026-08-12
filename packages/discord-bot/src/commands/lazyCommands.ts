/**
 * @description: Keeps slash-command schemas resident while loading command implementation modules on first use.
 * @footnote-scope: interface
 * @footnote-module: LazyCommands
 * @footnote-risk: medium - Incorrect routing can make a command unavailable, but failed imports remain retryable.
 * @footnote-ethics: low - This is a performance boundary and does not change command authority or policy.
 */

import { Collection } from 'discord.js';
import definitions from './commandDefinitions.json' with { type: 'json' };
import type { ChatInputCommandInteraction } from 'discord.js';
import type {
    Command,
    SlashCommand,
    StaticSlashCommand,
} from './BaseCommand.js';
import { createLoadOnce } from '../utils/loadOnce.js';

type LoadedCommandModule = { default: Command };
type CommandDefinition = {
    name: string;
    description: string;
    [key: string]: unknown;
};

const commandModuleLoaders: Record<string, () => Promise<LoadedCommandModule>> =
    {
        chat: () => import('./chat.js'),
        image: () => import('./image.js'),
        call: () => import('./call.js'),
        help: () => import('./help.js'),
        incident: () => import('./incident.js'),
        news: () => import('./news.js'),
        ping: () => import('./ping.js'),
        'trace-preview': () => import('./trace-preview.js'),
    };

const asSlashCommand = (definition: CommandDefinition): SlashCommand =>
    ({
        name: definition.name,
        description: definition.description,
        toJSON: () => definition as ReturnType<SlashCommand['toJSON']>,
    }) satisfies StaticSlashCommand;

/** Builds the eager command registry without importing execution code. */
export const createLazyCommandCatalog = (): Collection<string, Command> => {
    const commands = new Collection<string, Command>();

    for (const [name, definition] of Object.entries(definitions)) {
        const loadModule = commandModuleLoaders[name];
        if (!loadModule) {
            continue;
        }
        const loadCommand = createLoadOnce(loadModule);
        const command: Command = {
            data: asSlashCommand(definition as CommandDefinition),
            execute: async (
                interaction: ChatInputCommandInteraction
            ): Promise<void> => {
                const module = await loadCommand();
                await module.default.execute(interaction);
            },
        };
        commands.set(name, command);
    }

    return commands;
};
