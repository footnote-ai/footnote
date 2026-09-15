/**
 * @description: Verifies the shared response-footnote semantic projection and action availability states.
 * @footnote-scope: test
 * @footnote-module: ResponseFootnoteProjectionTests
 * @footnote-risk: low - Tests only serializable projection behavior with synthetic metadata.
 * @footnote-ethics: high - Prevents presentation layers from inventing provenance, posture, or artifact availability.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResponseFootnote } from '../src/policy/responseFootnote.js';
import {
    projectResponseFootnote,
    type ResponseFootnoteArtifactAvailability,
} from '../src/policy/responseFootnote.js';
import fixtures from './fixtures/response-footnote.json' with { type: 'json' };

const toFootnote = (value: unknown): ResponseFootnote =>
    value as ResponseFootnote;

const liveArtifacts: ResponseFootnoteArtifactAvailability = {
    trace: 'unknown',
    report: 'unavailable',
};

test('projects complete facts with final TRACE values and separate targets', () => {
    const metadata = {
        ...toFootnote(fixtures.complete),
        internalSecret: 'must not enter the render projection',
    };
    const projection = projectResponseFootnote({
        metadata,
        artifacts: liveArtifacts,
    });

    assert.equal(projection.status, 'available');
    assert.equal(projection.facts?.licenseContext, 'Recorded fixture license');
    assert.equal(
        'internalSecret' in (projection.facts ?? {}),
        false,
        'render facts must stay bounded to canonical footnote keys'
    );
    assert.equal(projection.summary.sources.count, 1);
    assert.equal(projection.summary.safety.evaluatorAction, 'allow');
    assert.equal(projection.summary.license.value, 'Recorded fixture license');
    assert.deepEqual(projection.trace.axes[0], {
        key: 'tightness',
        label: 'Tightness',
        target: 3,
        final: 4,
        state: 'recorded',
    });
    assert.equal(projection.trace.axes[2].target, 4);
    assert.equal(projection.trace.axes[2].final, 5);
    assert.equal(projection.trace.state, 'complete');
    assert.deepEqual(projection.actions, {
        sources: { state: 'available' },
        controls: { state: 'available' },
        trace: {
            state: 'unknown',
            reason: 'Trace availability is not confirmed by the chat response.',
        },
        report: {
            state: 'unavailable',
            reason: 'Reporting is not available on this surface.',
        },
    });
});

test('keeps prepared source and control facts inspectable while disabling artifact actions', () => {
    const projection = projectResponseFootnote({
        metadata: toFootnote(fixtures.prepared),
        artifacts: {
            trace: 'unavailable',
            report: 'unavailable',
        },
    });

    assert.equal(projection.summary.sources.count, 1);
    assert.equal(projection.summary.controls.state, 'recorded');
    assert.equal(projection.actions.sources.state, 'available');
    assert.equal(projection.actions.controls.state, 'available');
    assert.equal(projection.actions.trace.state, 'unavailable');
    assert.equal(projection.actions.report.state, 'unavailable');
});

test('marks missing final axes partial or unavailable without synthetic values', () => {
    const projection = projectResponseFootnote({
        metadata: toFootnote(fixtures.partial),
        artifacts: liveArtifacts,
    });

    assert.equal(projection.status, 'available');
    assert.equal(projection.summary.sources.count, 0);
    assert.equal(projection.summary.license.state, 'unavailable');
    assert.deepEqual(projection.trace.axes[0], {
        key: 'tightness',
        label: 'Tightness',
        target: 3,
        final: 3,
        state: 'recorded',
    });
    assert.deepEqual(projection.trace.axes[1], {
        key: 'rationale',
        label: 'Rationale',
        target: null,
        final: null,
        state: 'unavailable',
    });
    assert.deepEqual(projection.trace.axes[2], {
        key: 'attribution',
        label: 'Attribution',
        target: null,
        final: null,
        state: 'unavailable',
    });
    assert.equal(projection.trace.state, 'partial');
});

test('returns unavailable facts and actions when metadata is absent', () => {
    const projection = projectResponseFootnote({
        metadata: null,
        artifacts: {
            trace: 'unavailable',
            report: 'unavailable',
        },
    });

    assert.equal(projection.status, 'unavailable');
    assert.equal(projection.facts, null);
    assert.equal(projection.summary.sources.state, 'unavailable');
    assert.equal(projection.summary.controls.state, 'unavailable');
    assert.equal(projection.trace.state, 'unavailable');
    assert.equal(projection.actions.sources.state, 'unavailable');
    assert.equal(projection.actions.trace.state, 'unavailable');
    assert.equal(projection.actions.report.state, 'unavailable');
    assert.equal(
        projection.actions.trace.reason,
        'Response metadata is unavailable.'
    );
});
