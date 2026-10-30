/**
 * @description: Exercises ephemeral call execution and process-owned capacity with synthetic work.
 * @footnote-scope: test
 * @footnote-module: RealtimeWorkflowExecutionTests
 * @footnote-risk: high - Races can release unresolved capacity or retain private call content.
 * @footnote-ethics: high - Consent changes must revoke voice work without inventing a confirmed stop.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { RealtimeConversationState } from '../src/services/realtimeConversationState.js';

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const call = (id = 'call-one') => {
    const state = new RealtimeConversationState(id);
    state.setAudience([
        { id: 'human', displayName: 'Human', processingConsent: true },
    ]);
    state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'human',
        content: 'PRIVATE QUESTION',
        intent: 'question',
    });
    return state;
};
const flush = async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
};

test('one background execution leaves conversation responsive and rejects duplicates', async () => {
    const work = deferred<{
        responseId: string;
        runId: string;
        status: 'completed';
    }>();
    const state = call();
    let starts = 0;
    const runner = {
        runRealtimeConversation: async () => {
            starts += 1;
            return work.promise;
        },
    };
    assert.equal(state.startExecution(runner).accepted, true);
    assert.deepEqual(state.startExecution(runner), {
        accepted: false,
        reason: 'duplicate',
    });
    assert.equal(
        state.appendFinalizedTurn({
            role: 'user',
            speakerId: 'human',
            content: 'Still here',
            intent: 'attention',
        }).accepted,
        true
    );
    await flush();
    assert.equal(starts, 1);
    assert.equal(state.executionStatus().occupied, true);
    work.resolve({
        responseId: 'response-one',
        runId: 'run-one',
        status: 'completed',
    });
    await flush();
    assert.equal(state.executionStatus().occupied, false);
    assert.deepEqual(state.completedExecution(), {
        status: 'completed',
        responseId: 'response-one',
        runId: 'run-one',
    });
    state.close();
});

test('disconnect clears content but a cancellation-ignoring Run blocks reconnects and degrades', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const work = deferred<{ responseId: string; runId: string }>();
    let signal: AbortSignal | undefined;
    const runner = {
        runRealtimeConversation: async (
            _snapshot: unknown,
            context: { signal: AbortSignal; onRunStarted: (id: string) => void }
        ) => {
            signal = context.signal;
            context.onRunStarted('canonical-run');
            return work.promise;
        },
    };
    const first = call();
    first.startExecution(runner);
    await flush();
    first.close();
    assert.equal(signal?.aborted, true);
    assert.deepEqual(first.snapshot().context.messages, []);
    const reconnect = call('new-session');
    assert.deepEqual(reconnect.startExecution(runner), {
        accepted: false,
        reason: 'occupied',
    });
    t.mock.timers.tick(5000);
    const inspection = reconnect.executionStatus();
    assert.equal(inspection.occupied, true);
    if (!inspection.occupied) throw new Error('Reservation was released');
    assert.equal(inspection.status, 'degraded');
    assert.equal(inspection.cancellationRequestedAt, 1000);
    assert.equal(inspection.ageMs, 5000);
    assert.equal(inspection.runId, 'canonical-run');
    assert.equal(
        JSON.stringify(inspection).includes('PRIVATE QUESTION'),
        false
    );
    assert.deepEqual(reconnect.startExecution(runner), {
        accepted: false,
        reason: 'degraded',
    });
    assert.equal(
        reconnect.appendFinalizedTurn({
            role: 'user',
            speakerId: 'human',
            content: 'Stop',
            intent: 'cancel',
        }).accepted,
        true
    );
    assert.equal(reconnect.executionStatus().occupied, true);
    work.resolve({ responseId: 'late-response', runId: 'canonical-run' });
    await flush();
    assert.equal(first.completedExecution(), undefined);
    assert.equal(reconnect.executionStatus().occupied, false);
    reconnect.close();
});

test('an independent finite deadline degrades never-settling work until actual settlement', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const work = deferred<{ responseId: string }>();
    const state = call();
    let signal: AbortSignal | undefined;
    state.startExecution({
        runRealtimeConversation: async (_snapshot, context) => {
            signal = context.signal;
            return work.promise;
        },
    });
    await flush();
    t.mock.timers.tick(59_999);
    assert.equal(signal?.aborted, false);
    t.mock.timers.tick(1);
    const inspection = state.executionStatus();
    assert.equal(inspection.occupied, true);
    if (!inspection.occupied) throw new Error('Lost reservation');
    assert.equal(inspection.deadlineAt, 61_000);
    assert.equal(inspection.degradedReason, 'execution_deadline_exceeded');
    assert.equal(signal?.aborted, true);
    work.resolve({ responseId: 'expired' });
    await flush();
    assert.equal(state.completedExecution(), undefined);
    assert.equal(state.executionStatus().occupied, false);
    state.close();
});

test('consent withdrawal, invalid rosters, supersession and cancellation abort without releasing capacity', async () => {
    for (const change of [
        (state: RealtimeConversationState) =>
            state.setAudience([
                { id: 'human', displayName: 'Human', processingConsent: false },
            ]),
        (state: RealtimeConversationState) => {
            assert.throws(() => state.setAudience(new Array(1)));
        },
        (state: RealtimeConversationState) =>
            state.appendFinalizedTurn({
                role: 'user',
                speakerId: 'human',
                content: 'Correction',
                intent: 'supersede',
            }),
        (state: RealtimeConversationState) =>
            state.appendFinalizedTurn({
                role: 'user',
                speakerId: 'human',
                content: 'Cancel',
                intent: 'cancel',
            }),
    ]) {
        const state = call();
        const work = deferred<{ responseId: string }>();
        let signal: AbortSignal | undefined;
        state.startExecution({
            runRealtimeConversation: async (_snapshot, context) => {
                signal = context.signal;
                return work.promise;
            },
        });
        await flush();
        change(state);
        assert.equal(signal?.aborted, true);
        assert.equal(state.executionStatus().occupied, true);
        work.resolve({ responseId: 'obsolete' });
        await flush();
        assert.equal(state.completedExecution(), undefined);
        assert.equal(state.executionStatus().occupied, false);
        state.close();
    }
});

test('same-tick cancellation prevents dispatch and errors settle capacity without reviving obsolete work', async () => {
    const state = call();
    let starts = 0;
    state.startExecution({
        runRealtimeConversation: async () => {
            starts += 1;
            throw new Error('PRIVATE ERROR');
        },
    });
    state.close();
    await flush();
    assert.equal(starts, 0);
    assert.equal(state.completedExecution(), undefined);
    const next = call('next');
    next.startExecution({
        runRealtimeConversation: () => {
            throw new Error('PRIVATE ERROR');
        },
    });
    await flush();
    assert.equal(next.executionStatus().occupied, false);
    assert.equal(next.completedExecution()?.status, 'failed');
    assert.equal(
        JSON.stringify(next.completedExecution()).includes('PRIVATE'),
        false
    );
    next.close();
});

test('interruption preserves the execution and explicit continuation permits only identity completion', async () => {
    const state = call();
    const work = deferred<{
        responseId: string;
        runId: string;
        status: 'completed';
    }>();
    let signal: AbortSignal | undefined;
    state.startExecution({
        runRealtimeConversation: async (_snapshot, context) => {
            signal = context.signal;
            return work.promise;
        },
    });
    await flush();
    const interruption = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'human',
        content: 'One moment',
        intent: 'interrupt',
    });
    assert.equal(signal?.aborted, false);
    assert.equal(state.isDeliveryFresh(interruption.handle), false);
    state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'human',
        content: 'Keep looking',
        intent: 'continue',
    });
    assert.equal(signal?.aborted, false);
    work.resolve({ responseId: 'complete', runId: 'run', status: 'completed' });
    await flush();
    assert.deepEqual(state.completedExecution(), {
        responseId: 'complete',
        runId: 'run',
        status: 'completed',
    });
    assert.deepEqual(
        state.startExecution({ runRealtimeConversation: async () => ({}) }),
        { accepted: false, reason: 'duplicate' }
    );
    state.close();
});

test('trimming away the initiating question prevents execution admission', async () => {
    const state = call();
    for (let i = 0; i < 12; i += 1)
        state.appendFinalizedTurn({
            role: 'user',
            speakerId: 'human',
            content: `Attention ${i}`,
            intent: 'attention',
        });
    assert.deepEqual(
        state.startExecution({ runRealtimeConversation: async () => ({}) }),
        { accepted: false, reason: 'intent_unavailable' }
    );
    state.close();
    await flush();
});

test('completion retains only canonical identity even if a runner returns extra content', async () => {
    const state = call();
    state.startExecution({
        runRealtimeConversation: async () => ({
            responseId: 'response',
            runId: 'run',
            status: 'completed' as const,
            message: 'PRIVATE RESPONSE',
            transcript: 'PRIVATE QUESTION',
        }),
    });
    await flush();
    assert.deepEqual(state.completedExecution(), {
        responseId: 'response',
        runId: 'run',
        status: 'completed',
    });
    state.close();
});

test('a settled execution without an explicit canonical receipt cannot report completion', async () => {
    for (const result of [
        {},
        { status: 'completed' as const },
        { responseId: 'response', runId: 'run' },
        { status: 'completed' as const, responseId: 'response' },
    ]) {
        const state = call();
        assert.equal(
            state.startExecution({
                runRealtimeConversation: async () => result,
            }).accepted,
            true
        );
        await flush();
        assert.equal(state.executionStatus().occupied, false);
        assert.equal(state.completedExecution()?.status, 'failed');
        state.close();
    }
});

test('a truly never-settling Run stays reserved across repeated reconnects after watchdog expiry', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const original = call();
    original.startExecution({
        runRealtimeConversation: () => new Promise(() => undefined),
    });
    await flush();
    original.close();
    t.mock.timers.tick(120_000);
    for (let index = 0; index < 3; index += 1) {
        const reconnect = call(`reconnect-${index}`);
        let replacementStarted = false;
        assert.deepEqual(
            reconnect.startExecution({
                runRealtimeConversation: async () => {
                    replacementStarted = true;
                    return {};
                },
            }),
            { accepted: false, reason: 'degraded' }
        );
        assert.equal(replacementStarted, false);
        assert.equal(
            reconnect.appendFinalizedTurn({
                role: 'user',
                speakerId: 'human',
                content: 'Status please',
                intent: 'attention',
            }).accepted,
            true
        );
        reconnect.close();
        assert.deepEqual(reconnect.snapshot().context.messages, []);
        assert.doesNotMatch(
            JSON.stringify(reconnect.executionStatus()),
            /PRIVATE QUESTION|Status please|Human/u
        );
    }
    assert.equal(original.executionStatus().occupied, true);
});
