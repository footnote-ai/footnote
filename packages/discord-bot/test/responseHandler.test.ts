/**
 * @description: Verifies optional Discord attachments fail open without resending earlier chunks.
 * @footnote-scope: test
 * @footnote-module: ResponseHandlerTests
 * @footnote-risk: medium - Delivery regressions can turn optional provenance images into lost answers.
 * @footnote-ethics: medium - Fail-open behavior preserves truthful user feedback when rendering assets fail.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type {
    Message,
    MessageCreateOptions,
    TextBasedChannel,
    User,
} from 'discord.js';
import { ResponseHandler } from '../src/utils/response/ResponseHandler.js';

test('sendMessage retries only the failed final attachment chunk without files', async () => {
    const calls: MessageCreateOptions[] = [];
    let attempt = 0;
    const channel = {
        id: 'channel-response-handler',
        isSendable: () => true,
        send: async (options: MessageCreateOptions) => {
            calls.push({
                ...options,
                files: options.files ? [...options.files] : undefined,
            });
            attempt += 1;
            if (attempt === 1) {
                throw new Error('attachment upload failed');
            }
            return { id: 'sent-without-attachment' };
        },
    } as unknown as TextBasedChannel;
    const handler = new ResponseHandler(
        { id: 'source-message' } as unknown as Message,
        channel,
        { id: 'user-response-handler' } as unknown as User
    );

    await handler.sendMessage(
        'answer body',
        [{ filename: 'trace-card.png', data: Buffer.from('png') }],
        true,
        true,
        [{ type: 1, components: [] }]
    );

    assert.equal(calls.length, 2);
    assert.ok(calls[0].files);
    assert.equal(calls[1].files, undefined);
    assert.equal(calls[1].content, 'answer body');
    assert.deepEqual(calls[1].components, [{ type: 1, components: [] }]);
    assert.deepEqual(calls[1].reply, {
        messageReference: 'source-message',
        failIfNotExists: false,
    });
});
