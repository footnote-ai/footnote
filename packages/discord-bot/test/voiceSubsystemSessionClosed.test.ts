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

type VoiceSubsystemStartupProbe = {
    startConversation(guildId: string): Promise<void>;
    activateConversation(guildId: string): Promise<void>;
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

test('conversation startup is reserved per guild while session creation awaits', async () => {
    let releaseStartup!: () => void;
    const startup = new Promise<void>((resolve) => {
        releaseStartup = resolve;
    });
    const startedGuilds: string[] = [];
    const subsystem = new VoiceSubsystem({} as Client);
    const probe = subsystem as unknown as VoiceSubsystemStartupProbe;
    probe.activateConversation = async (guildId) => {
        startedGuilds.push(guildId);
        await startup;
    };

    const first = probe.startConversation('guild-1');
    const duplicate = probe.startConversation('guild-1');
    const otherGuild = probe.startConversation('guild-2');
    try {
        assert.deepEqual(startedGuilds, ['guild-1', 'guild-2']);
    } finally {
        releaseStartup();
    }
    await Promise.all([first, duplicate, otherGuild]);
});

test('concurrent startup callers share failure and a later retry can succeed', async () => {
    const failure = new Error('startup failed');
    let attempts = 0;
    const subsystem = new VoiceSubsystem({} as Client);
    const probe = subsystem as unknown as VoiceSubsystemStartupProbe;
    probe.activateConversation = async () => {
        attempts += 1;
        if (attempts === 1) throw failure;
    };

    const first = probe.startConversation('guild-1');
    const duplicate = probe.startConversation('guild-1');
    assert.equal(first, duplicate);
    await Promise.all([
        assert.rejects(first, (error) => error === failure),
        assert.rejects(duplicate, (error) => error === failure),
    ]);
    assert.equal(attempts, 1);

    await probe.startConversation('guild-1');
    assert.equal(attempts, 2);
});
