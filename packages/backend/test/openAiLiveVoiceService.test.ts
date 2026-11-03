/**
 * @description: Verifies GPT-Live session events, audio and setup cancellation without provider calls.
 * @footnote-scope: test
 * @footnote-module: OpenAiLiveVoiceServiceTests
 * @footnote-risk: medium - Incorrect event expectations could hide adapter regressions.
 * @footnote-ethics: high - Synthetic fixtures verify the backend-owned audio and delegation boundary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import {
    createOpenAiLiveVoiceSession,
    validateOpenAiLiveTextAppend,
} from '../src/services/openAiLiveVoice.js';

class FakeSocket extends EventEmitter {
    public readyState = 1;

    public constructor(private readonly sent: Array<Record<string, unknown>>) {
        super();
    }

    send(data: string): void {
        const event = JSON.parse(data) as Record<string, unknown>;
        this.sent.push(event);
        if (event.type === 'session.start') {
            setImmediate(() =>
                this.emit(
                    'message',
                    Buffer.from(
                        JSON.stringify({
                            type: 'session.started',
                            session: { id: 'live-session' },
                        })
                    )
                )
            );
        }
    }

    close(): void {
        this.readyState = 3;
        this.emit('close');
    }
}

test('GPT-Live starts a backend WebSocket session with client delegation and sends PCM and commentary events', async () => {
    const sent: Array<Record<string, unknown>> = [];
    let openedUrl = '';
    let authorization = '';
    const session = await createOpenAiLiveVoiceSession({
        apiKey: 'test-key',
        instructions: 'Speak naturally and delegate substantive work.',
        voice: 'marin',
        createWebSocket: (url, options) => {
            openedUrl = url;
            authorization = options.headers.Authorization;
            const socket = new FakeSocket(sent);
            setImmediate(() => socket.emit('open'));
            return socket as never;
        },
    });

    session.sendAudio(Buffer.from([1, 2, 3, 4]));
    session.appendCommentary('The reviewed result.', 'delegation-1');
    session.close();

    assert.equal(openedUrl, 'wss://api.openai.com/v1/live/sessions');
    assert.equal(authorization, 'Bearer test-key');
    assert.deepEqual(
        sent.map((event) => event.type),
        [
            'session.start',
            'session.input_audio.append',
            'session.commentary.append',
            'session.close',
        ]
    );
    assert.deepEqual(sent[0]?.session, {
        model: 'gpt-live-1',
        instructions: 'Speak naturally and delegate substantive work.',
        audio: {
            format: { type: 'audio/pcm', rate: 24_000 },
            output: { voice: 'marin' },
        },
        delegation: { type: 'client' },
    });
    assert.equal(sent[1]?.audio, Buffer.from([1, 2, 3, 4]).toString('base64'));
    assert.equal(sent[2]?.content, 'The reviewed result.');
    assert.equal(sent[2]?.delegation_id, 'delegation-1');
});

test('GPT-Live removes setup cancellation listeners when startup is aborted', async () => {
    const controller = new AbortController();
    let socket: FakeSocket | undefined;
    class FakeSocket extends EventEmitter {
        public readyState = 1;

        public send(): void {}

        public close(): void {
            this.readyState = 3;
            this.emit('close');
        }
    }
    const setup = createOpenAiLiveVoiceSession({
        apiKey: 'test-key',
        instructions: 'test',
        voice: 'marin',
        signal: controller.signal,
        createWebSocket: () => {
            socket = new FakeSocket();
            setImmediate(() => socket?.emit('open'));
            return socket as never;
        },
    });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();

    await assert.rejects(setup, /setup was cancelled/i);
    assert.equal(socket?.readyState, 3);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('GPT-Live appends thinking, instructions, and commentary with correlatable event IDs', async () => {
    const sent: Array<Record<string, unknown>> = [];
    let socket: FakeSocket | undefined;
    const session = await createOpenAiLiveVoiceSession({
        apiKey: 'test-key',
        instructions: 'Fixed call persona.',
        voice: 'marin',
        createWebSocket: () => {
            socket = new FakeSocket(sent);
            setImmediate(() => socket?.emit('open'));
            return socket as never;
        },
    });
    const received: Array<Record<string, unknown>> = [];
    session.onEvent((event) => received.push(event));

    const thinkingId = session.appendThinking(
        'Caller asks for Friday.',
        'delegation-1'
    );
    const instructionId = session.appendInstructions(
        'Keep the fixed persona.',
        null
    );
    const commentaryId = session.appendCommentary(
        'The reviewed result.',
        'delegation-1'
    );
    const sentBeforeOversizedAppends = sent.length;
    assert.throws(
        () => session.appendThinking('中'.repeat(167), 'delegation-1'),
        /500-token limit/
    );
    assert.throws(
        () => session.appendInstructions('中'.repeat(167), null),
        /500-token limit/
    );
    assert.throws(
        () => session.appendCommentary('中'.repeat(167), 'delegation-1'),
        /500-token limit/
    );
    assert.equal(sent.length, sentBeforeOversizedAppends);

    assert.equal(new Set([thinkingId, instructionId, commentaryId]).size, 3);
    assert.deepEqual(
        sent.slice(1).map(({ type, event_id, delegation_id }) => ({
            type,
            event_id,
            delegation_id,
        })),
        [
            {
                type: 'session.thinking.append',
                event_id: thinkingId,
                delegation_id: 'delegation-1',
            },
            {
                type: 'session.instructions.append',
                event_id: instructionId,
                delegation_id: null,
            },
            {
                type: 'session.commentary.append',
                event_id: commentaryId,
                delegation_id: 'delegation-1',
            },
        ]
    );
    assert.deepEqual(
        sent.slice(1).map((event) => event.content),
        [
            'Caller asks for Friday.',
            'Keep the fixed persona.',
            'The reviewed result.',
        ]
    );

    socket?.emit(
        'message',
        Buffer.from(
            JSON.stringify({
                type: 'session.thinking.appended',
                event_id: 'provider-ack-1',
                client_event_id: thinkingId,
                start_ms: 100,
                end_ms: 100,
            })
        )
    );
    socket?.emit(
        'message',
        Buffer.from(
            JSON.stringify({
                type: 'error',
                event_id: 'provider-error-1',
                client_event_id: instructionId,
                error: { code: 'rejected', message: 'append rejected' },
            })
        )
    );

    assert.deepEqual(
        received.map(({ type, event_id, client_event_id }) => ({
            type,
            event_id,
            client_event_id,
        })),
        [
            {
                type: 'session.thinking.appended',
                event_id: 'provider-ack-1',
                client_event_id: thinkingId,
            },
            {
                type: 'error',
                event_id: 'provider-error-1',
                client_event_id: instructionId,
            },
        ]
    );
    session.close();
});

test('GPT-Live append validation accepts multilingual 500-token estimates per event', () => {
    const purposes = ['thinking', 'instructions', 'commentary'] as const;
    for (const purpose of purposes) {
        assert.doesNotThrow(() =>
            validateOpenAiLiveTextAppend(purpose, 'é'.repeat(250))
        );
        assert.doesNotThrow(() =>
            validateOpenAiLiveTextAppend(purpose, '中'.repeat(166))
        );
        assert.throws(
            () => validateOpenAiLiveTextAppend(purpose, '中'.repeat(167)),
            /500-token limit/
        );
    }
});
