/**
 * @description: Verifies the prepared embed answer stays concise and retains its captured response metadata.
 * @footnote-scope: test
 * @footnote-module: EmbedScenarioTest
 * @footnote-risk: low - Fixture assertions catch malformed or overlong public response data.
 * @footnote-ethics: high - Captured provenance and runtime status must remain authentic rather than synthesized.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { embedScenario } from './embedScenario';

test('embed example is a concise captured response with its actual metadata', () => {
    const { question, response } = embedScenario;
    const wordCount = response.message.trim().split(/\s+/).length;

    assert.equal(
        question,
        'Why does ice float in water? Please explain it simply in about 70 words.'
    );
    assert.ok(wordCount >= 60 && wordCount <= 100);
    assert.equal(response.action, 'message');
    assert.equal(response.modality, 'text');
    assert.equal(response.metadata.responseId, 'JUC6855x');
    assert.equal(response.metadata.chainHash, '67f34705e73eefa0');
    assert.equal(response.metadata.workflow?.status, 'completed');
    assert.equal(
        response.metadata.reviewRuntime?.label,
        'reviewed_no_revision'
    );
    assert.ok(
        response.metadata.citations?.some(
            (citation) =>
                citation.url ===
                'https://www.thoughtco.com/why-does-ice-float-604304'
        )
    );
    assert.equal('publicationToken' in response, false);
});
