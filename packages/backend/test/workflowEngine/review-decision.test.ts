/**
 * @description: Verifies reviewed workflow assess output parsing preserves
 * expected failure reasons.
 * @footnote-scope: test
 * @footnote-module: WorkflowEngineReviewDecisionTests
 * @footnote-risk: low - Parser regressions can hide assess fail-open causes.
 * @footnote-ethics: high - Review parse clarity supports auditable workflow decisions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parseReviewDecisionOutput,
    parseReviewDecisionOutputResult,
} from '../../src/services/workflowEngine/reviewDecision.js';

test('parseReviewDecisionOutputResult parses finalize decisions', () => {
    const result = parseReviewDecisionOutputResult(
        '{"reviewDecision":"finalize","reviewReason":"Ready."}'
    );

    assert.equal(result.isOk(), true);
    if (result.isOk()) {
        assert.deepEqual(result.value, {
            reviewDecision: 'finalize',
            reviewReason: 'Ready.',
        });
    }
});

test('parseReviewDecisionOutputResult parses revise decisions and trims instruction', () => {
    const result = parseReviewDecisionOutputResult(
        '{"reviewDecision":"revise","reviewReason":"Needs polish.","revisionInstruction":"  Tighten wording.  "}'
    );

    assert.equal(result.isOk(), true);
    if (result.isOk()) {
        assert.equal(result.value.reviewDecision, 'revise');
        assert.equal(result.value.revisionInstruction, 'Tighten wording.');
    }
});

test('parseReviewDecisionOutputResult reports empty output', () => {
    const result = parseReviewDecisionOutputResult('   ');

    assert.equal(result.isErr(), true);
    if (result.isErr()) {
        assert.equal(result.error.reason, 'empty_output');
        assert.equal(result.error.message, 'Review decision output was empty.');
        assert.equal(result.error.outputLength, 3);
    }
});

test('parseReviewDecisionOutputResult reports non-object output', () => {
    const result = parseReviewDecisionOutputResult(
        '```json\n{"reviewDecision":"finalize"}\n```'
    );

    assert.equal(result.isErr(), true);
    if (result.isErr()) {
        assert.equal(result.error.reason, 'non_json_object');
        assert.equal(
            result.error.message,
            'Review decision output must be a JSON object.'
        );
    }
});

test('parseReviewDecisionOutputResult reports invalid JSON', () => {
    const result = parseReviewDecisionOutputResult(
        '{"reviewDecision":"finalize",}'
    );

    assert.equal(result.isErr(), true);
    if (result.isErr()) {
        assert.equal(result.error.reason, 'invalid_json');
        assert.equal(
            result.error.message,
            'Review decision output was not valid JSON.'
        );
    }
});

test('parseReviewDecisionOutputResult reports missing revise instruction', () => {
    const result = parseReviewDecisionOutputResult(
        '{"reviewDecision":"revise","reviewReason":"Needs polish."}'
    );

    assert.equal(result.isErr(), true);
    if (result.isErr()) {
        assert.equal(result.error.reason, 'schema_invalid');
        assert.equal(result.error.firstIssuePath, 'revisionInstruction');
        assert.ok((result.error.issueCount ?? 0) > 0);
    }
});

test('parseReviewDecisionOutputResult reports incomplete trace misalignment fields', () => {
    const result = parseReviewDecisionOutputResult(
        '{"reviewDecision":"finalize","reviewReason":"Ready.","traceAlignment":"misaligned"}'
    );

    assert.equal(result.isErr(), true);
    if (result.isErr()) {
        assert.equal(result.error.reason, 'schema_invalid');
        assert.ok((result.error.issueCount ?? 0) > 0);
    }
});

test('parseReviewDecisionOutput keeps nullable compatibility wrapper', () => {
    const result = parseReviewDecisionOutput('not json');

    assert.equal(result, null);
});
