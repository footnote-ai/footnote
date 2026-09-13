/**
 * @description: Verifies the fixed NYC September 11 experience contract and additive archive metadata.
 * @footnote-scope: test
 * @footnote-module: NycSept11ContractsTests
 * @footnote-risk: low - Synthetic payload validation only.
 * @footnote-ethics: medium - Contract tests protect bounded historical provenance claims.
 */

import test from 'node:test';
import { strict as assert } from 'node:assert';
import {
    PostChatRequestSchema,
    ResponseMetadataSchema,
} from '../src/web/schemas';

test('archive experience selector accepts only the fixed ID', () => {
    const base = {
        surface: 'web',
        trigger: { kind: 'submit' },
        latestUserInput: 'What happened?',
        conversation: [{ role: 'user', content: 'What happened?' }],
    };
    assert.equal(
        PostChatRequestSchema.safeParse({ ...base, experienceId: 'nyc-sept11' })
            .success,
        true
    );
    assert.equal(
        PostChatRequestSchema.safeParse({ ...base, experienceId: 'other' })
            .success,
        false
    );
});

test('archive metadata is additive and bounded to five inspectable sources', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        responseId: 'response-1',
        provenance: 'Retrieved',
        safetyTier: 'Low',
        tradeoffCount: 0,
        chainHash: 'hash',
        licenseContext: 'MIT + HL3',
        modelVersion: 'deepseek/deepseek-v4-flash-0731',
        staleAfter: new Date().toISOString(),
        citations: [],
        trace_target: {},
        trace_final: {},
        archive: {
            experienceId: 'nyc-sept11',
            version: 'sept11-preview-rc1',
            documentsIndexed: 49,
            completeArchive: false,
            sources: [
                {
                    sourceLabel: 'S1',
                    chunkId: 'urn:chunk:1',
                    documentId: 'NYC-WTC_000001',
                    pageId: 'urn:page:1',
                    pageNumber: 1,
                    originalUrl:
                        'https://sept11documents.cityofnewyork.us/doc.pdf#page=1',
                },
            ],
        },
    });
    assert.equal(parsed.success, true);
});
