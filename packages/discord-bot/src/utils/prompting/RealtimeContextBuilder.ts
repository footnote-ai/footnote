/**
 * @description: Builds realtime prompt context for audio sessions and participants.
 * @footnote-scope: core
 * @footnote-module: RealtimeContextBuilder
 * @footnote-risk: high - Context errors can degrade realtime responses or routing.
 * @footnote-ethics: high - Realtime transcripts impact privacy and consent.
 */
/**
 * Participant metadata included in realtime voice-session context.
 */
export interface RealtimeContextParticipant {
    id: string;
    displayName: string;
    isBot?: boolean;
}

/**
 * Input used to build one realtime session context.
 */
export interface RealtimeContextInput {
    participants: RealtimeContextParticipant[];
    transcripts?: string[];
}

interface RealtimeContextOutput {
    sessionContext: {
        participants: RealtimeContextParticipant[];
        transcripts?: string[];
    };
}

/**
 * Keeps participant and transcript metadata in the backend session context.
 */
export class RealtimeContextBuilder {
    public buildContext(input: RealtimeContextInput): RealtimeContextOutput {
        const transcripts = input.transcripts ?? [];

        return {
            sessionContext: {
                participants: input.participants,
                ...(transcripts.length > 0 ? { transcripts } : {}),
            },
        };
    }
}
