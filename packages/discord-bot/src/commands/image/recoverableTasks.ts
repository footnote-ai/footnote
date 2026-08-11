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
const DEFAULT_CLAIM_RETRY_DELAYS_MS = [0, 1_000, 3_000] as const;
const DEFAULT_REPLY_RETRY_DELAYS_MS = [0, 1_000, 3_000] as const;

export type RecoveryRetryOptions = {
    claimRetryDelaysMs?: readonly number[];
    replyRetryDelaysMs?: readonly number[];
};

const wait = async (delayMs: number): Promise<void> => {
    if (delayMs <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
};

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
): Promise<boolean> => {
    if (!taskId) return true;
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
        return true;
    } catch (error) {
        logger.warn('Recoverable image task finish failed; continuing.', {
            taskId,
            state,
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
};

const reconcileRecoveredTaskReply = async (
    client: Client,
    task: RecoverableTask
): Promise<'complete' | 'failed'> => {
    const channel = await client.channels.fetch(task.discordChannelId);
    if (!channel?.isTextBased()) {
        throw new Error('Stored channel is not text-based or is unavailable.');
    }
    const message = await channel.messages.fetch(task.discordMessageId);
    if (message.content === INTERRUPTION_MESSAGE) {
        return 'failed';
    }
    if (!isUnfinishedImageReply(message)) {
        return 'complete';
    }
    await message.edit({
        content: INTERRUPTION_MESSAGE,
        embeds: [],
        components: [],
        files: [],
    });
    return 'failed';
};

const claimTasksWithRetry = async (
    retryDelaysMs: readonly number[],
    waitForDelay: (delayMs: number) => Promise<void>
): Promise<RecoverableTask[]> => {
    let lastError: unknown;
    for (const delayMs of retryDelaysMs) {
        await waitForDelay(delayMs);
        try {
            return (
                await botApi.claimRecoverableTasks({
                    botProfileId: runtimeConfig.profile.id,
                })
            ).tasks;
        } catch (error) {
            lastError = error;
            logger.warn('Recoverable image task claim attempt failed.', {
                delayMs,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    throw lastError ?? new Error('Recoverable image task claim failed.');
};

const reconcileTaskWithRetry = async (
    client: Client,
    task: RecoverableTask,
    retryDelaysMs: readonly number[],
    waitForDelay: (delayMs: number) => Promise<void>
): Promise<void> => {
    let lastError: unknown;
    for (const delayMs of retryDelaysMs) {
        await waitForDelay(delayMs);
        try {
            const terminalState = await reconcileRecoveredTaskReply(
                client,
                task
            );
            const persisted = await finishRecoverableImageTask(
                task.id,
                terminalState
            );
            if (!persisted) {
                throw new Error(
                    'Backend did not persist the recovered task state.'
                );
            }
            logger.info('Recovered interrupted image reply.', {
                taskId: task.id,
                botProfileId: task.botProfileId,
                state: terminalState,
            });
            return;
        } catch (error) {
            lastError = error;
            logger.warn('Recoverable image reply attempt failed.', {
                taskId: task.id,
                botProfileId: task.botProfileId,
                delayMs,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    throw lastError ?? new Error('Recoverable image reply failed.');
};

/**
 * Claims stale tasks for this profile and updates each public reply independently.
 * Bounded retries stay fail-open while giving temporary backend and Discord
 * outages time to recover. Unresolved tasks remain reclaimable on later starts.
 */
export const recoverInterruptedImageTasks = async (
    client: Client,
    options: RecoveryRetryOptions = {}
): Promise<void> => {
    const claimRetryDelaysMs =
        options.claimRetryDelaysMs ?? DEFAULT_CLAIM_RETRY_DELAYS_MS;
    const replyRetryDelaysMs =
        options.replyRetryDelaysMs ?? DEFAULT_REPLY_RETRY_DELAYS_MS;
    const waitForDelay = wait;
    let tasks: RecoverableTask[];
    try {
        tasks = await claimTasksWithRetry(claimRetryDelaysMs, waitForDelay);
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
            await reconcileTaskWithRetry(
                client,
                task,
                replyRetryDelaysMs,
                waitForDelay
            );
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
