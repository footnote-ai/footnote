/**
 * @description: Fails open around backend-owned image delivery recovery state.
 * It starts and finishes minimal lifecycle records without making Discord delivery part of the image runtime.
 * @footnote-scope: interface
 * @footnote-module: RecoverableImageTasks
 * @footnote-risk: medium - Recovery bookkeeping must not block an otherwise valid image response.
 * @footnote-ethics: high - Logs and records use only safe task and Discord delivery identifiers, never prompts or image data.
 */
import type { Client, Message } from 'discord.js';
import type { RecoverableTask } from '@footnote/contracts/web';
import { botApi } from '../../api/botApi.js';
import { runtimeConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';

const INTERRUPTION_MESSAGE =
    '⚠️ Image generation was interrupted while the bot restarted. Please run `/image` again.';

const isUnfinishedImageReply = (message: Message): boolean =>
    message.embeds.some((embed) => {
        const footerText = embed.footer?.text ?? '';
        return (
            footerText.includes('Generating…') ||
            footerText.startsWith('Rendering preview ')
        );
    });

/** Starts one recoverable record after the initial public reply is available. */
export const startRecoverableImageTask = async (
    reply: Pick<Message, 'id' | 'channelId'>
): Promise<string | null> => {
    try {
        const response = await botApi.startRecoverableTask({
            kind: 'image_generation',
            botProfileId: runtimeConfig.profile.id,
            discordChannelId: reply.channelId,
            discordMessageId: reply.id,
        });
        logger.info('Started recoverable image task.', {
            taskId: response.task.id,
            botProfileId: response.task.botProfileId,
        });
        return response.task.id;
    } catch (error) {
        logger.warn('Recoverable image task start failed; continuing.', {
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
};

/** Finishes lifecycle state without changing the user-visible error behavior. */
export const finishRecoverableImageTask = async (
    taskId: string | null,
    state: 'complete' | 'failed'
): Promise<void> => {
    if (!taskId) return;
    try {
        const response =
            state === 'complete'
                ? await botApi.completeRecoverableTask(taskId)
                : await botApi.failRecoverableTask(taskId);
        logger.info('Finished recoverable image task.', {
            taskId,
            state,
            changed: response.changed,
        });
    } catch (error) {
        logger.warn('Recoverable image task finish failed; continuing.', {
            taskId,
            state,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};

const editRecoveredTaskReply = async (
    client: Client,
    task: RecoverableTask
): Promise<void> => {
    const channel = await client.channels.fetch(task.discordChannelId);
    if (!channel?.isTextBased()) {
        throw new Error('Stored channel is not text-based or is unavailable.');
    }
    const message = await channel.messages.fetch(task.discordMessageId);
    if (!isUnfinishedImageReply(message)) {
        throw new Error(
            'Stored reply no longer has an unfinished image-generation state.'
        );
    }
    await message.edit({
        content: INTERRUPTION_MESSAGE,
        embeds: [],
        components: [],
        files: [],
    });
};

/** Claims stale tasks for this profile and updates each public reply independently. */
export const recoverInterruptedImageTasks = async (
    client: Client
): Promise<void> => {
    let tasks: RecoverableTask[];
    try {
        tasks = (
            await botApi.claimRecoverableTasks({
                botProfileId: runtimeConfig.profile.id,
            })
        ).tasks;
    } catch (error) {
        logger.warn(
            'Recoverable image task claim failed; continuing startup.',
            {
                error: error instanceof Error ? error.message : String(error),
            }
        );
        return;
    }

    for (const task of tasks) {
        try {
            await editRecoveredTaskReply(client, task);
            logger.info('Recovered interrupted image reply.', {
                taskId: task.id,
                botProfileId: task.botProfileId,
            });
        } catch (error) {
            logger.warn('Could not recover interrupted image reply.', {
                taskId: task.id,
                botProfileId: task.botProfileId,
                discordChannelId: task.discordChannelId,
                discordMessageId: task.discordMessageId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
};

export { INTERRUPTION_MESSAGE };
