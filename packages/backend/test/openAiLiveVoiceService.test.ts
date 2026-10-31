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
import { createOpenAiLiveVoiceSession } from '../src/services/openAiLiveVoice.js';

test('GPT-Live starts a backend WebSocket session with client delegation and sends PCM and commentary events', async () => {
    const sent: Array<Record<string, unknown>> = [];
    let openedUrl = '';
    let authorization = '';
    class FakeSocket extends EventEmitter {
        public readyState = 1;

        send(data: string): void {
            const event = JSON.parse(data) as Record<string, unknown>;
            sent.push(event);
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
    const session = await createOpenAiLiveVoiceSession({
        apiKey: 'test-key',
        instructions: 'Speak naturally and delegate substantive work.',
        voice: 'marin',
        createWebSocket: (url, options) => {
            openedUrl = url;
            authorization = options.headers.Authorization;
            const socket = new FakeSocket();
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
