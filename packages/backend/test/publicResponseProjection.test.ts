/**
 * @description: Checks the narrow public-response allowlist independently of trace internals.
 * @footnote-scope: test
 * @footnote-module: PublicResponseProjectionTests
 * @footnote-risk: low - Covers public projection behavior without production side effects.
 * @footnote-ethics: high - Prevents accidental exposure of private trace and context data.
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import type { ResponseMetadata } from '@footnote/contracts/policy';
import { createMetadata } from './fixtures/responseMetadataFixture.js';
import { projectPublicResponse } from '../src/services/publicResponseProjection.js';

test('public response omits unclassified source links and keeps private trace fields out', () => {
    const metadata: ResponseMetadata = {
        ...createMetadata(),
        provenance: 'Retrieved',
        citations: [
            {
                title: 'Private repository: owner/private-repo',
                url: 'https://github.com/owner/private-repo/blob/main/file.md?token=private-token#private-fragment',
                snippet: 'private retrieved body must not escape',
            },
            {
                title: 'Signed attachment: private.pdf',
                url: 'https://storage.example.com/private.pdf?X-Amz-Credential=signed-secret',
                snippet: 'private attachment body must not escape',
            },
            {
                title: 'Unclassified public-looking source',
                url: 'https://example.com/public-source',
            },
            { title: 'Unsafe URL', url: 'javascript:alert(1)' },
        ],
        githubSource: {
            repository: 'owner/private-repo',
            path: '.footnote/private-prompt.ts',
            requestedRevision: 'private-requested-ref',
            resolvedRevision: 'private-resolved-sha',
            scope: 'selected_file',
            status: 'retrieved',
            freshness: 'current',
        },
        provenanceAssessment: {
            methodId: 'deterministic_multi_signal_v1',
            methodLabel: 'Deterministic signals',
            signals: {
                citationsPresent: true,
                retrievalRequested: true,
                retrievalUsed: true,
                retrievalToolExecuted: true,
                workflowEvidence: true,
                trustGraphEvidenceAvailable: false,
                trustGraphEvidenceUsed: false,
                assistantDeclaredSpeculative: false,
            },
            conflicts: ['Conflicts are not part of public proof.'],
            limitations: ['Evidence may be incomplete.'],
        },
        workflow: {
            workflowId: 'private-workflow-id',
            workflowName: 'private-workflow-name',
            status: 'completed',
            terminationReason: 'goal_satisfied',
            stepCount: 1,
            maxSteps: 4,
            maxDurationMs: 15000,
            steps: [],
        },
        prompt: 'private prompt',
        systemPrompt: 'private hidden instruction',
        developerPrompt: 'private developer instruction',
        context: { body: 'private retrieved context body' },
        reasoning: 'private internal reasoning',
        credentials: { apiKey: 'private secret value' },
        providerDetails: { account: 'private provider account' },
        incident: { notes: 'private operator-only incident notes' },
        authorization: { policy: 'private authorization decision' },
        remediation: { notes: 'private remediation notes' },
        candidateHistory: [{ text: 'private unapproved candidate' }],
    } as ResponseMetadata & Record<string, unknown>;

    const projection = projectPublicResponse({
        answer: 'Delivered answer',
        metadata,
        publishedAt: '2026-10-07T12:00:00.000Z',
        expiresAt: '2026-10-14T12:00:00.000Z',
    });

    assert.deepEqual(projection, {
        answer: 'Delivered answer',
        provenance: 'Retrieved',
        limitations: [
            'Source links were omitted because saved citations are not classified as public.',
            'Evidence may be incomplete.',
        ],
        publishedAt: '2026-10-07T12:00:00.000Z',
        expiresAt: '2026-10-14T12:00:00.000Z',
    });
    const serializedProjection = JSON.stringify(projection);
    assert.equal('githubSource' in projection, false);
    assert.equal(serializedProjection.includes('private'), false);
    assert.equal(serializedProjection.includes('private-token'), false);
    assert.equal(serializedProjection.includes('signed-secret'), false);
    assert.equal(serializedProjection.includes('private-requested-ref'), false);
    assert.equal(serializedProjection.includes('private-resolved-sha'), false);
});

test('public response reserves space to disclose omitted citations', () => {
    const metadata: ResponseMetadata = {
        ...createMetadata(),
        citations: [
            {
                title: 'Unclassified source',
                url: 'https://example.test/source',
            },
        ],
        provenanceAssessment: {
            methodId: 'deterministic_multi_signal_v1',
            methodLabel: 'Deterministic signals',
            signals: {
                citationsPresent: true,
                retrievalRequested: true,
                retrievalUsed: true,
                retrievalToolExecuted: true,
                workflowEvidence: true,
                trustGraphEvidenceAvailable: false,
                trustGraphEvidenceUsed: false,
                assistantDeclaredSpeculative: false,
            },
            conflicts: [],
            limitations: Array.from(
                { length: 8 },
                (_, index) => `Existing limitation ${index + 1}.`
            ),
        },
    };

    const projection = projectPublicResponse({
        answer: 'Delivered answer',
        metadata,
        publishedAt: '2026-10-07T12:00:00.000Z',
        expiresAt: '2026-10-14T12:00:00.000Z',
    });

    assert.equal(
        projection.limitations.includes(
            'Source links were omitted because saved citations are not classified as public.'
        ),
        true
    );
});
