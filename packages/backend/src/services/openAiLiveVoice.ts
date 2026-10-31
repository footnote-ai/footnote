/**
 * @description: Owns the backend GPT-Live WebSocket and normalizes its call events.
 * @footnote-scope: core
 * @footnote-module: OpenAiLiveVoice
 * @footnote-risk: high - Provider connection and teardown errors affect active voice calls.
 * @footnote-ethics: high - Caller audio leaves the backend only through this selected provider path.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

export type OpenAiLiveVoiceEvent = Record<string, unknown> & { type: string };

export interface OpenAiLiveVoiceSession {
    sendAudio(audio: Buffer): void;
    appendCommentary(text: string, delegationId: string | null): void;
    close(): void;
    onEvent(listener: (event: OpenAiLiveVoiceEvent) => void): () => void;
}

type LiveSocket = EventEmitter & {
    readyState: number;
    send(data: string): void;
    close(): void;
};

export type OpenAiLiveVoiceSessionFactory = (input: {
    instructions: string;
    voice: string;
    signal?: AbortSignal;
}) => Promise<OpenAiLiveVoiceSession>;

type OpenAiLiveVoiceOptions = {
    apiKey: string;
    instructions: string;
    voice: string;
    signal?: AbortSignal;
    createWebSocket?: (
        url: string,
        options: { headers: Record<string, string> }
    ) => LiveSocket;
};

const OPENAI_LIVE_URL = 'wss://api.openai.com/v1/live/sessions';

export const createOpenAiLiveVoiceSession = async ({
    apiKey,
    instructions,
    voice,
    signal,
    createWebSocket = (url, options) =>
        new WebSocket(url, options) as unknown as LiveSocket,
}: OpenAiLiveVoiceOptions): Promise<OpenAiLiveVoiceSession> => {
    if (!apiKey.trim()) throw new Error('OpenAI Live credentials are missing.');
    if (signal?.aborted) throw new Error('OpenAI Live setup was cancelled.');

    const socket = createWebSocket(OPENAI_LIVE_URL, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });
    const events = new EventEmitter();
    let started = false;
    let closed = false;
    let closeTimer: NodeJS.Timeout | undefined;
    let abortSetup: (() => void) | undefined;

    const send = (event: Record<string, unknown>): void => {
        if (closed || socket.readyState !== WebSocket.OPEN)
            throw new Error('OpenAI Live session is not connected.');
        socket.send(JSON.stringify(event));
    };

    const ready = new Promise<void>((resolve, reject) => {
        const abort = (): void => {
            reject(new Error('OpenAI Live setup was cancelled.'));
            socket.close();
        };
        abortSetup = abort;
        signal?.addEventListener('abort', abort, { once: true });
        socket.once('open', () => {
            try {
                send({
                    type: 'session.start',
                    event_id: randomUUID(),
                    session: {
                        model: 'gpt-live-1',
                        instructions,
                        audio: {
                            format: { type: 'audio/pcm', rate: 24_000 },
                            output: { voice },
                        },
                        delegation: { type: 'client' },
                    },
                });
            } catch (error) {
                reject(error);
            }
        });
        socket.on('message', (raw: Buffer | string) => {
            let event: OpenAiLiveVoiceEvent;
            try {
                const value = JSON.parse(raw.toString());
                if (
                    typeof value !== 'object' ||
                    value === null ||
                    typeof value.type !== 'string'
                )
                    return;
                event = value as OpenAiLiveVoiceEvent;
            } catch {
                return;
            }
            events.emit('event', event);
            if (event.type === 'session.started' && !started) {
                started = true;
                signal?.removeEventListener('abort', abort);
                abortSetup = undefined;
                resolve();
            } else if (event.type === 'error' && !started) {
                signal?.removeEventListener('abort', abort);
                abortSetup = undefined;
                reject(new Error('OpenAI Live rejected session setup.'));
            } else if (event.type === 'session.closed') {
                closed = true;
                clearTimeout(closeTimer);
                socket.close();
            }
        });
        socket.on('error', (error: Error) => {
            if (!started) reject(error);
            else events.emit('event', { type: 'transport.error' });
        });
        socket.once('close', () => {
            clearTimeout(closeTimer);
            if (!closed) {
                closed = true;
                events.emit('event', { type: 'transport.closed' });
            }
            if (!started) reject(new Error('OpenAI Live closed during setup.'));
        });
    });

    try {
        await ready;
    } catch (error) {
        if (abortSetup) signal?.removeEventListener('abort', abortSetup);
        closed = true;
        socket.close();
        throw error;
    }

    return {
        sendAudio(audio) {
            if (!audio.length) throw new Error('Live audio chunk is empty.');
            send({
                type: 'session.input_audio.append',
                audio: audio.toString('base64'),
            });
        },
        appendCommentary(text, delegationId) {
            send({
                type: 'session.commentary.append',
                event_id: randomUUID(),
                delegation_id: delegationId,
                content: text,
            });
        },
        close() {
            if (closed) return;
            try {
                send({ type: 'session.close', event_id: randomUUID() });
                closeTimer = setTimeout(() => {
                    closed = true;
                    socket.close();
                }, 2_000);
                closeTimer.unref?.();
            } catch {
                closed = true;
                socket.close();
            }
        },
        onEvent(listener) {
            events.on('event', listener);
            return () => events.off('event', listener);
        },
    };
};
