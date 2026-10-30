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
import type { RealtimeWorkflowResult } from '../src/services/realtimeConversationState.js';

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

const approved = (): RealtimeWorkflowResult => ({
    responseId: 'response-one',
    runId: 'run-one',
    status: 'completed',
    finalResponse: {
        disposition: 'approved',
        responseId: 'response-one',
        runId: 'run-one',
        candidateId: 'candidate-one',
        generationStepId: 'step-one',
        assessmentStepId: 'step-two',
        text: 'PRIVATE ANSWER',
    },
});

test('the delivery slot enforces its own 16 KiB UTF-8 bound for every runner', async () => {
    for (const [text, fits] of [
        ['x'.repeat(16 * 1024), true],
        ['x'.repeat(16 * 1024 + 1), false],
        ['é'.repeat(8 * 1024), true],
        ['é'.repeat(8 * 1024) + 'x', false],
    ] as const) {
        const state = call();
        try {
            state.startExecution({
                runRealtimeConversation: async (_snapshot, context) => {
                    context.onRunStarted('run-one');
                    const result = approved();
                    assert.ok(result.finalResponse?.disposition === 'approved');
                    result.finalResponse.text = text;
                    return result;
                },
            });
            await flush();
            const ready = state.deliveryStatus();
            assert.equal(
                ready !== undefined,
                fits,
                `${Buffer.byteLength(text, 'utf8')} bytes`
            );
            if (ready) {
                assert.ok(state.requestDelivery(ready.handle));
                assert.equal(state.startDelivery(ready.deliveryId)?.text, text);
            }
            assert.equal(state.completedExecution()?.status, 'completed');
            assert.equal(
                state.completedExecution()?.reviewDisposition,
                'approved'
            );
            assert.equal(state.executionStatus().occupied, false);
        } finally {
            state.close();
        }
    }
});

test('requesting and handing off an answer do not report audible completion', async () => {
    const state = call();
    state.startExecution({
        runRealtimeConversation: async (_snapshot, context) => {
            context.onRunStarted('run-one');
            return approved();
        },
    });
    await flush();
    const ready = state.deliveryStatus();
    assert.equal(ready?.status, 'ready');
    assert.equal(ready?.playback, 'not_reported');
    assert.doesNotMatch(JSON.stringify(ready), /PRIVATE ANSWER/);
    assert.ok(ready);
    const request = state.requestDelivery(ready.handle);
    assert.equal(request?.status, 'requested');
    assert.doesNotMatch(JSON.stringify(request), /PRIVATE ANSWER/);
    assert.equal(state.requestDelivery(ready.handle), undefined);
    const delivery = state.startDelivery(ready.deliveryId);
    assert.equal(delivery?.text, 'PRIVATE ANSWER');
    assert.equal(state.deliveryStatus()?.status, 'handed_off');
    assert.equal(state.deliveryStatus()?.playback, 'not_reported');
    assert.equal(state.startDelivery(ready.deliveryId), undefined);
    assert.equal(state.reportPlayback(ready.deliveryId, 'completed'), false);
    assert.equal(state.reportPlayback(ready.deliveryId, 'started'), true);
    assert.equal(state.deliveryStatus()?.playback, 'started');
    assert.equal(state.reportPlayback(ready.deliveryId, 'started'), false);
    assert.equal(state.reportPlayback(ready.deliveryId, 'completed'), true);
    assert.equal(state.reportPlayback(ready.deliveryId, 'completed'), false);
    assert.equal(state.deliveryStatus()?.playback, 'completed');
    assert.equal(state.completedExecution()?.status, 'completed');
    assert.equal(state.completedExecution()?.reviewDisposition, 'approved');
    state.close();
});

const readyAnswer = async () => {
    const state = call();
    state.startExecution({
        runRealtimeConversation: async (_snapshot, context) => {
            context.onRunStarted('run-one');
            return approved();
        },
    });
    await flush();
    const ready = state.deliveryStatus();
    assert.ok(ready);
    return { state, ready };
};

