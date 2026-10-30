/**
 * @description: Holds bounded, consent-scoped conversation state for one realtime call.
 * @footnote-scope: core
 * @footnote-module: RealtimeConversationState
 * @footnote-risk: high - Scope mistakes can reuse stale context or delivery handles.
 * @footnote-ethics: high - Realtime speech context is private and consent-bound.
 */
import { randomUUID } from 'node:crypto';
import type { InternalVoiceParticipant } from '@footnote/contracts/voice';
import type { RealtimeExecutionInspection } from '@footnote/contracts/web';
import type {
    ConversationContextEnvelope,
    ConversationContextServiceOutput,
} from './conversationContextService.js';
import { projectConversationMessages } from './conversationContextService.js';
import type {
    RealtimeFinalResponse,
    RealtimeReviewDisposition,
} from './realtimeWorkflowScope.js';

const MAX_CONTEXT_TURNS = 12;
const MAX_CONTEXT_BYTES = 16 * 1024;
const MAX_AUDIENCE_PARTICIPANTS = 32;
const MAX_PARTICIPANT_FIELD_LENGTH = 128;
const EXECUTION_DEADLINE_MS = 60_000;
const CANCELLATION_WATCHDOG_MS = 5000;
const DELIVERY_TTL_MS = 30_000;
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

export type RealtimeWorkflowResult = {
    responseId?: string;
    runId?: string;
    status?: 'completed' | 'degraded' | 'failed' | 'rejected';
    finalResponse?: RealtimeFinalResponse;
};

/** Internal backend service seam carrying canonical identity and final-response evidence for staging. */
export type RealtimeWorkflowRunner = {
    runRealtimeConversation: (
        snapshot: RealtimeConversationSnapshot,
        context: { signal: AbortSignal; onRunStarted: (runId: string) => void }
    ) => Promise<RealtimeWorkflowResult>;
};

export type RealtimeDelivery = Extract<
    RealtimeFinalResponse,
    { disposition: 'approved' }
> & {
    deliveryId: string;
    handle: RealtimeFreshnessHandle;
    turnId: string;
    audienceIds: string[];
    expiresAt: number;
};

/** Local authorization and adapter-reported playback are independent facts. */
export type RealtimeDeliveryStatus = Omit<RealtimeDelivery, 'text'> & {
    status: 'ready' | 'requested' | 'handed_off' | 'revoked' | 'expired';
    playback:
        'not_reported' | 'started' | 'completed' | 'interrupted' | 'failed';
    handedOffAt?: number;
    startReportedAt?: number;
};

type RealtimeCompletion = Omit<RealtimeWorkflowResult, 'finalResponse'> & {
    reviewDisposition?: RealtimeReviewDisposition;
};

type ExecutionReservation = {
    owner: string;
    revision: number;
    sessionCorrelationId: string;
    turnId: string;
    controller: AbortController;
    startedAt: number;
    runId?: string;
    cancellationRequestedAt?: number;
    degradedReason?: 'cancellation_unconfirmed' | 'execution_deadline_exceeded';
    cancellationWatchdog?: ReturnType<typeof setTimeout>;
    deadlineWatchdog?: ReturnType<typeof setTimeout>;
};

// Capacity belongs to the backend process, so a new call cannot replace unresolved work.
let executionReservation: ExecutionReservation | undefined;

const requestExecutionCancellation = (
    reservation: ExecutionReservation
): void => {
    if (reservation.cancellationRequestedAt !== undefined) return;
    reservation.cancellationRequestedAt = Date.now();
    reservation.controller.abort();
    reservation.cancellationWatchdog = setTimeout(() => {
        reservation.degradedReason ??= 'cancellation_unconfirmed';
    }, CANCELLATION_WATCHDOG_MS);
    reservation.cancellationWatchdog.unref?.();
};

