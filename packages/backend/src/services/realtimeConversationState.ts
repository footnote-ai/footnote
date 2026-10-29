/**
 * @description: Holds bounded, consent-scoped conversation state for one realtime call.
 * @footnote-scope: core
 * @footnote-module: RealtimeConversationState
 * @footnote-risk: high - Scope mistakes can reuse stale context or delivery handles.
 * @footnote-ethics: high - Realtime speech context is private and consent-bound.
 */
import { randomUUID } from 'node:crypto';
import type { InternalVoiceParticipant } from '@footnote/contracts/voice';
import type {
    ConversationContextEnvelope,
    ConversationContextServiceOutput,
} from './conversationContextService.js';
import { projectConversationMessages } from './conversationContextService.js';

const MAX_CONTEXT_TURNS = 12;
const MAX_CONTEXT_BYTES = 16 * 1024;
const MAX_AUDIENCE_PARTICIPANTS = 32;
const MAX_PARTICIPANT_FIELD_LENGTH = 128;
const INTENT_ACTIONS = new Set<RealtimeIntentAction>([
    'question',
    'supersede',
    'continue',
    'cancel',
    'interrupt',
    'attention',
]);

/** Trusted adapter-derived human audience members; bot identities are not consent subjects. */
export type RealtimeConversationParticipant = Pick<
    InternalVoiceParticipant,
    'id' | 'displayName'
> & {
    processingConsent: boolean;
};

export type RealtimeIntentAction =
    | 'question'
    | 'supersede'
    | 'continue'
    | 'cancel'
    | 'interrupt'
    | 'attention';

export type RealtimeIntentStatus =
    'pending' | 'interrupted' | 'cancelled' | 'superseded';

export type RealtimeFreshnessHandle = {
    sessionCorrelationId: string;
    instanceId: string;
    revision: number;
};

export type RealtimeConversationSnapshot = {
    sessionCorrelationId: string;
    revision: number;
    intent: { status: RealtimeIntentStatus; turnId: string } | null;
    context: ConversationContextServiceOutput;
};

export type FinalizedRealtimeTurn = {
    role: 'user' | 'assistant';
    speakerId: string;
    content: string;
    intent?: RealtimeIntentAction;
};

export type RealtimeTurnResult =
    | {
          accepted: true;
          turnId: string;
          handle: RealtimeFreshnessHandle;
          context: ConversationContextServiceOutput;
      }
    | {
          accepted: false;
          reason:
              | 'session_closed'
              | 'audience_consent_required'
              | 'speaker_unresolved'
              | 'turn_too_large';
          handle: RealtimeFreshnessHandle;
      };

type StoredTurn = FinalizedRealtimeTurn & {
    turnId: string;
    speakerLabel: string;
};

const utf8Bytes = (value: string): number => Buffer.byteLength(value, 'utf8');

const requireBoundedText = (value: string, field: string): string => {
    const normalized = value.trim();
    if (
        normalized.length === 0 ||
        normalized.length > MAX_PARTICIPANT_FIELD_LENGTH
    ) {
        throw new TypeError(`${field} must be a non-empty bounded string.`);
    }
    return normalized;
};

/** One call's ephemeral context, intent revision, and delivery freshness boundary. */
export class RealtimeConversationState {
    private readonly instanceId = randomUUID();
    private audience: RealtimeConversationParticipant[] = [];
    private turns: StoredTurn[] = [];
    private contextBytes = 0;
    private revision = 0;
    private intent: RealtimeConversationSnapshot['intent'] = null;
    private closed = false;

    constructor(private readonly sessionCorrelationId: string) {
        this.sessionCorrelationId = requireBoundedText(
            sessionCorrelationId,
            'sessionCorrelationId'
        );
    }

