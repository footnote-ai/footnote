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
import { handleButtonInteraction } from '../src/interactions/buttonHandlers.js';

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
    messageEdits: unknown[],
    deferredReplies: unknown[] = []
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
    deferReply: async (payload) => {
        deferredReplies.push(payload);
    },
    editReply: async (payload) => {
        replies.push(payload);
    },
});

const createTtsResponse = (
    text: string
): Awaited<ReturnType<typeof botApi.runVoiceTtsViaApi>> => ({
    task: 'synthesize',
    result: {
        audioBase64: Buffer.from('speech').toString('base64'),
        outputFormat: 'mp3',
        mimeType: 'audio/mpeg',
        model: 'speech-model',
        voice: 'alloy',
        speechSelection: {
            profileId: 'test-profile',
            modality: 'tts',
            provider: 'test-provider',
            model: 'speech-model',
            voice: 'alloy',
            delivery: null,
            requestedVoice: null,
            selectionSource: {
                model: 'deployment_fallback',
                voice: 'deployment_fallback',
                delivery: 'deployment_fallback',
            },
            fallbackReason: null,
        },
        usage: {
            billingUnit: 'characters',
            inputQuantity: text.length,
            inputCharacters: text.length,
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
});

test('Listen routes an eligible short stored response through backend TTS once', async () => {
    const originalRunTts = botApi.runVoiceTtsViaApi;
    let ttsCalls = 0;
    let requestText = '';
    const replies: unknown[] = [];
    const messageEdits: unknown[] = [];
    const deferredReplies: unknown[] = [];
    botApi.runVoiceTtsViaApi = (async (request) => {
        ttsCalls += 1;
        requestText = request.text;
        return createTtsResponse(request.text);
    }) as typeof botApi.runVoiceTtsViaApi;

    try {
        const deliveredText = 'Exact delivered answer.\nSecond line.';
        const first = createInteraction(
            'listen_exact_001',
            deliveredText,
            replies,
            messageEdits,
            deferredReplies
        );
        assert.equal(
            await handleButtonInteraction(
                first as unknown as ButtonInteraction
            ),
            true
        );
        const second = createInteraction(
            'listen_exact_001',
            deliveredText,
            replies,
            messageEdits,
            deferredReplies
        );
        assert.equal(
            await handleButtonInteraction(
                second as unknown as ButtonInteraction
            ),
            true
        );

        assert.equal(ttsCalls, 1);
        assert.equal(requestText, deliveredText);
        assert.equal(replies.length, 2);
        assert.equal(deferredReplies.length, 2);
        assert.equal(
            (replies[0] as { files: Array<{ name: string }> }).files[0]?.name,
            'listen.mp3'
        );
        assert.match(
            (replies[1] as { content: string }).content,
            /already been synthesized/
        );
        assert.equal(messageEdits.length, 1);
        assert.equal(
            (messageEdits[0] as { content?: string }).content,
            undefined
        );
    } finally {
        botApi.runVoiceTtsViaApi = originalRunTts;
    }
});

test('Listen synthesis failure leaves the original text response available', async () => {
    const originalRunTts = botApi.runVoiceTtsViaApi;
    const replies: unknown[] = [];
    const deferredReplies: unknown[] = [];
    botApi.runVoiceTtsViaApi = (async () => {
        throw new Error('provider unavailable');
    }) as typeof botApi.runVoiceTtsViaApi;

    try {
        const interaction = createInteraction(
            'listen_failure_001',
            'Original text still here.',
            replies,
            [],
            deferredReplies
        );
        assert.equal(
            await handleButtonInteraction(
                interaction as unknown as ButtonInteraction
            ),
            true
        );
        assert.equal(deferredReplies.length, 1);
        assert.equal(interaction.message.content, 'Original text still here.');
        assert.match(
            (replies[0] as { content: string }).content,
            /text response is unchanged/
        );
    } finally {
        botApi.runVoiceTtsViaApi = originalRunTts;
    }
});

test('Listen defers before slow backend TTS finishes', async () => {
    const originalRunTts = botApi.runVoiceTtsViaApi;
    const replies: unknown[] = [];
    const messageEdits: unknown[] = [];
    const deferredReplies: unknown[] = [];
    const response = createTtsResponse('Short stored response.');
    let releaseTts: (() => void) | undefined;
    let markTtsStarted: () => void = () => undefined;
    const ttsStarted = new Promise<void>((resolve) => {
        markTtsStarted = resolve;
    });
    botApi.runVoiceTtsViaApi = (async () => {
        markTtsStarted();
        await new Promise<void>((resolve) => {
            releaseTts = resolve;
        });
        return response;
    }) as typeof botApi.runVoiceTtsViaApi;

    const interaction = createInteraction(
        'listen_slow_001',
        'Short stored response.',
        replies,
        messageEdits,
        deferredReplies
    );
    const handling = handleButtonInteraction(
        interaction as unknown as ButtonInteraction
    );
    try {
        const firstResult = await Promise.race([
            ttsStarted.then(() => 'tts-started' as const),
            handling.then(() => 'interaction-finished' as const),
        ]);
        assert.equal(firstResult, 'tts-started');
        assert.equal(deferredReplies.length, 1);
        releaseTts?.();
        assert.equal(await handling, true);
    } finally {
        releaseTts?.();
        try {
            await handling;
        } finally {
            botApi.runVoiceTtsViaApi = originalRunTts;
        }
    }
});
