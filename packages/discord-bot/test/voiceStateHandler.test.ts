/**
 * @description: Verifies voice setup failures reach the call command.
 * @footnote-scope: test
 * @footnote-module: VoiceStateHandlerTests
 * @footnote-risk: medium - Swallowed setup failures can report a call as registered when it did not start.
 * @footnote-ethics: low - Uses a local Discord client without connecting.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from 'discord.js';
import { VoiceStateHandler } from '../src/events/VoiceStateHandler.js';

test('registerInitiatingCall propagates voice subsystem setup failures', async () => {
    const client = new Client({ intents: [] });
    client.guilds.cache.get = () => {
        throw new Error('guild lookup failed');
    };
    const handler = new VoiceStateHandler(client);

    try {
        await assert.rejects(
            handler.registerInitiatingCall(
                'guild-1',
                'user-1',
                'standard',
                false
            ),
            /guild lookup failed/
        );
    } finally {
        client.destroy();
    }
});
