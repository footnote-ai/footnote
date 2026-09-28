/**
 * @description: Lets a Discord user explicitly connect, confirm, or inspect their Footnote account.
 * @footnote-scope: interface
 * @footnote-module: AccountCommand
 * @footnote-risk: high - Command identity must remain the authenticated Discord interaction user.
 * @footnote-ethics: high - Private responses limit account-linking disclosure.
 */
import { SlashCommandBuilder } from 'discord.js';
import { botApi } from '../api/botApi.js';
import { logger } from '../utils/logger.js';
import type { Command, SlashCommand } from './BaseCommand.js';

const data = new SlashCommandBuilder()
    .setName('account')
    .setDescription('Connect and check your Footnote account')
    .addSubcommand((command) =>
        command
            .setName('connect')
            .setDescription('Start private account connection')
    )
    .addSubcommand((command) =>
        command
            .setName('status')
            .setDescription('Check your private account connection status')
    )
    .addSubcommand((command) =>
        command
            .setName('confirm')
            .setDescription('Confirm your browser-approved connection')
            .addStringOption((option) =>
                option
                    .setName('code')
                    .setDescription('Eight-digit confirmation code')
                    .setMinLength(8)
                    .setMaxLength(8)
                    .setRequired(true)
            )
    );

const command: Command = {
    data: data as SlashCommand,
    execute: async (interaction): Promise<void> => {
        await interaction.deferReply({ ephemeral: true });
        try {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === 'connect') {
                const result = await botApi.startDiscordAccountConnection({
                    discordUserId: interaction.user.id,
                });
                await interaction.editReply(
                    `Open this private, short-lived link to sign in and approve: ${result.connectionUrl}`
                );
            } else if (subcommand === 'status') {
                const result = await botApi.getDiscordAccountStatus({
                    discordUserId: interaction.user.id,
                });
                await interaction.editReply(
                    result.connected
                        ? 'Your Discord account is connected to a Footnote account.'
                        : 'Your Discord account is not connected. Run `/account connect` to begin.'
                );
            } else {
                const code = interaction.options.getString('code', true);
                const result = await botApi.confirmDiscordAccountConnection({
                    discordUserId: interaction.user.id,
                    code,
                });
                const messages = {
                    linked: 'Your Discord account is now connected.',
                    'already-linked':
                        'Your Discord account was already connected to this Footnote account.',
                    conflict:
                        'This Discord account is already connected elsewhere. Nothing was changed.',
                    'wrong-code':
                        'That confirmation code is incorrect. Try again.',
                    'attempts-exhausted':
                        'Too many incorrect codes. Start again with `/account connect`.',
                    invalid:
                        'This confirmation has expired or is unavailable. Start again with `/account connect`.',
                    unavailable:
                        'Account connection is temporarily unavailable. Please try again later.',
                } as const;
                await interaction.editReply(messages[result.result]);
            }
        } catch {
            logger.warn('Discord account command failed.');
            await interaction.editReply(
                'Account connection is unavailable. Public chat remains available. Please try again later.'
            );
        }
    },
};

export default command;
