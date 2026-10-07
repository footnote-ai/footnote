/**
 * @description: Behavior and privacy checks for the bounded external run review surface.
 * @footnote-scope: test
 * @footnote-module: ExternalRunReviewTests
 * @footnote-risk: low - Exercises only synthetic host-reported metadata.
 * @footnote-ethics: high - Confirms external claims stay attributed and missing evidence stays visible.
 */

import test from 'node:test';
import { strict as assert } from 'node:assert';
import {
    ExternalRunReviewInputSchema,
    reviewExternalRun,
} from '../src/external-review.js';

test('reviewExternalRun keeps host-reported origin separate from its provenance assessment', () => {
    const review = reviewExternalRun({
        schemaVersion: 'v0alpha',
        origin: 'host_reported',
        signals: {
            citationCount: 2,
            retrievalRequested: true,
            retrievalUsed: true,
            retrievalToolExecuted: true,
        },
    });

    assert.equal(review.origin, 'host_reported');
    assert.deepEqual(review.reportedSignals, {
        citationCount: 2,
        retrievalRequested: true,
        retrievalUsed: true,
        retrievalToolExecuted: true,
    });
    assert.equal(review.provenance, 'Retrieved');
    assert.equal(review.assessment.methodId, 'deterministic_multi_signal_v1');
    assert.equal('origin' in review.assessment, false);
    assert.deepEqual(review.missingSignals, [
        'workflowEvidence',
        'trustGraphEvidenceAvailable',
        'trustGraphEvidenceUsed',
        'assistantDeclaredSpeculative',
    ]);
});

test('reviewExternalRun reports omitted signals instead of treating them as host-reported false facts', () => {
    const review = reviewExternalRun({
        schemaVersion: 'v0alpha',
        origin: 'host_reported',
        signals: { retrievalUsed: false },
    });

    assert.equal(review.provenance, 'Inferred');
    assert.deepEqual(review.reportedSignals, { retrievalUsed: false });
    assert.ok(review.missingSignals.includes('citationCount'));
    assert.ok(
        review.assessment.limitations.some((limitation) =>
            limitation.includes('citationCount')
        )
    );
});

test('reviewExternalRun does not infer missing citations from retrieval-only evidence', () => {
    const review = reviewExternalRun({
        schemaVersion: 'v0alpha',
        origin: 'host_reported',
        signals: { retrievalUsed: true },
    });

    assert.ok(review.missingSignals.includes('citationCount'));
    assert.deepEqual(review.assessment.signals, { retrievalUsed: true });
    assert.equal(
        review.assessment.conflicts.includes(
            'retrieval_used_without_citations'
        ),
        false
    );
    assert.equal(
        review.assessment.limitations.includes(
            'Retrieval ran, but no citations were retained after normalization.'
        ),
        false
    );
    assert.ok(
        review.assessment.limitations.some((limitation) =>
            limitation.includes('citationCount')
        )
    );
});

test('reviewExternalRun preserves explicitly reported false signals and zero citations in the assessment', () => {
    const review = reviewExternalRun({
        schemaVersion: 'v0alpha',
        origin: 'host_reported',
        signals: {
            citationCount: 0,
            retrievalRequested: false,
            retrievalUsed: false,
            retrievalToolExecuted: false,
            workflowEvidence: false,
            trustGraphEvidenceAvailable: false,
            trustGraphEvidenceUsed: false,
            assistantDeclaredSpeculative: false,
        },
    });

    assert.deepEqual(review.assessment.signals, {
        citationsPresent: false,
        retrievalRequested: false,
        retrievalUsed: false,
        retrievalToolExecuted: false,
        workflowEvidence: false,
        trustGraphEvidenceAvailable: false,
        trustGraphEvidenceUsed: false,
        assistantDeclaredSpeculative: false,
    });
});

test('reviewExternalRun does not infer unavailable TrustGraph evidence when availability is unreported', () => {
    const review = reviewExternalRun({
        schemaVersion: 'v0alpha',
        origin: 'host_reported',
        signals: { trustGraphEvidenceUsed: true },
    });

    assert.ok(review.missingSignals.includes('trustGraphEvidenceAvailable'));
    assert.deepEqual(review.assessment.signals, {
        trustGraphEvidenceUsed: true,
    });
    assert.equal(
        review.assessment.conflicts.includes(
            'trustgraph_usage_without_availability'
        ),
        false
    );
    assert.equal(
        review.assessment.limitations.includes(
            'TrustGraph usage signal was reported without corresponding available P_EVID refs.'
        ),
        false
    );
    assert.ok(
        review.assessment.limitations.some((limitation) =>
            limitation.includes('trustGraphEvidenceAvailable')
        )
    );
});

test('ExternalRunReviewInputSchema accepts a minimal generic host fixture and rejects private payload fields', () => {
    const genericHostFixture = {
        schemaVersion: 'v0alpha',
        origin: 'host_reported',
        signals: { retrievalUsed: true },
    };
    assert.equal(
        ExternalRunReviewInputSchema.safeParse(genericHostFixture).success,
        true
    );
    assert.equal(
        ExternalRunReviewInputSchema.safeParse({
            ...genericHostFixture,
            origin: 'footnote_observed',
        }).success,
        true
    );

    for (const field of [
        'prompt',
        'response',
        'sourceBody',
        'toolPayload',
        'hiddenReasoning',
        'secret',
        'privateContext',
    ]) {
        assert.equal(
            ExternalRunReviewInputSchema.safeParse({
                ...genericHostFixture,
                [field]: 'must not be accepted',
            }).success,
            false,
            `top-level ${field} must be rejected`
        );
        assert.equal(
            ExternalRunReviewInputSchema.safeParse({
                ...genericHostFixture,
                signals: {
                    retrievalUsed: true,
                    [field]: 'must not be accepted',
                },
            }).success,
            false,
            `signal ${field} must be rejected`
        );
    }

    assert.equal(
        ExternalRunReviewInputSchema.safeParse({
            ...genericHostFixture,
            signals: { citationCount: -1 },
        }).success,
        false
    );
});

test('reviewExternalRun attributes canonical Footnote observations without calling them host reports', () => {
    const review = reviewExternalRun({
        schemaVersion: 'v0alpha',
        origin: 'footnote_observed',
        signals: { retrievalUsed: true },
    });

    assert.equal(review.origin, 'footnote_observed');
    assert.ok(
        review.assessment.limitations.some((limitation) =>
            limitation.startsWith('Footnote did not report')
        )
    );
});
