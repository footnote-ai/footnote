/**
 * @description: Verifies invite creation and Discord follow-up failures stay distinct.
 * @footnote-scope: test
 * @footnote-module: CallVoiceInviteTest
 * @footnote-risk: low - Covers the invite notification path without joining voice.
 * @footnote-ethics: low - Uses synthetic invite data and errors.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatInputCommandInteraction, VoiceChannel } from 'discord.js';

import { sendVoiceChannelInvite } from '../src/commands/call.js';

test('a failed invite follow-up is not treated as invite creation failure', async () => {
    const sentMessages: string[] = [];
    const voiceChannel = {
        createInvite: async () => ({ url: 'https://discord.gg/test' }),
    } as unknown as Pick<VoiceChannel, 'createInvite'>;
    const interaction = {
        followUp: async (payload: { content: string }) => {
            sentMessages.push(payload.content);
            throw new Error('follow-up unavailable');
        },
    } as unknown as Pick<ChatInputCommandInteraction, 'followUp'>;

    await assert.doesNotReject(
        sendVoiceChannelInvite(voiceChannel, interaction)
    );
    assert.deepEqual(sentMessages, [
        'Join the call by clicking this link: https://discord.gg/test',
    ]);
});

test('a failed invite creation handles a rejected failure follow-up', async () => {
    const sentMessages: string[] = [];
    const voiceChannel = {
        createInvite: async () => {
            throw new Error('invite unavailable');
        },
    } as unknown as Pick<VoiceChannel, 'createInvite'>;
    const interaction = {
        followUp: async (payload: { content: string }) => {
            sentMessages.push(payload.content);
            throw new Error('failure follow-up unavailable');
        },
    } as unknown as Pick<ChatInputCommandInteraction, 'followUp'>;

    await assert.doesNotReject(
        sendVoiceChannelInvite(voiceChannel, interaction)
    );
    assert.deepEqual(sentMessages, [
        'Failed to create invite: Error: invite unavailable',
    ]);
});
