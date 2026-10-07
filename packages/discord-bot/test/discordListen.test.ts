/**
 * @description: Verifies on-demand Discord Listen uses the delivered text and fails open to the original reply.
 * @footnote-scope: test
 * @footnote-module: DiscordListenTests
 * @footnote-risk: low - Covers one response action and its backend transport seam.
 * @footnote-ethics: medium - Confirms speech failures do not replace or alter the text response.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ButtonInteraction } from 'discord.js';
import { botApi } from '../src/api/botApi.js';
import { handleProvenanceButtonInteraction } from '../src/interactions/button/provenanceButtons.js';

type InteractionHarness = {
    customId: string;
    channelId: string;
    guildId: string;
    message: {
        content: string;
        edit: (payload: unknown) => Promise<void>;
        channel: { isTextBased: () => boolean };
    };
    deferReply: (payload: unknown) => Promise<void>;
    editReply: (payload: unknown) => Promise<void>;
};

const createInteraction = (
    responseId: string,
    content: string,
    replies: unknown[],
    messageEdits: unknown[]
): InteractionHarness => ({
    customId: `listen:${responseId}`,
    channelId: 'channel-1',
    guildId: 'guild-1',
    message: {
        content,
        edit: async (payload) => {
            messageEdits.push(payload);
        },
        channel: { isTextBased: () => true },
    },
    deferReply: async () => undefined,
    editReply: async (payload) => {
        replies.push(payload);
    },
});

test('Listen sends the exact delivered text through backend TTS once', async () => {
    const originalRunTts = botApi.runVoiceTtsViaApi;
    let ttsCalls = 0;
    let requestText = '';
    const replies: unknown[] = [];
    const messageEdits: unknown[] = [];
    botApi.runVoiceTtsViaApi = (async (request) => {
        ttsCalls += 1;
        requestText = request.text;
        return {
            task: 'synthesize',
            result: {
                audioBase64: Buffer.from('speech').toString('base64'),
                outputFormat: 'mp3',
                mimeType: 'audio/mpeg',
                model: 'speech-model',
                voice: 'alloy',
                speechSelection: {},
                usage: {
                    billingUnit: 'characters',
                    inputQuantity: request.text.length,
                    inputCharacters: request.text.length,
                },
                costs: {
                    input: 0,
                    output: 0,
                    total: 0,
                    completeness: 'unknown',
                    incompleteReasons: ['unpriced_model'],
                },
                generationTimeMs: 10,
            },
        };
    }) as typeof botApi.runVoiceTtsViaApi;

    try {
        const deliveredText = 'Exact delivered answer.\nSecond line.';
        const first = createInteraction(
            'listen_exact_001',
            deliveredText,
            replies,
            messageEdits
        );
        await handleProvenanceButtonInteraction(
            first as unknown as ButtonInteraction
        );
        const second = createInteraction(
            'listen_exact_001',
            deliveredText,
            replies,
            messageEdits
        );
        await handleProvenanceButtonInteraction(
            second as unknown as ButtonInteraction
        );

        assert.equal(ttsCalls, 1);
        assert.equal(requestText, deliveredText);
        assert.equal(replies.length, 2);
        assert.equal(
            (replies[0] as { files: Array<{ name: string }> }).files[0]?.name,
            'listen.mp3'
        );
        assert.match(
            (replies[1] as { content: string }).content,
            /already been synthesized/
        );
        assert.equal(messageEdits.length, 1);
    } finally {
        botApi.runVoiceTtsViaApi = originalRunTts;
    }
});

test('Listen synthesis failure leaves the original text response available', async () => {
    const originalRunTts = botApi.runVoiceTtsViaApi;
    const replies: unknown[] = [];
    botApi.runVoiceTtsViaApi = (async () => {
        throw new Error('provider unavailable');
    }) as typeof botApi.runVoiceTtsViaApi;

    try {
        const interaction = createInteraction(
            'listen_failure_001',
            'Original text still here.',
            replies,
            []
        );
        await handleProvenanceButtonInteraction(
            interaction as unknown as ButtonInteraction
        );
        assert.equal(interaction.message.content, 'Original text still here.');
        assert.match(
            (replies[0] as { content: string }).content,
            /text response is unchanged/
        );
    } finally {
        botApi.runVoiceTtsViaApi = originalRunTts;
    }
});
