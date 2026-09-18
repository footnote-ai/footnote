/**
 * @description: Verifies TRACE CGI provenance controls, custom ID parsing, and metadata pass-through payload behavior.
 * @footnote-scope: test
 * @footnote-module: ProvenanceCgiTests
 * @footnote-risk: medium - Missing assertions could allow provenance control regressions and incorrect trace-card payload wiring.
 * @footnote-ethics: high - Provenance control integrity affects traceability and user trust.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildProvenanceActionCustomId,
    buildProvenanceActionRow,
    parseProvenanceActionCustomId,
} from '../src/utils/response/provenanceCgi.js';

test('buildProvenanceActionRow renders details/report_issue with response-bound custom IDs', () => {
    const row = buildProvenanceActionRow('resp_123');
    const rowJson = row.toJSON() as {
        components: Array<{ custom_id?: string }>;
    };
    const customIds = rowJson.components
        .map((component) => component.custom_id)
        .filter((value): value is string => typeof value === 'string');

    assert.equal(customIds.length, 2);
    assert.deepEqual(customIds, ['details:resp_123', 'report_issue:resp_123']);
    assert.equal(customIds.includes('details'), false);
    assert.equal(customIds.includes('report_issue'), false);
});

test('customId helpers round-trip valid provenance IDs', () => {
    const details = buildProvenanceActionCustomId('details', 'resp_a');
    const report = buildProvenanceActionCustomId('report_issue', 'resp_b');

    assert.deepEqual(parseProvenanceActionCustomId(details), {
        action: 'details',
        responseId: 'resp_a',
    });
    assert.deepEqual(parseProvenanceActionCustomId(report), {
        action: 'report_issue',
        responseId: 'resp_b',
    });
});

test('customId parser rejects invalid provenance IDs', () => {
    assert.equal(parseProvenanceActionCustomId('details'), null);
    assert.equal(parseProvenanceActionCustomId('details:'), null);
    assert.equal(
        parseProvenanceActionCustomId('alternative_lens:resp_1'),
        null
    );
    assert.equal(parseProvenanceActionCustomId('full_trace:resp_x'), null);
    assert.equal(parseProvenanceActionCustomId('report_issue'), null);
});
