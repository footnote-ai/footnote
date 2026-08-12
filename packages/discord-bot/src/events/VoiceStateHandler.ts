/**
 * @description: Coordinates voice events without loading the audio and realtime subsystem until it is needed.
 * @footnote-scope: core
 * @footnote-module: VoiceStateHandler
 * @footnote-risk: high - A load error can delay voice, but cleanup and later calls remain retryable.
 * @footnote-ethics: high - Voice processing starts only after the bot enters voice or an explicit call action requests it.
 */

import type { Client, ClientEvents, VoiceState } from 'discord.js';
import type { VoiceConnection } from '@discordjs/voice';
import type { InternalTtsVoiceId } from '@footnote/contracts/providers';
import { Events } from 'discord.js';
import { Event } from './Event.js';
import { createLoadOnce } from '../utils/loadOnce.js';
import { VoiceConnectionManager } from '../voice/VoiceConnectionManager.js';

type ClientWithHandlers = Client & {
    handlers?: { set: (key: string, handler: unknown) => void };
};

export class VoiceStateHandler extends Event {
    private subsystemLoaded = false;
    private readonly loadSubsystem = createLoadOnce(async () => {
        const { VoiceSubsystem } = await import('./VoiceSubsystem.js');
        const subsystem = new VoiceSubsystem(this.client);
        this.subsystemLoaded = true;
        return subsystem;
    });

    constructor(private readonly client: Client) {
        super({
            name: Events.VoiceStateUpdate as keyof ClientEvents,
            once: false,
        });
        (this.client as ClientWithHandlers).handlers?.set('voiceState', this);
    }

    public async execute(
        oldState: VoiceState,
        newState: VoiceState
    ): Promise<void> {
        const botId = this.client.user?.id;
        if (newState.member?.id !== botId && !this.subsystemLoaded) {
            return;
        }
        await (await this.loadSubsystem()).execute(oldState, newState);
    }

    public async registerInitiatingUser(
        guildId: string,
        userId: string
    ): Promise<void> {
        (await this.loadSubsystem()).registerInitiatingUser(guildId, userId);
    }

    public async registerInitiatingVoice(
        guildId: string,
        voice: InternalTtsVoiceId
    ): Promise<void> {
        (await this.loadSubsystem()).registerInitiatingVoice(guildId, voice);
    }

    /** Cleans up voice resources only when the subsystem was activated. */
    public async cleanupExistingConnections(): Promise<void> {
        if (this.subsystemLoaded) {
            await (await this.loadSubsystem()).cleanupExistingConnections();
        }
    }
}

export const createEvent = (client: Client): VoiceStateHandler =>
    new VoiceStateHandler(client);

/** Cleans a connection without constructing the realtime audio subsystem. */
export async function cleanupVoiceConnection(
    connection: VoiceConnection | null,
    client: Client
): Promise<void> {
    return new VoiceConnectionManager().cleanupVoiceConnection(
        connection,
        client
    );
}

export default VoiceStateHandler;
