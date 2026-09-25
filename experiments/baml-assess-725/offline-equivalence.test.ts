/**
 * @description: Verifies the offline Footnote/BAML semantic-difference matrix.
 * @footnote-scope: test
 * @footnote-module: BamlAssessSemanticEquivalenceTests
 * @footnote-risk: medium - Matrix regressions can hide policy-relevant parser drift.
 * @footnote-ethics: high - The matrix is synthetic and never invokes a provider.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runSemanticEquivalenceMatrix } from './offline-equivalence.js';

test('records text and unresolved provider-path cases without collapsing them', () => {
    const report = runSemanticEquivalenceMatrix();

    assert.equal(report.toolchain.baml, '0.226.2');
    assert.equal(report.rows.length, 33);
    assert.ok(
        report.rows.some(
            (row) =>
                row.case === 'incomplete_revise' &&
                row.currentFootnoteClassification === 'schema_invalid' &&
                row.bamlParseResult === 'error'
        )
    );
    assert.equal(report.parserStrictness.strictModeLocated, false);
    assert.ok(report.maintenanceSurface.bamlPrototype.generatedClientLines > 0);
    assert.equal(report.contractChangeErgonomics.currentUpdatePointCount, 6);
    assert.equal(report.contractChangeErgonomics.bamlUpdatePointCount, 6);
    assert.ok(
        report.rows.every((row) =>
            row.kind === 'provider_failure'
                ? row.bamlParseResult === 'not_run' &&
                  row.currentFootnoteClassification === 'not_applicable'
                : row.bamlParseResult !== 'not_run'
        )
    );
});

test('records BAML assertion coverage for conditional ReviewDecision rules', () => {
    const report = runSemanticEquivalenceMatrix();

    assert.equal(report.conditionalValidation.representedInBaml, true);
    assert.deepEqual(report.conditionalValidation.assertions, [
        'revision_instruction_when_revising',
        'trace_reason_when_misaligned',
        'temperament_when_misaligned',
    ]);
    assert.ok(
        report.rows.some(
            (row) =>
                row.case === 'misaligned_without_reason_or_temperament' &&
                row.currentFootnoteClassification === 'schema_invalid' &&
                row.bamlParseResult === 'error'
        )
    );
    assert.ok(
        report.rows.some(
            (row) =>
                row.case === 'numeric_string_temperament' &&
                row.bamlParseResult === 'success' &&
                row.layeredFootnoteClassification === 'success' &&
                row.layeredClassificationMatchesCurrent === false
        )
    );
    assert.ok(
        report.rows.some(
            (row) =>
                row.case === 'negative_temperament_axis' &&
                row.layeredFootnoteClassification === 'schema_invalid' &&
                row.layeredClassificationMatchesCurrent === true
        )
    );
});