test('expiration is rechecked without waiting for the timer, including after a pending handoff', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    for (const phase of ['ready', 'requested', 'handed_off'] as const) {
        t.mock.timers.setTime(1000);
        const { state, ready } = await readyAnswer();
        if (phase !== 'ready') state.requestDelivery(ready.handle);
        if (phase === 'handed_off') state.startDelivery(ready.deliveryId);
        t.mock.timers.setTime(31_000);
        assert.equal(state.requestDelivery(ready.handle), undefined, phase);
        assert.equal(state.startDelivery(ready.deliveryId), undefined, phase);
        assert.equal(state.deliveryStatus()?.status, 'expired');
        assert.equal(state.deliveryStatus()?.playback, 'not_reported');
        if (phase === 'handed_off') {
            assert.equal(
                state.reportPlayback(ready.deliveryId, 'started'),
                true
            );
            assert.equal(state.deliveryStatus()?.status, 'expired');
            assert.equal(state.deliveryStatus()?.playback, 'started');
            assert.equal(state.startDelivery(ready.deliveryId), undefined);
        }
        state.close();
    }
});

test('a controlled playback request that expires while waiting never receives text', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const { state, ready } = await readyAnswer();
    const release = deferred<void>();
    const request = state.requestDelivery(ready.handle);
    assert.ok(request);
    const playback = release.promise.then(() =>
        state.startDelivery(request.deliveryId)
    );
    t.mock.timers.tick(30_000);
    release.resolve();
    assert.equal(await playback, undefined);
    assert.equal(state.deliveryStatus()?.status, 'expired');
    assert.equal(state.deliveryStatus()?.playback, 'not_reported');
    assert.equal(state.reportPlayback(request.deliveryId, 'started'), false);
    state.close();
});

test('revocation before and during playback preserves observations without confirming a stop', async () => {
    for (const event of [
        'interrupt',
        'cancel',
        'supersede',
        'audience',
        'consent',
        'disconnect',
    ] as const) {
        for (const phase of ['requested', 'handed_off', 'started'] as const) {
            const { state, ready } = await readyAnswer();
            state.requestDelivery(ready.handle);
            if (phase !== 'requested') state.startDelivery(ready.deliveryId);
            if (phase === 'started')
                state.reportPlayback(ready.deliveryId, 'started');
            if (event === 'disconnect') state.close();
            else if (event === 'audience' || event === 'consent')
                state.setAudience([
                    {
                        id: 'human',
                        displayName: 'Human',
                        processingConsent: event !== 'consent',
                    },
                    ...(event === 'audience'
                        ? [
                              {
                                  id: 'other',
                                  displayName: 'Other',
                                  processingConsent: true,
                              },
                          ]
                        : []),
                ]);
            else
                state.appendFinalizedTurn({
                    role: 'user',
                    speakerId: 'human',
                    content: 'Changed',
                    intent: event,
                });
            assert.equal(state.startDelivery(ready.deliveryId), undefined);
            assert.equal(state.requestDelivery(ready.handle), undefined);
            if (event === 'disconnect') {
                assert.equal(state.deliveryStatus(), undefined);
                assert.equal(
                    state.reportPlayback(ready.deliveryId, 'interrupted'),
                    false
                );
            } else {
                const revoked = state.deliveryStatus();
                assert.equal(revoked?.status, 'revoked', `${event} ${phase}`);
                assert.equal(
                    revoked?.playback,
                    phase === 'started' ? 'started' : 'not_reported'
                );
                assert.equal(
                    revoked?.startReportedAt !== undefined,
                    phase === 'started'
                );
                assert.equal(
                    state.reportPlayback(ready.deliveryId, 'interrupted'),
                    phase !== 'requested'
                );
                assert.equal(state.deliveryStatus()?.status, 'revoked');
                assert.equal(
                    state.reportPlayback(ready.deliveryId, 'started'),
                    false
                );
                if (event === 'interrupt')
                    state.appendFinalizedTurn({
                        role: 'user',
                        speakerId: 'human',
                        content: 'Continue',
                        intent: 'continue',
                    });
                assert.equal(state.requestDelivery(ready.handle), undefined);
                assert.equal(state.startDelivery(ready.deliveryId), undefined);
            }
            state.close();
        }
    }
});