    /** Replaces the complete current audience; a scope change discards all prior context. */
    setAudience(participants: RealtimeConversationParticipant[]): void {
        if (this.closed) return;
        if (!Array.isArray(participants)) {
            this.invalidateAudience();
            throw new TypeError('Realtime audience metadata is invalid.');
        }
        if (participants.length > MAX_AUDIENCE_PARTICIPANTS) {
            this.invalidateAudience();
            throw new TypeError(
                'Realtime audience exceeds the participant limit.'
            );
        }
        let next: RealtimeConversationParticipant[];
        try {
            next = Array.from(participants, (participant) => ({
                id: requireBoundedText(participant.id, 'participant id'),
                displayName: requireBoundedText(
                    participant.displayName,
                    'participant displayName'
                ),
                processingConsent: participant.processingConsent,
            }));
            if (
                next.some(
                    (participant) =>
                        typeof participant.processingConsent !== 'boolean'
                ) ||
                new Set(next.map((participant) => participant.id)).size !==
                    next.length
            ) {
                throw new TypeError('Realtime audience metadata is invalid.');
            }
        } catch (error) {
            this.invalidateAudience();
            throw error;
        }
        const after = JSON.stringify(
            [...next].sort((a, b) => a.id.localeCompare(b.id))
        );
        const before = JSON.stringify(
            [...this.audience].sort((a, b) => a.id.localeCompare(b.id))
        );
        if (before !== after) {
            this.audience = next;
            this.turns = [];
            this.contextBytes = 0;
            this.revision += 1;
            if (this.intent) this.intent.status = 'superseded';
        }
    }

    /** Accepts one attributed finalized turn after checking the whole current audience. */
    appendFinalizedTurn(input: FinalizedRealtimeTurn): RealtimeTurnResult {
        const handle = this.freshnessHandle();
        if (this.closed)
            return { accepted: false, reason: 'session_closed', handle };
        this.validateTurnShape(input);
        if (!this.hasConsentingAudience()) {
            return {
                accepted: false,
                reason: 'audience_consent_required',
                handle,
            };
        }
        const speaker = this.resolveSpeaker(input.role, input.speakerId);
        if (!speaker) {
            return { accepted: false, reason: 'speaker_unresolved', handle };
        }
        const content = this.normalizeTurnContent(input.role, input.content);
        if (!content) {
            return { accepted: false, reason: 'turn_too_large', handle };
        }

        const turnId = randomUUID();
        const stored: StoredTurn = {
            role: input.role,
            speakerId: speaker.id,
            speakerLabel: speaker.label,
            content,
            turnId,
        };
        if (input.role === 'user') this.applyIntent(input.intent, turnId);
        this.retainTurn(stored);
        return {
            accepted: true,
            turnId,
            handle: this.freshnessHandle(),
            context: this.buildContext(),
        };
    }

    /** True only for a handle from this call instance and current intent revision. */
    isCurrent(handle: RealtimeFreshnessHandle): boolean {
        return (
            !this.closed &&
            handle.sessionCorrelationId === this.sessionCorrelationId &&
            handle.instanceId === this.instanceId &&
            handle.revision === this.revision
        );
    }

    /** Checks lifecycle freshness only; it does not establish review or speech approval. */
    isDeliveryFresh(handle: RealtimeFreshnessHandle): boolean {
        return this.isCurrent(handle) && this.intent?.status === 'pending';
    }

    snapshot(): RealtimeConversationSnapshot {
        return {
            sessionCorrelationId: this.sessionCorrelationId,
            revision: this.revision,
            intent: this.intent ? { ...this.intent } : null,
            context: this.buildContext(),
        };
    }

