/**
 * @description: Verifies Discord image lifecycle completion, failure, and startup reconciliation.
 * @footnote-scope: test
 * @footnote-module: RecoverableImageTaskTests
 * @footnote-risk: medium - Missing coverage could overwrite completed replies or leave interrupted work unclear.
 * @footnote-ethics: high - Confirms recovery remains fail-open and never reruns provider work.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { RecoverableTask } from '@footnote/contracts/web';
import type { Client, RepliableInteraction } from 'discord.js';
import { botApi } from '../src/api/botApi.js';
import { runImageGenerationSession } from '../src/commands/image.js';
import {
    INTERRUPTION_MESSAGE,
    finishRecoverableImageTask,
    recoverInterruptedImageTasks,
    startRecoverableImageTask,
} from '../src/commands/image/recoverableTasks.js';
import type { ImageGenerationContext } from '../src/commands/image/retryCache.js';
import { runtimeConfig } from '../src/config.js';

const createTask = (id: string, messageId: string): RecoverableTask => ({
    id,
    kind: 'image_generation',
    state: 'failed',
    botProfileId: runtimeConfig.profile.id,
    discordChannelId: 'channel-1',
    discordMessageId: messageId,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:01.000Z',
});

type TestMessage = {
    content: string;
    embeds: Array<{ footer?: { text?: string } }>;
    edit: (payload: unknown) => Promise<unknown>;
};

const createContext = (): ImageGenerationContext => ({
    prompt: 'draw a reflective skyline',
    originalPrompt: 'draw a reflective skyline',
    refinedPrompt: null,
    promptPolicyMaxInputChars: 8000,
    promptPolicyTruncated: false,
    textModel: 'gpt-5-mini',
    imageModel: 'gpt-image-1-mini',
    size: '1024x1024',
    aspectRatio: 'square',
    aspectRatioLabel: 'Square',
    quality: 'medium',
    background: 'auto',
    style: 'vivid',
    allowPromptAdjustment: true,
    outputFormat: 'png',
    outputCompression: 100,
});

const createInteraction = () => {
    const edits: unknown[] = [];
    const followUps: unknown[] = [];
    const interaction = {
        deferred: true,
        replied: false,
        user: {
            id: 'user-1',
            username: 'Jordan',
            displayName: 'Jordan',
        },
        member: null,
        guild: { name: 'Footnote Lab' },
        guildId: 'guild-1',
        channelId: 'channel-1',
        type: 2,
        deferReply: async () => undefined,
        editReply: async (payload: unknown) => {
            edits.push(payload);
            return {
                id: 'message-1',
                channelId: 'channel-1',
            };
        },
        followUp: async (payload: unknown) => {
            followUps.push(payload);
            return {};
        },
    } as unknown as RepliableInteraction;
    return { interaction, edits, followUps };
};

test('image lifecycle helpers fail open while sending minimal task metadata', async () => {
    const originalStart = botApi.startRecoverableTask;
    const originalComplete = botApi.completeRecoverableTask;
    let startedBody: unknown;
    let completedId = '';
    botApi.startRecoverableTask = (async (body) => {
        startedBody = body;
        return {
            task: { ...createTask('task-1', 'message-1'), state: 'started' },
        };
    }) as typeof botApi.startRecoverableTask;
    botApi.completeRecoverableTask = (async (taskId) => {
        completedId = taskId;
        return {
            task: { ...createTask(taskId, 'message-1'), state: 'complete' },
            changed: true,
        };
    }) as typeof botApi.completeRecoverableTask;

    try {
        const taskId = await startRecoverableImageTask({
            id: 'message-1',
            channelId: 'channel-1',
        });
        await finishRecoverableImageTask(taskId, 'complete');
        assert.deepEqual(startedBody, {
            kind: 'image_generation',
            botProfileId: runtimeConfig.profile.id,
            discordChannelId: 'channel-1',
            discordMessageId: 'message-1',
        });
        assert.equal(completedId, 'task-1');

        botApi.startRecoverableTask = (async () => {
            throw new Error('backend unavailable');
        }) as typeof botApi.startRecoverableTask;
        assert.equal(
            await startRecoverableImageTask({
                id: 'message-2',
                channelId: 'channel-1',
            }),
            null
        );

        let completionCalls = 0;
        botApi.completeRecoverableTask = (async () => {
            completionCalls += 1;
            throw new Error('backend unavailable');
        }) as typeof botApi.completeRecoverableTask;
        await finishRecoverableImageTask('task-2', 'complete');
        await finishRecoverableImageTask(null, 'complete');
        assert.equal(completionCalls, 1);
    } finally {
        botApi.startRecoverableTask = originalStart;
        botApi.completeRecoverableTask = originalComplete;
    }
});

test('startup recovery edits unfinished replies independently and preserves completed replies', async () => {
    const originalClaim = botApi.claimRecoverableTasks;
    const originalComplete = botApi.completeRecoverableTask;
    const originalFail = botApi.failRecoverableTask;
    const edited: Array<{ id: string; payload: unknown }> = [];
    const terminalStates: string[] = [];
    botApi.claimRecoverableTasks = (async () => ({
        tasks: [
            { ...createTask('task-missing', 'missing'), state: 'recovering' },
            { ...createTask('task-complete', 'complete'), state: 'recovering' },
            { ...createTask('task-active', 'active'), state: 'recovering' },
        ],
    })) as typeof botApi.claimRecoverableTasks;
    botApi.completeRecoverableTask = (async (taskId) => {
        terminalStates.push(`complete:${taskId}`);
        return {
            task: { ...createTask(taskId, 'complete'), state: 'complete' },
            changed: true,
        };
    }) as typeof botApi.completeRecoverableTask;
    botApi.failRecoverableTask = (async (taskId) => {
        terminalStates.push(`failed:${taskId}`);
        return {
            task: createTask(taskId, 'active'),
            changed: true,
        };
    }) as typeof botApi.failRecoverableTask;
    const messages = new Map<string, TestMessage>();
    messages.set('complete', {
        content: 'Finished image',
        embeds: [{ footer: { text: 'Complete • $0.01' } }],
        edit: async (payload: unknown) => {
            edited.push({ id: 'complete', payload });
            return {};
        },
    });
    messages.set('active', {
        content: '',
        embeds: [{ footer: { text: 'Generating…' } }],
        edit: async (payload: unknown) => {
            edited.push({ id: 'active', payload });
            return {};
        },
    });
    const client = {
        channels: {
            fetch: async () => ({
                isTextBased: () => true,
                messages: {
                    fetch: async (messageId: string) => {
                        if (messageId === 'missing') {
                            throw new Error('message unavailable');
                        }
                        return messages.get(messageId);
                    },
                },
            }),
        },
    } as unknown as Client;

    try {
        await recoverInterruptedImageTasks(client, {
            claimRetryDelaysMs: [0],
            replyRetryDelaysMs: [0],
        });
        assert.equal(edited.length, 1);
        assert.equal(edited[0].id, 'active');
        assert.deepEqual(edited[0].payload, {
            content: INTERRUPTION_MESSAGE,
            embeds: [],
            components: [],
            files: [],
            attachments: [],
        });
        assert.deepEqual(terminalStates, [
            'complete:task-complete',
            'failed:task-active',
        ]);
    } finally {
        botApi.claimRecoverableTasks = originalClaim;
        botApi.completeRecoverableTask = originalComplete;
        botApi.failRecoverableTask = originalFail;
    }
});

test('startup recovery retries temporary claim and Discord failures', async () => {
    const originalClaim = botApi.claimRecoverableTasks;
    const originalFail = botApi.failRecoverableTask;
    let claimCalls = 0;
    let fetchCalls = 0;
    let finishCalls = 0;
    botApi.claimRecoverableTasks = (async () => {
        claimCalls += 1;
        if (claimCalls === 1) {
            throw new Error('backend starting');
        }
        return {
            tasks: [
                {
                    ...createTask('task-retry', 'message-retry'),
                    state: 'recovering',
                },
            ],
        };
    }) as typeof botApi.claimRecoverableTasks;
    botApi.failRecoverableTask = (async (taskId) => {
        finishCalls += 1;
        return { task: createTask(taskId, 'message-retry'), changed: true };
    }) as typeof botApi.failRecoverableTask;
    const message: TestMessage = {
        content: '',
        embeds: [{ footer: { text: 'Generating…' } }],
        edit: async () => ({}),
    };
    const client = {
        channels: {
            fetch: async () => ({
                isTextBased: () => true,
                messages: {
                    fetch: async () => {
                        fetchCalls += 1;
                        if (fetchCalls === 1) {
                            throw new Error('Discord temporarily unavailable');
                        }
                        return message;
                    },
                },
            }),
        },
    } as unknown as Client;

    try {
        await recoverInterruptedImageTasks(client, {
            claimRetryDelaysMs: [0, 0],
            replyRetryDelaysMs: [0, 0],
        });
        assert.equal(claimCalls, 2);
        assert.equal(fetchCalls, 2);
        assert.equal(finishCalls, 1);
    } finally {
        botApi.claimRecoverableTasks = originalClaim;
        botApi.failRecoverableTask = originalFail;
    }
});

test('image sessions complete recovery state only after final Discord delivery', async () => {
    const originals = {
        start: botApi.startRecoverableTask,
        complete: botApi.completeRecoverableTask,
        fail: botApi.failRecoverableTask,
        stream: botApi.runImageTaskStreamViaApi,
    };
    const terminalStates: string[] = [];
    botApi.startRecoverableTask = (async () => ({
        task: { ...createTask('task-1', 'message-1'), state: 'started' },
    })) as typeof botApi.startRecoverableTask;
    botApi.completeRecoverableTask = (async (taskId) => {
        terminalStates.push(`complete:${taskId}`);
        return {
            task: { ...createTask(taskId, 'message-1'), state: 'complete' },
            changed: true,
        };
    }) as typeof botApi.completeRecoverableTask;
    botApi.failRecoverableTask = (async (taskId) => {
        terminalStates.push(`failed:${taskId}`);
        return { task: createTask(taskId, 'message-1'), changed: true };
    }) as typeof botApi.failRecoverableTask;
    botApi.runImageTaskStreamViaApi = (async () => ({
        task: 'generate',
        result: {
            responseId: 'resp-1',
            textModel: 'gpt-5-mini',
            imageModel: 'gpt-image-1-mini',
            revisedPrompt: null,
            finalStyle: 'vivid',
            annotations: {
                title: 'Skyline',
                description: null,
                note: null,
                adjustedPrompt: null,
            },
            finalImageBase64: 'aGVsbG8=',
            outputFormat: 'png',
            outputCompression: 100,
            usage: {
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
                imageCount: 1,
                partialImageCount: 0,
            },
            costs: { text: 0, image: 0.01, total: 0.01, perImage: 0.01 },
            generationTimeMs: 10,
        },
    })) as typeof botApi.runImageTaskStreamViaApi;

    try {
        const successInteraction = createInteraction();
        const success = await runImageGenerationSession(
            successInteraction.interaction,
            createContext()
        );
        assert.deepEqual(success, { success: true, responseId: 'resp-1' });
        assert.deepEqual(terminalStates, ['complete:task-1']);
        assert.equal(successInteraction.edits.length >= 2, true);

        botApi.runImageTaskStreamViaApi = (async () => {
            throw new Error('broken stream');
        }) as typeof botApi.runImageTaskStreamViaApi;
        const failureInteraction = createInteraction();
        const failure = await runImageGenerationSession(
            failureInteraction.interaction,
            createContext()
        );
        assert.deepEqual(failure, { success: false, responseId: null });
        assert.deepEqual(terminalStates, ['complete:task-1', 'failed:task-1']);
        assert.equal(failureInteraction.followUps.length, 0);
    } finally {
        botApi.startRecoverableTask = originals.start;
        botApi.completeRecoverableTask = originals.complete;
        botApi.failRecoverableTask = originals.fail;
        botApi.runImageTaskStreamViaApi = originals.stream;
    }
});