test('reported playback can finish after the start deadline without extending retained text', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const { state, ready } = await readyAnswer();
    state.requestDelivery(ready.handle);
    t.mock.timers.tick(29_999);
    assert.ok(state.startDelivery(ready.deliveryId));
    assert.equal(state.reportPlayback(ready.deliveryId, 'started'), true);
    t.mock.timers.tick(30_000);
    assert.equal(state.deliveryStatus()?.status, 'handed_off');
    assert.equal(state.reportPlayback(ready.deliveryId, 'completed'), true);
    assert.equal(state.deliveryStatus()?.playback, 'completed');
    assert.doesNotMatch(
        JSON.stringify(state.deliveryStatus()),
        /PRIVATE ANSWER/
    );
    assert.equal(state.startDelivery(ready.deliveryId), undefined);
    state.close();
});

test('late completion reports cannot undo revocation or affect a later delivery', async () => {
    const { state, ready } = await readyAnswer();
    state.requestDelivery(ready.handle);
    state.startDelivery(ready.deliveryId);
    state.reportPlayback(ready.deliveryId, 'started');
    const finished = deferred<void>();
    const completion = finished.promise.then(() =>
        state.reportPlayback(ready.deliveryId, 'completed')
    );
    state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'human',
        content: 'Pause',
        intent: 'interrupt',
    });
    assert.equal(state.deliveryStatus()?.playback, 'started');
    finished.resolve();
    assert.equal(await completion, true);
    assert.equal(state.deliveryStatus()?.status, 'revoked');
    assert.equal(state.deliveryStatus()?.playback, 'completed');
    assert.equal(state.completedExecution()?.reviewDisposition, 'approved');
    state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'human',
        content: 'New question',
        intent: 'question',
    });
    state.startExecution({
        runRealtimeConversation: async (_snapshot, context) => {
            context.onRunStarted('run-one');
            return approved();
        },
    });
    await flush();
    const next = state.deliveryStatus();
    assert.ok(next);
    assert.notEqual(next.deliveryId, ready.deliveryId);
    assert.equal(state.reportPlayback(ready.deliveryId, 'started'), false);
    assert.equal(state.reportPlayback(ready.deliveryId, 'completed'), false);
    assert.equal(state.startDelivery(ready.deliveryId), undefined);
    assert.equal(state.deliveryStatus()?.playback, 'not_reported');
    assert.equal(state.deliveryStatus()?.status, 'ready');
    state.close();
});

test('interrupted and failed reports distinguish an unconfirmed start from partial playback', async () => {
    for (const event of ['interrupted', 'failed'] as const) {
        for (const started of [false, true]) {
            const { state, ready } = await readyAnswer();
            assert.equal(state.reportPlayback(ready.deliveryId, event), false);
            state.requestDelivery(ready.handle);
            assert.equal(
                state.reportPlayback(ready.deliveryId, 'started'),
                false
            );
            assert.equal(state.startDelivery('unknown'), undefined);
            state.startDelivery(ready.deliveryId);
            if (started) state.reportPlayback(ready.deliveryId, 'started');
            assert.equal(state.reportPlayback('unknown', event), false);
            assert.equal(state.reportPlayback(ready.deliveryId, event), true);
            assert.equal(state.deliveryStatus()?.playback, event);
            assert.equal(
                state.deliveryStatus()?.startReportedAt !== undefined,
                started
            );
            assert.equal(state.reportPlayback(ready.deliveryId, event), false);
            assert.equal(
                state.reportPlayback(ready.deliveryId, 'started'),
                false
            );
            assert.equal(
                state.reportPlayback(ready.deliveryId, 'completed'),
                false
            );
            assert.equal(state.startDelivery(ready.deliveryId), undefined);
            state.close();
        }
    }
});

