/**
 * @description: Verifies bounded session-local realtime conversation state and audience freshness.
 * @footnote-scope: test
 * @footnote-module: RealtimeConversationStateTests
 * @footnote-risk: medium - Regressions can reuse stale context or delivery handles.
 * @footnote-ethics: high - Audience and consent mistakes can expose prior speech.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeConversationState } from '../src/services/realtimeConversationState.js';

const consentingAudience = (ids: string[]) =>
    ids.map((id) => ({ id, displayName: id, processingConsent: true }));

test('audience changes clear context and invalidate old session freshness handles', () => {
    const state = new RealtimeConversationState('private-session-id');
    state.setAudience(consentingAudience(['alex']));
    const first = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'private question',
        intent: 'question',
    });
    assert.equal(first.accepted, true);
    assert.deepEqual(first.context?.messages, [
        { role: 'user', content: 'private question' },
    ]);
    assert.equal(state.isCurrent(first.handle), true);

    state.setAudience([
        ...consentingAudience(['alex']),
        { id: 'blair', displayName: 'blair', processingConsent: false },
    ]);
    assert.equal(state.isCurrent(first.handle), false);
    assert.deepEqual(state.snapshot().context.messages, []);
    const rejected = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'follow up',
        intent: 'question',
    });
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.reason, 'audience_consent_required');

    state.setAudience(consentingAudience(['alex']));
    const next = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'new question',
        intent: 'question',
    });
    assert.equal(next.accepted, true);
    assert.notEqual(next.turnId, first.turnId);
    assert.deepEqual(next.context?.messages, [
        { role: 'user', content: 'new question' },
    ]);
});

test('intent changes gate delivery while interruption preserves the reasoning revision', () => {
    const state = new RealtimeConversationState('session');
    state.setAudience(consentingAudience(['alex']));
    const question = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'compare these',
        intent: 'question',
    });
    assert.equal(question.accepted, true);
    if (!question.accepted) return;
    assert.equal(state.isDeliveryFresh(question.handle), true);

    const interruption = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'one moment',
        intent: 'interrupt',
    });
    assert.equal(interruption.accepted, true);
    assert.equal(state.isCurrent(question.handle), true);
    assert.equal(state.isDeliveryFresh(question.handle), false);
    const revision = state.snapshot().revision;
    const assistantContinuation = state.appendFinalizedTurn({
        role: 'assistant',
        speakerId: 'assistant',
        content: 'I will keep looking.',
        intent: 'continue',
    });
    assert.equal(assistantContinuation.accepted, true);
    assert.equal(state.snapshot().intent?.status, 'interrupted');
    assert.equal(state.isDeliveryFresh(question.handle), false);

    const continuation = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'yes, keep looking',
        intent: 'continue',
    });
    assert.equal(continuation.accepted, true);
    assert.equal(state.snapshot().revision, revision);
    assert.equal(state.isDeliveryFresh(question.handle), true);

    const cancelled = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'stop that',
        intent: 'cancel',
    });
    assert.equal(cancelled.accepted, true);
    assert.equal(state.isCurrent(question.handle), false);
    assert.equal(state.snapshot().intent?.status, 'cancelled');

    const replacement = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'new question',
        intent: 'question',
    });
    assert.equal(replacement.accepted, true);
    assert.equal(state.snapshot().intent?.status, 'pending');
    assert.notEqual(state.snapshot().intent?.turnId, question.turnId);
});

test('continue cannot revive a superseded or cancelled intent', () => {
    const state = new RealtimeConversationState('session');
    state.setAudience(consentingAudience(['alex']));
    const original = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'first question',
        intent: 'question',
    });
    assert.equal(original.accepted, true);
    const superseding = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'replacement question',
        intent: 'supersede',
    });
    assert.equal(superseding.accepted, true);
    assert.equal(state.isCurrent(original.handle), false);
    const supersededRevision = state.snapshot().revision;
    const lateSupersededContinue = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'continue the old question',
        intent: 'continue',
    });
    assert.equal(lateSupersededContinue.accepted, true);
    assert.equal(state.snapshot().revision, supersededRevision);
    assert.equal(state.snapshot().intent?.status, 'pending');

    state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'stop',
        intent: 'cancel',
    });
    const revision = state.snapshot().revision;
    const cancelledStatus = state.snapshot().intent?.status;
    const lateContinue = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'continue anyway',
        intent: 'continue',
    });
    assert.equal(lateContinue.accepted, true);
    assert.equal(state.snapshot().revision, revision);
    assert.equal(state.snapshot().intent?.status, cancelledStatus);
    assert.equal(state.isDeliveryFresh(lateContinue.handle), false);
});

test('explicit supersession advances freshness and assistant turns cannot replace intent', () => {
    const state = new RealtimeConversationState('session');
    state.setAudience(consentingAudience(['alex']));
    const first = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'compare today',
        intent: 'question',
    });
    assert.equal(first.accepted, true);
    if (!first.accepted) return;

    const second = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'actually compare tomorrow',
        intent: 'supersede',
    });
    assert.equal(second.accepted, true);
    assert.equal(state.isCurrent(first.handle), false);
    assert.equal(state.snapshot().intent?.turnId, second.turnId);

    const revision = state.snapshot().revision;
    state.appendFinalizedTurn({
        role: 'assistant',
        speakerId: 'assistant',
        content: 'I am checking the updated question.',
        intent: 'question',
    });
    assert.equal(state.snapshot().revision, revision);
    assert.equal(state.snapshot().intent?.turnId, second.turnId);
    assert.throws(
        () =>
            state.appendFinalizedTurn({
                role: 'user',
                speakerId: 'alex',
                content: 'bad action',
                intent: 'unsupported' as never,
            }),
        /intent is invalid/
    );
});

test('an oversized attributed correction holds the prior delivery without replacing intent', () => {
    const state = new RealtimeConversationState('session');
    state.setAudience(consentingAudience(['alex']));
    const question = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'compare the current options',
        intent: 'question',
    });
    assert.equal(question.accepted, true);
    if (!question.accepted) return;

    const correction = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'x'.repeat(16 * 1024 + 1),
        intent: 'supersede',
    });
    assert.deepEqual(
        correction.accepted ? null : correction.reason,
        'turn_too_large'
    );
    assert.equal(state.isCurrent(question.handle), true);
    assert.equal(state.isDeliveryFresh(question.handle), false);
    assert.equal(state.snapshot().intent?.turnId, question.turnId);
    assert.equal(state.snapshot().intent?.status, 'interrupted');
});

test('empty or malformed attributed cancel and interrupt content holds prior delivery', () => {
    const rejectedTurns = [
        { content: '', intent: 'cancel' as const },
        { content: 42 as never, intent: 'interrupt' as const },
    ];
    for (const rejectedTurn of rejectedTurns) {
        const state = new RealtimeConversationState('session');
        state.setAudience(consentingAudience(['alex']));
        const question = state.appendFinalizedTurn({
            role: 'user',
            speakerId: 'alex',
            content: 'current question',
            intent: 'question',
        });
        assert.equal(question.accepted, true);
        if (!question.accepted) continue;

        assert.throws(() =>
            state.appendFinalizedTurn({
                role: 'user',
                speakerId: 'alex',
                ...rejectedTurn,
            })
        );
        assert.equal(state.isCurrent(question.handle), true);
        assert.equal(state.isDeliveryFresh(question.handle), false);
        assert.equal(state.snapshot().intent?.turnId, question.turnId);
        assert.equal(state.snapshot().intent?.status, 'interrupted');
    }
});

test('consent revocation and regrant never restore the earlier audience context', () => {
    const state = new RealtimeConversationState('session');
    state.setAudience(consentingAudience(['alex']));
    const oldTurn = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'before revocation',
        intent: 'question',
    });
    assert.equal(oldTurn.accepted, true);

    state.setAudience([
        { id: 'alex', displayName: 'alex', processingConsent: false },
    ]);
    assert.deepEqual(state.snapshot().context.messages, []);
    assert.equal(state.isCurrent(oldTurn.handle), false);
    assert.equal(
        state.appendFinalizedTurn({
            role: 'user',
            speakerId: 'alex',
            content: 'withdrawn',
            intent: 'question',
        }).accepted,
        false
    );

    state.setAudience(consentingAudience(['alex']));
    const afterRegrant = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'after regrant',
        intent: 'question',
    });
    assert.equal(afterRegrant.accepted, true);
    assert.deepEqual(afterRegrant.context?.messages, [
        { role: 'user', content: 'after regrant' },
    ]);
});

test('unresolved speakers are rejected and snapshots are bounded and detached', () => {
    const state = new RealtimeConversationState('session');
    state.setAudience(consentingAudience(['alex']));
    const unresolved = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'unknown',
        content: 'do not guess',
        intent: 'question',
    });
    assert.deepEqual(
        unresolved.accepted ? null : unresolved.reason,
        'speaker_unresolved'
    );

    const first = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'first',
        intent: 'question',
    });
    assert.equal(first.accepted, true);
    if (!first.accepted) return;
    const stableId = first.context.contextEnvelope.turns[0]?.turnId;
    assert.ok(stableId);
    const snapshot = state.snapshot();
    snapshot.context.messages[0]!.content = 'mutated by caller';
    snapshot.context.contextEnvelope.participants[0]!.speakerLabel = 'changed';
    snapshot.context.contextEnvelope.diagnostics.projectedMessageCount = 500;
    assert.deepEqual(state.snapshot().context.messages[0]?.content, 'first');
    assert.equal(
        state.snapshot().context.contextEnvelope.participants[0]?.speakerLabel,
        'alex'
    );
    assert.equal(
        state.snapshot().context.contextEnvelope.diagnostics
            .projectedMessageCount,
        1
    );

    for (let index = 0; index < 12; index += 1) {
        state.appendFinalizedTurn({
            role: 'user',
            speakerId: 'alex',
            content: `turn ${index}`,
            intent: 'attention',
        });
    }
    const bounded = state.snapshot().context.contextEnvelope.turns;
    assert.equal(bounded.length, 12);
    assert.notEqual(bounded.at(-1)?.turnId, stableId);
    assert.equal(new Set(bounded.map((turn) => turn.turnId)).size, 12);
});

test('UTF-8 byte limits trim oldest context and reject a single oversized turn', () => {
    const state = new RealtimeConversationState('session');
    state.setAudience(consentingAudience(['alex']));
    const tooLarge = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: '🧪'.repeat(4097),
        intent: 'question',
    });
    assert.deepEqual(
        tooLarge.accepted ? null : tooLarge.reason,
        'turn_too_large'
    );
    assert.deepEqual(state.snapshot().context.messages, []);

    const first = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'a'.repeat(8192),
        intent: 'question',
    });
    assert.equal(first.accepted, true);
    if (!first.accepted) return;
    const second = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'b'.repeat(8192),
        intent: 'attention',
    });
    assert.equal(second.accepted, true);
    if (!second.accepted) return;
    assert.equal(second.context.contextEnvelope.turns.length, 2);
    assert.equal(second.context.contextEnvelope.turns[0]?.turnId, first.turnId);

    const third = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'c',
        intent: 'attention',
    });
    assert.equal(third.accepted, true);
    if (!third.accepted) return;
    assert.deepEqual(
        third.context.contextEnvelope.turns.map((turn) => turn.turnId),
        [second.turnId, third.turnId]
    );
    assert.deepEqual(
        third.context.messages.map((message) => message.content),
        ['b'.repeat(8192), 'c']
    );
});

test('multiple consenting speakers are labeled and invalid rosters revoke state', () => {
    const state = new RealtimeConversationState('session');
    state.setAudience(consentingAudience(['alex', 'blair']));
    const first = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'first speaker',
        intent: 'question',
    });
    assert.equal(first.accepted, true);
    const second = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'blair',
        content: 'second speaker',
        intent: 'attention',
    });
    assert.equal(second.accepted, true);
    if (!second.accepted) return;
    assert.deepEqual(second.context.messages, [
        { role: 'user', content: '[alex] first speaker' },
        { role: 'user', content: '[blair] second speaker' },
    ]);
    const prior = state.snapshot();
    state.setAudience(consentingAudience(['blair', 'alex']));
    assert.equal(state.isCurrent(second.handle), true);
    assert.deepEqual(state.snapshot().context.messages, prior.context.messages);
    assert.throws(
        () => state.setAudience(consentingAudience(['alex', 'alex'])),
        /metadata is invalid/
    );
    assert.deepEqual(state.snapshot().context.messages, []);
    assert.equal(state.isCurrent(second.handle), false);
    assert.notDeepEqual(
        state.snapshot().context.messages,
        prior.context.messages
    );
    assert.throws(
        () =>
            state.setAudience(
                consentingAudience(
                    Array.from({ length: 33 }, (_, index) => `${index}`)
                )
            ),
        /participant limit/
    );
    assert.deepEqual(state.snapshot().context.messages, []);
});

test('sparse audience rosters revoke prior context and fail closed', () => {
    const state = new RealtimeConversationState('session');
    state.setAudience(consentingAudience(['alex']));
    const question = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'private context',
        intent: 'question',
    });
    assert.equal(question.accepted, true);
    if (!question.accepted) return;

    const sparseRoster = new Array<
        ReturnType<typeof consentingAudience>[number]
    >(1);
    assert.throws(() => state.setAudience(sparseRoster));
    assert.equal(state.isCurrent(question.handle), false);
    assert.deepEqual(state.snapshot().context.messages, []);
    const rejected = state.appendFinalizedTurn({
        role: 'assistant',
        speakerId: 'assistant',
        content: 'must not be accepted',
    });
    assert.equal(rejected.accepted, false);
    assert.equal(
        rejected.accepted ? null : rejected.reason,
        'audience_consent_required'
    );
});

test('ambiguous speech cannot be routed under a guessed speaker identity', () => {
    const state = new RealtimeConversationState('session');
    state.setAudience(consentingAudience(['alex']));
    const question = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'answer this',
        intent: 'question',
    });
    assert.equal(question.accepted, true);
    if (!question.accepted) return;
    const ambiguous = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'unresolved',
        content: 'maybe stop',
        intent: 'cancel',
    });
    assert.deepEqual(
        ambiguous.accepted ? null : ambiguous.reason,
        'speaker_unresolved'
    );
    assert.equal(state.isCurrent(question.handle), true);
    assert.equal(state.isDeliveryFresh(question.handle), false);
    assert.equal(state.snapshot().intent?.status, 'interrupted');
});

test('freshness is isolated per call and close is idempotent and clears content', () => {
    const firstSession = new RealtimeConversationState('same-correlation');
    const secondSession = new RealtimeConversationState('same-correlation');
    firstSession.setAudience(consentingAudience(['alex']));
    const turn = firstSession.appendFinalizedTurn({
        role: 'user',
        speakerId: 'alex',
        content: 'private',
        intent: 'question',
    });
    assert.equal(turn.accepted, true);
    assert.equal(secondSession.isCurrent(turn.handle), false);

    firstSession.close();
    firstSession.close();
    assert.deepEqual(firstSession.snapshot().context.messages, []);
    assert.equal(firstSession.isCurrent(turn.handle), false);
    assert.equal(
        firstSession.appendFinalizedTurn({
            role: 'user',
            speakerId: 'alex',
            content: 'late',
        }).accepted,
        false
    );
});
