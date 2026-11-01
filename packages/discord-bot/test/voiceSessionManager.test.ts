/**
 * @description: Validates that voice session orchestration commits one caller turn without clearing audio or forcing a response.
 * @footnote-scope: test
 * @footnote-module: VoiceSessionManagerTests
 * @footnote-risk: medium - Missing tests could hide regressions that prevent realtime responses.
 * @footnote-ethics: medium - Turn handling affects when user speech is sent to the model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { AudioCaptureHandler } from '../src/voice/AudioCaptureHandler.js';
import { VoiceSessionManager } from '../src/voice/VoiceSessionManager.js';

class StubRealtimeSession {
    public clearCalls = 0;
    public commitCalls = 0;
    public responseCalls = 0;

    public async sendAudio(): Promise<void> {}

    public clearAudio(): void {
        this.clearCalls += 1;
    }

    public async commitAudio(): Promise<void> {
        this.commitCalls += 1;
    }

    public async createResponse(): Promise<void> {
        this.responseCalls += 1;
    }
}

test('VoiceSessionManager commits caller turns without clearing audio or forcing a response', async () => {
    const manager = new VoiceSessionManager();
    const audioCaptureHandler = new AudioCaptureHandler();
    const realtimeSession = new StubRealtimeSession();

    const session = manager.createSession(
        {} as never,
        realtimeSession as never,
        audioCaptureHandler,
        {} as never,
        new Map(),
        'user-1'
    );

    manager.addSession('guild-1', session);

    audioCaptureHandler.emit('speakerStart', {
        guildId: 'guild-1',
        userId: 'user-1',
        activeSpeakerCount: 0,
    });

    audioCaptureHandler.emit('speakerSilence', {
        guildId: 'guild-1',
        userId: 'user-1',
        durationMs: 500,
        chunkCount: 2,
        totalBytes: 2000,
        reason: 'speaking_end',
    });

    await session.audioPipeline;

    assert.equal(realtimeSession.clearCalls, 0);
    assert.equal(realtimeSession.commitCalls, 1);
    assert.equal(realtimeSession.responseCalls, 0);
});
