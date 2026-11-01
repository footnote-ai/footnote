/**
 * @description: Covers local voice-session cleanup on backend closure.
 * @footnote-scope: test
 * @footnote-module: VoiceSubsystemSessionClosedTests
 * @footnote-risk: medium - Stale session entries can block a later voice call.
 * @footnote-ethics: low - Uses synthetic sessions and does not connect to Discord.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client } from 'discord.js';
import { VoiceSubsystem } from '../src/events/VoiceSubsystem.js';
import { RealtimeSession } from '../src/utils/realtimeService.js';
import type { RealtimeContextParticipant } from '../src/utils/prompting/RealtimeContextBuilder.js';
import type { AudioPlaybackHandler } from '../src/voice/AudioPlaybackHandler.js';

type VoiceSubsystemProbe = {
    userVoiceStateHandler: {
        registerInitiatingUser(guildId: string, userId: string): void;
    };
    sessionManager: {
        getSession(guildId: string): undefined;
        removeSession(guildId: string): void;
    };
    audioPlaybackHandler: Pick<AudioPlaybackHandler, 'stopPlayback'>;
    createRealtimeSession(
        guildId: string,
        participants: RealtimeContextParticipant[]
    ): Promise<RealtimeSession>;
};

test('backend session closure removes the local voice session immediately', async () => {
    const removedGuilds: string[] = [];
    const stoppedGuilds: string[] = [];
    const originalConnect = RealtimeSession.prototype.connect;
    RealtimeSession.prototype.connect = async () => undefined;
    try {
        const subsystem = new VoiceSubsystem({} as Client);
        const probe = subsystem as unknown as VoiceSubsystemProbe;
        probe.userVoiceStateHandler.registerInitiatingUser('guild-1', 'user-1');
        probe.sessionManager = {
            getSession: () => undefined,
            removeSession: (guildId) => removedGuilds.push(guildId),
        };
        probe.audioPlaybackHandler = {
            stopPlayback: (guildId) =>
                stoppedGuilds.push(guildId ?? 'missing guild'),
        };

        const session = await probe.createRealtimeSession('guild-1', [
            { id: 'user-1', displayName: 'Caller' },
        ]);
        session.emit('session.closed', { reason: 'provider_closed' });

        assert.deepEqual(removedGuilds, ['guild-1']);
        assert.deepEqual(stoppedGuilds, ['guild-1']);
        session.removeAllListeners();
    } finally {
        RealtimeSession.prototype.connect = originalConnect;
    }
});