/** Content-free, process-wide inspection; caller authentication belongs to the operator handler. */
export const inspectRealtimeExecution = (): RealtimeExecutionInspection => {
    const reservation = executionReservation;
    if (reservation === undefined) return { occupied: false };
    let status: 'degraded' | 'cancelling' | 'pending' = 'pending';
    if (reservation.degradedReason) status = 'degraded';
    else if (reservation.cancellationRequestedAt !== undefined)
        status = 'cancelling';
    return {
        occupied: true as const,
        sessionCorrelationId: reservation.sessionCorrelationId,
        turnId: reservation.turnId,
        runId: reservation.runId,
        status,
        cancellationRequestedAt: reservation.cancellationRequestedAt,
        cancellationDeadlineAt:
            reservation.cancellationRequestedAt === undefined
                ? undefined
                : reservation.cancellationRequestedAt +
                  CANCELLATION_WATCHDOG_MS,
        degradedReason: reservation.degradedReason,
        ageMs: Math.max(0, Date.now() - reservation.startedAt),
        startedAt: reservation.startedAt,
        deadlineAt: reservation.startedAt + EXECUTION_DEADLINE_MS,
    };
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
    private lastStartedRevision: number | undefined;
    private completed: RealtimeCompletion | undefined;
    private delivery:
        { inspection: RealtimeDeliveryStatus; text?: string } | undefined;
    private deliveryEpoch = 0;
    private deliveryExpiry: ReturnType<typeof setTimeout> | undefined;

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
            this.cancelExecution();
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

    /** Reserves capacity synchronously and detaches Workflow completion from conversational events. */
    startExecution(runner: RealtimeWorkflowRunner):
        | { accepted: true }
        | {
              accepted: false;
              reason:
                  'duplicate' | 'occupied' | 'degraded' | 'intent_unavailable';
          } {
        if (executionReservation?.degradedReason !== undefined)
            return { accepted: false, reason: 'degraded' };
        if (this.lastStartedRevision === this.revision)
            return { accepted: false, reason: 'duplicate' };
        if (executionReservation !== undefined)
            return { accepted: false, reason: 'occupied' };
        if (
            this.closed ||
            !this.hasConsentingAudience() ||
            this.intent?.status !== 'pending' ||
            !this.turns.some((turn) => turn.turnId === this.intent?.turnId)
        )
            return { accepted: false, reason: 'intent_unavailable' };
        let snapshot: RealtimeConversationSnapshot | undefined =
            this.snapshot();
        const reservation: ExecutionReservation = {
            owner: this.instanceId,
            revision: this.revision,
            sessionCorrelationId: this.sessionCorrelationId,
            turnId: this.intent.turnId,
            controller: new AbortController(),
            startedAt: Date.now(),
        };
        executionReservation = reservation;
        reservation.deadlineWatchdog = setTimeout(() => {
            reservation.degradedReason = 'execution_deadline_exceeded';
            requestExecutionCancellation(reservation);
        }, EXECUTION_DEADLINE_MS);
        reservation.deadlineWatchdog.unref?.();
        this.lastStartedRevision = this.revision;
        this.completed = undefined;
        this.revokeDelivery();
        const deliveryEpoch = this.deliveryEpoch;
        void Promise.resolve()
            .then(() => {
                const accepted = snapshot;
                snapshot = undefined;
                reservation.controller.signal.throwIfAborted();
                if (accepted === undefined)
                    throw new Error(
                        'Realtime execution snapshot is unavailable.'
                    );
                return runner.runRealtimeConversation(accepted, {
                    signal: reservation.controller.signal,
                    onRunStarted: (runId) => {
                        reservation.runId = runId;
                    },
                });
            })
            .then(
                (result) => {
                    if (
                        !this.closed &&
                        this.revision === reservation.revision &&
                        !reservation.controller.signal.aborted &&
                        Date.now() <
                            reservation.startedAt + EXECUTION_DEADLINE_MS
                    ) {
                        let status = result.status ?? 'failed';
                        if (!result.responseId || !result.runId)
                            status = 'failed';
                        this.completed = {
                            responseId: result.responseId,
                            runId: result.runId,
                            status,
                            ...(result.finalResponse === undefined
                                ? {}
                                : {
                                      reviewDisposition:
                                          result.finalResponse.disposition,
                                  }),
                        };
                        const answer = result.finalResponse;
                        if (
                            status === 'completed' &&
                            answer?.disposition === 'approved' &&
                            answer.responseId === result.responseId &&
                            answer.runId === result.runId &&
                            reservation.runId === result.runId &&
                            this.intent?.status === 'pending' &&
                            this.intent.turnId === reservation.turnId &&
                            this.hasConsentingAudience() &&
                            deliveryEpoch === this.deliveryEpoch &&
                            utf8Bytes(answer.text) <= MAX_CONTEXT_BYTES
                        ) {
                            const { text, ...evidence } = answer;
                            this.delivery = {
                                text,
                                inspection: {
                                    ...evidence,
                                    deliveryId: randomUUID(),
                                    handle: this.freshnessHandle(),
                                    turnId: reservation.turnId,
                                    audienceIds: this.audience.map(
                                        (person) => person.id
                                    ),
                                    expiresAt: Date.now() + DELIVERY_TTL_MS,
                                    status: 'ready',
                                    playback: 'not_reported',
                                },
                            };
                            this.deliveryExpiry = setTimeout(
                                () => this.revokeDelivery('expired'),
                                DELIVERY_TTL_MS
                            );
                            this.deliveryExpiry.unref?.();
                        }
                    }
                },
                () => {
                    if (
                        !this.closed &&
                        this.revision === reservation.revision &&
                        !reservation.controller.signal.aborted
                    )
                        this.completed = {
                            status: 'failed',
                            runId: reservation.runId,
                        };
                }
            )
            .finally(() => {
                clearTimeout(reservation.cancellationWatchdog);
                clearTimeout(reservation.deadlineWatchdog);
                if (executionReservation === reservation)
                    executionReservation = undefined;
            });
        return { accepted: true };
    }

    executionStatus(): ReturnType<typeof inspectRealtimeExecution> {
        return inspectRealtimeExecution();
    }

    /** Identity and disposition only: completion never grants permission to speak. */
    completedExecution(): RealtimeCompletion | undefined {
        return this.completed ? { ...this.completed } : undefined;
    }

    /** Content-free snapshot of the sole delivery; reports do not prove that anyone heard it. */
    deliveryStatus(): RealtimeDeliveryStatus | undefined {
        this.recheckDelivery();
        const inspection = this.delivery?.inspection;
        return inspection
            ? {
                  ...inspection,
                  handle: { ...inspection.handle },
                  audienceIds: [...inspection.audienceIds],
              }
            : undefined;
    }

    /** Reserves this ready answer once without handing text to an audio adapter. */
    requestDelivery(
        handle: RealtimeFreshnessHandle
    ): RealtimeDeliveryStatus | undefined {
        this.recheckDelivery();
        if (
            this.delivery?.inspection.status !== 'ready' ||
            !this.isDeliveryFresh(handle) ||
            !this.isDeliveryFresh(this.delivery.inspection.handle)
        )
            return undefined;
        this.delivery.inspection.status = 'requested';
        return this.deliveryStatus();
    }

    /** Rechecks authorization at the playback boundary and hands exact text off once. */
    startDelivery(deliveryId: string): RealtimeDelivery | undefined {
        this.recheckDelivery();
        const delivery = this.delivery;
        if (
            delivery?.inspection.deliveryId !== deliveryId ||
            delivery.inspection.status !== 'requested' ||
            delivery.text === undefined
        )
            return undefined;
        const text = delivery.text;
        delete delivery.text;
        delivery.inspection.status = 'handed_off';
        delivery.inspection.handedOffAt = Date.now();
        return {
            ...delivery.inspection,
            handle: { ...delivery.inspection.handle },
            audienceIds: [...delivery.inspection.audienceIds],
            text,
        };
    }

    /** Accepts ordered observations for this handoff; reports never grant or restore permission. */
    reportPlayback(
        deliveryId: string,
        event: Exclude<RealtimeDeliveryStatus['playback'], 'not_reported'>
    ): boolean {
        this.recheckDelivery();
        const inspection = this.delivery?.inspection;
        if (
            inspection?.deliveryId !== deliveryId ||
            inspection.handedOffAt === undefined
        )
            return false;
        if (event === 'started') {
            if (inspection.playback !== 'not_reported') return false;
            inspection.startReportedAt = Date.now();
        } else if (event === 'completed') {
            if (inspection.playback !== 'started') return false;
        } else if (event === 'interrupted' || event === 'failed') {
            if (
                inspection.playback !== 'not_reported' &&
                inspection.playback !== 'started'
            )
                return false;
        } else return false;
        inspection.playback = event;
        clearTimeout(this.deliveryExpiry);
        return true;
    }

    private recheckDelivery(): void {
        const inspection = this.delivery?.inspection;
        if (
            !inspection ||
            inspection.status === 'revoked' ||
            inspection.status === 'expired'
        )
            return;
        if (
            !this.isDeliveryFresh(inspection.handle) ||
            !this.hasConsentingAudience() ||
            this.intent?.turnId !== inspection.turnId
        )
            this.revokeDelivery();
        else if (
            inspection.playback === 'not_reported' &&
            Date.now() >= inspection.expiresAt
        )
            this.revokeDelivery('expired');
    }

    private revokeDelivery(status: 'revoked' | 'expired' = 'revoked'): void {
        clearTimeout(this.deliveryExpiry);
        this.deliveryExpiry = undefined;
        if (this.delivery) {
            delete this.delivery.text;
            if (this.delivery.inspection.status !== 'expired')
                this.delivery.inspection.status = status;
        }
        this.deliveryEpoch += 1;
    }

    /** Requests a stop; only settlement releases the independent capacity reservation. */
    private cancelExecution(): void {
        this.revokeDelivery();
        if (executionReservation?.owner === this.instanceId)
            requestExecutionCancellation(executionReservation);
        this.completed = undefined;
    }

    /** Idempotently revokes handles and clears all ephemeral call content. */
    close(): void {
        if (this.closed) return;
        this.cancelExecution();
        this.delivery = undefined;
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
            this.cancelExecution();
            this.revision += 1;
            this.intent = { status: 'pending', turnId };
        } else if (action === 'cancel' && this.intent) {
            this.cancelExecution();
            this.revision += 1;
            this.intent = { ...this.intent, status: 'cancelled' };
        } else if (
            action === 'interrupt' &&
            this.intent?.status === 'pending'
        ) {
            this.revokeDelivery();
            this.intent.status = 'interrupted';
        } else if (
            action === 'continue' &&
            this.intent?.status === 'interrupted'
        ) {
            this.intent.status = 'pending';
        }
    }

    private holdDeliveryForAmbiguousSpeech(): void {
        this.revokeDelivery();
        if (this.intent?.status === 'pending')
            this.intent.status = 'interrupted';
    }

    private invalidateAudience(): void {
        this.cancelExecution();
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
