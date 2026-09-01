/**
 * @description: Verifies field-level trace display projection and explicit partial-state reporting.
 * @footnote-scope: test
 * @footnote-module: TraceDisplayProjectionTests
 * @footnote-risk: low - Tests synthetic read projections only.
 * @footnote-ethics: medium - Prevents malformed provenance from being presented as complete.
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { projectTraceMetadataForDisplay } from '../src/storage/traces/traceDisplayProjection.js';

const baseTrace = {
    responseId: 'trace_partial_583',
    provenance: 'Retrieved',
    safetyTier: 'Low',
    tradeoffCount: 1,
    chainHash: 'hash',
    licenseContext: 'MIT',
    modelVersion: 'gpt-5.6-luna',
    staleAfter: new Date().toISOString(),
    citations: [
        { title: 'valid', url: 'https://example.com/valid' },
        { title: 'invalid', url: 'not-a-url' },
    ],
    provenanceAssessment: { methodId: 'not-valid' },
    trace_target: { tightness: 3, rationale: 'bad' },
    trace_final: { tightness: 4, attribution: 2 },
    trace_final_reason_code: 'runtime_posture_adjustment',
    secretPrompt: 'must not be returned',
};

test('trace display projection keeps valid fields and names unavailable fields', () => {
    const projected = projectTraceMetadataForDisplay(
        baseTrace,
        baseTrace.responseId
    );

    assert.ok(projected);
    assert.equal(projected.displayIntegrity.status, 'partial');
    assert.deepEqual(projected.citations, [baseTrace.citations[0]]);
    assert.deepEqual(projected.trace_target, { tightness: 3 });
    assert.deepEqual(projected.trace_final, { tightness: 4, attribution: 2 });
    assert.equal(projected.provenanceAssessment, undefined);
    assert.equal('secretPrompt' in projected, false);
    assert.ok(
        projected.displayIntegrity.unavailableFields.includes('citations[1]')
    );
    assert.ok(
        projected.displayIntegrity.unavailableFields.includes(
            'provenanceAssessment'
        )
    );
    assert.ok(
        projected.displayIntegrity.unavailableFields.includes(
            'trace_target.rationale'
        )
    );
});

test('trace display projection marks a fully valid record complete', () => {
    const projected = projectTraceMetadataForDisplay(
        {
            ...baseTrace,
            citations: [baseTrace.citations[0]],
            provenanceAssessment: undefined,
            trace_target: { tightness: 3 },
            trace_final: { tightness: 3 },
            trace_final_reason_code: undefined,
        },
        baseTrace.responseId
    );

    assert.ok(projected);
    assert.deepEqual(projected.displayIntegrity, {
        status: 'complete',
        unavailableFields: [],
    });
});