test('late completion cannot restore speech after interruption, cancellation, audience changes or disconnect', async () => {
    for (const event of [
        'interrupt',
        'ambiguous',
        'cancel',
        'supersede',
        'audience',
        'consent',
        'disconnect',
    ] as const) {
        for (const when of ['pending', 'staged'] as const) {
            const state = call();
            const handle = state.appendFinalizedTurn({
                role: 'user',
                speakerId: 'human',
                content: 'Answer',
                intent: 'question',
            }).handle;
            const work = deferred<RealtimeWorkflowResult>();
            let signal: AbortSignal | undefined;
            state.startExecution({
                runRealtimeConversation: async (_snapshot, context) => {
                    signal = context.signal;
                    context.onRunStarted('run-one');
                    return work.promise;
                },
            });
            await flush();
            if (when === 'staged') {
                work.resolve(approved());
                await flush();
            }
            if (event === 'disconnect') state.close();
            else if (event === 'audience' || event === 'consent')
                state.setAudience([
                    {
                        id: 'human',
                        displayName: 'Human',
                        processingConsent: event !== 'consent',
                    },
                    ...(event === 'audience'
                        ? [
                              {
                                  id: 'other',
                                  displayName: 'Other',
                                  processingConsent: true,
                              },
                          ]
                        : []),
                ]);
            else
                state.appendFinalizedTurn({
                    role: 'user',
                    speakerId: event === 'ambiguous' ? 'unknown' : 'human',
                    content: 'Changed',
                    intent: event === 'ambiguous' ? 'attention' : event,
                });
            if (event === 'interrupt' || event === 'ambiguous') {
                assert.equal(signal?.aborted, false);
                state.appendFinalizedTurn({
                    role: 'user',
                    speakerId: 'human',
                    content: 'Continue',
                    intent: 'continue',
                });
            }
            if (when === 'pending') {
                work.resolve(approved());
                await flush();
            }
            assert.equal(
                state.requestDelivery(handle),
                undefined,
                `${event} ${when}`
            );
            assert.equal(
                state.requestDelivery({
                    ...handle,
                    revision: state.snapshot().revision,
                }),
                undefined
            );
            state.close();
        }
    }
});

test('a staged answer expires at thirty seconds and the settled Run outcome is preserved', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
    const state = call();
    const handle = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'human',
        content: 'Answer',
        intent: 'question',
    }).handle;
    state.startExecution({
        runRealtimeConversation: async (_snapshot, context) => {
            context.onRunStarted('run-one');
            return approved();
        },
    });
    await flush();
    t.mock.timers.tick(30_000);
    assert.equal(state.requestDelivery(handle), undefined);
    assert.equal(state.completedExecution()?.status, 'completed');
    assert.equal(state.completedExecution()?.reviewDisposition, 'approved');
    state.close();
});

test('missing evidence, wrong canonical identity and a degraded outcome never stage speech', async () => {
    for (const change of [
        'missing',
        'run',
        'response',
        'degraded',
        'unassessed',
    ] as const) {
        const state = call();
        const handle = state.appendFinalizedTurn({
            role: 'user',
            speakerId: 'human',
            content: 'Answer',
            intent: 'question',
        }).handle;
        const result = approved();
        if (change === 'missing') delete result.finalResponse;
        if (change === 'run') result.runId = 'different-run';
        if (change === 'response') result.responseId = 'different-response';
        if (change === 'degraded') result.status = 'degraded';
        if (change === 'unassessed')
            result.finalResponse = { disposition: 'unassessed' };
        state.startExecution({
            runRealtimeConversation: async (_snapshot, context) => {
                context.onRunStarted('run-one');
                return result;
            },
        });
        await flush();
        assert.equal(state.requestDelivery(handle), undefined, change);
        state.close();
    }
});

test('a reviewed final answer occupies one ephemeral slot and can be taken only once', async () => {
    const state = call();
    const handle = state.appendFinalizedTurn({
        role: 'user',
        speakerId: 'human',
        content: 'Please answer',
        intent: 'question',
    }).handle;
    state.startExecution({
        runRealtimeConversation: async (_snapshot, context) => {
            context.onRunStarted('run-one');
            return {
                responseId: 'response-one',
                runId: 'run-one',
                status: 'completed',
                finalResponse: {
                    disposition: 'approved',
                    responseId: 'response-one',
                    runId: 'run-one',
                    candidateId: 'candidate-one',
                    generationStepId: 'step-one',
                    assessmentStepId: 'step-two',
                    text: 'PRIVATE ANSWER',
                },
            };
        },
    });
    await flush();
    assert.doesNotMatch(
        JSON.stringify(state.completedExecution()),
        /PRIVATE ANSWER/
    );
    assert.equal(
        state.requestDelivery({ ...handle, sessionCorrelationId: 'other' }),
        undefined
    );
    const request = state.requestDelivery(handle);
    assert.ok(request);
    const delivery = state.startDelivery(request.deliveryId);
    assert.equal(delivery?.text, 'PRIVATE ANSWER');
    assert.equal(delivery?.turnId, state.snapshot().intent?.turnId);
    assert.equal(delivery?.responseId, 'response-one');
    assert.equal(state.requestDelivery(handle), undefined);
    state.close();
});

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
