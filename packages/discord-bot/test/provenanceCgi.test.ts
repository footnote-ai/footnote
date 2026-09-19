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

test('buildProvenanceActionRow renders four response-bound provenance buttons', () => {
    const row = buildProvenanceActionRow('resp_123');
    const rowJson = row.toJSON() as {
        components: Array<{
            custom_id?: string;
            label?: string;
            emoji?: { name?: string };
        }>;
    };
    const customIds = rowJson.components
        .map((component) => component.custom_id)
        .filter((value): value is string => typeof value === 'string');

    assert.equal(customIds.length, 4);
    assert.deepEqual(customIds, [
        'sources:resp_123',
        'controls:resp_123',
        'trace:resp_123',
        'report_issue:resp_123',
    ]);
    assert.deepEqual(
        rowJson.components.map((component) => component.label),
        ['Sources', 'Controls', 'Trace', 'Report']
    );
    assert.deepEqual(
        rowJson.components.map((component) => component.emoji?.name),
        ['📖', '🎛️', '📄', '🚩']
    );
    assert.equal(customIds.includes('details'), false);
    assert.equal(customIds.includes('report_issue'), false);
});

test('customId helpers round-trip valid provenance IDs', () => {
    const sources = buildProvenanceActionCustomId('sources', 'resp_a');
    const trace = buildProvenanceActionCustomId('trace', 'resp_b');
    const report = buildProvenanceActionCustomId('report_issue', 'resp_b');

    assert.deepEqual(parseProvenanceActionCustomId(sources), {
        action: 'sources',
        responseId: 'resp_a',
    });
    assert.deepEqual(parseProvenanceActionCustomId(trace), {
        action: 'trace',
        responseId: 'resp_b',
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

test('customId parser keeps the legacy details action readable', () => {
    assert.deepEqual(parseProvenanceActionCustomId('details:resp_legacy'), {
        action: 'details',
        responseId: 'resp_legacy',
    });
});