    /** Idempotently revokes handles and clears all ephemeral call content. */
    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.revision += 1;
        this.audience = [];
        this.turns = [];
        this.contextBytes = 0;
        this.intent = null;
    }

    private freshnessHandle(): RealtimeFreshnessHandle {
        return {
            sessionCorrelationId: this.sessionCorrelationId,
            instanceId: this.instanceId,
            revision: this.revision,
        };
    }

    private validateTurnShape(input: FinalizedRealtimeTurn): void {
        if (input.intent !== undefined && !INTENT_ACTIONS.has(input.intent)) {
            throw new TypeError('Finalized realtime turn intent is invalid.');
        }
        if (input.role !== 'user' && input.role !== 'assistant') {
            throw new TypeError('Finalized realtime turn role is invalid.');
        }
    }

    private hasConsentingAudience(): boolean {
        return (
            this.audience.length > 0 &&
            this.audience.every((participant) => participant.processingConsent)
        );
    }

    private resolveSpeaker(
        role: FinalizedRealtimeTurn['role'],
        speakerId: string
    ): { id: string; label: string } | undefined {
        if (role === 'assistant') return { id: 'assistant', label: 'Footnote' };
        const normalizedId =
            typeof speakerId === 'string' ? speakerId.trim() : '';
        const participant = this.audience.find(
            (person) => person.id === normalizedId
        );
        if (!participant) {
            this.holdDeliveryForAmbiguousSpeech();
            return undefined;
        }
        return { id: participant.id, label: participant.displayName };
    }

    private normalizeTurnContent(
        role: FinalizedRealtimeTurn['role'],
        rawContent: string
    ): string | undefined {
        if (typeof rawContent !== 'string') {
            if (role === 'user') this.holdDeliveryForAmbiguousSpeech();
            throw new TypeError(
                'Finalized realtime turn content must be a string.'
            );
        }
        const content = rawContent.trim();
        if (!content) {
            if (role === 'user') this.holdDeliveryForAmbiguousSpeech();
            throw new TypeError('Finalized realtime turn content is empty.');
        }
        if (utf8Bytes(content) > MAX_CONTEXT_BYTES) {
            if (role === 'user') this.holdDeliveryForAmbiguousSpeech();
            return undefined;
        }
        return content;
    }

    private retainTurn(turn: StoredTurn): void {
        this.turns.push(turn);
        this.contextBytes += utf8Bytes(turn.content);
        while (
            this.turns.length > MAX_CONTEXT_TURNS ||
            this.contextBytes > MAX_CONTEXT_BYTES
        ) {
            const removed = this.turns.shift();
            if (removed) this.contextBytes -= utf8Bytes(removed.content);
        }
    }

    private applyIntent(
        action: RealtimeIntentAction | undefined,
        turnId: string
    ): void {
        if (action === 'question' || action === 'supersede') {
            this.revision += 1;
            this.intent = { status: 'pending', turnId };
        } else if (action === 'cancel' && this.intent) {
            this.revision += 1;
            this.intent = { ...this.intent, status: 'cancelled' };
        } else if (
            action === 'interrupt' &&
            this.intent?.status === 'pending'
        ) {
            this.intent.status = 'interrupted';
        } else if (
            action === 'continue' &&
            this.intent?.status === 'interrupted'
        ) {
            this.intent.status = 'pending';
        }
    }

    private holdDeliveryForAmbiguousSpeech(): void {
        if (this.intent?.status === 'pending')
            this.intent.status = 'interrupted';
    }

    private invalidateAudience(): void {
        this.audience = [];
        this.turns = [];
        this.contextBytes = 0;
        this.revision += 1;
        if (this.intent) this.intent.status = 'superseded';
    }

    private buildContext(): ConversationContextServiceOutput {
        const visibleTurns = this.turns.map((turn) => ({
            role: turn.role,
            content: turn.content,
            speakerId: turn.speakerId,
            speakerLabel: turn.speakerLabel,
            visibility: 'model_visible' as const,
        }));
        const messages = projectConversationMessages(visibleTurns);
        const participants = new Map<
            string,
            ConversationContextEnvelope['participants'][number]
        >();
        for (const turn of this.turns) {
            const key = `${turn.role}:${turn.speakerId}`;
            if (!participants.has(key)) {
                participants.set(key, {
                    speakerId: turn.speakerId,
                    speakerLabel: turn.speakerLabel,
                    roleHint: turn.role,
                });
            }
        }
        return {
            messages: messages.map((message) => ({ ...message })),
            contextEnvelope: {
                participants: [...participants.values()].map((participant) => ({
                    ...participant,
                })),
                turns: this.turns.map((turn) => ({
                    turnId: turn.turnId,
                    role: turn.role,
                    speakerId: turn.speakerId,
                    speakerLabel: turn.speakerLabel,
                    visibility: 'model_visible',
                    authority: 'conversation',
                })),
                diagnostics: {
                    surface: 'discord',
                    totalInputMessages: this.turns.length,
                    projectedMessageCount: messages.length,
                    trimmedMessageCount: 0,
                    sanitizedTimestampCount: 0,
                    projectedSpeakerLabelCount: messages.filter((message) =>
                        message.content.startsWith('[')
                    ).length,
                },
            },
        };
    }
}
