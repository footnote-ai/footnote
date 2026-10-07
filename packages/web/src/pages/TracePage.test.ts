/**
 * @description: Verifies trace response-history presentation stays final-first and inspectable.
 * @footnote-scope: test
 * @footnote-module: TracePageResponseVersionsTests
 * @footnote-risk: low - Covers static trace UI composition only.
 * @footnote-ethics: high - Prevents superseded answer text from being presented as authoritative.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { summarizeGroundingEvidence } from '@footnote/contracts/policy';

const tracePagePath = path.join(
    process.cwd(),
    'packages',
    'web',
    'src',
    'pages',
    'TracePage.tsx'
);

test('trace response versions load final-first with controls, warnings, and unavailable state', async () => {
    const source = await readFile(tracePagePath, 'utf8');

    assert.ok(
        source.indexOf('<h2>Response versions</h2>') <
            source.indexOf('<h2>What happened</h2>')
    );
    assert.match(source, /The selected version is the delivered answer/u);
    assert.match(source, /api\.getResponseVersions/);
    assert.match(source, /candidate\.state === 'selected'/);
    assert.match(source, /showPreviousNextControls/);
    assert.match(source, /This version was superseded/);
    assert.match(source, /Response history is unavailable/);
    assert.match(source, /ariaLabel="Response versions"/);
    assert.match(source, /Requested draft/);
    assert.match(source, /Observed draft/);
    assert.match(source, /getPresentationTraceSummary/);
    assert.match(source, /Main answer after presentation fallback/);
    assert.match(source, /responseAuthorityUnavailable/);
    assert.match(
        source,
        /stored versions below are historical[\s\S]{0,80}not presented as the delivered answer/
    );
    assert.match(
        source,
        /initialIndex=\{Math\.max\(selectedCandidateIndex, 0\)\}/u
    );
});

test('trace page makes partial provenance explicit', async () => {
    const source = await readFile(tracePagePath, 'utf8');

    assert.match(source, /Some provenance is unavailable in this stored trace/);
    assert.match(source, /this record[\s\S]{0,80}not complete/);
    assert.match(
        source,
        /Some stored citations are unavailable and were omitted/
    );
});

test('trace summary shows included user memory separately from sources', async () => {
    const source = await readFile(tracePagePath, 'utf8');

    assert.match(source, /label: 'User-saved memory'/);
    assert.match(source, /includedItemCount/);
    assert.match(source, /Advisory personalization context only/);
});

test('trace page puts evidence status first and keeps stale/legacy disclosures explicit', async () => {
    const source = await readFile(tracePagePath, 'utf8');

    assert.match(source, /trace-evidence-status/u);
    assert.match(source, /Some provenance is unavailable/u);
    assert.match(source, /if \(loadingState === 'stale'\)/u);
    assert.match(source, /Trace Stale/u);
    assert.match(source, /TraceWorkflowDetails/u);
    assert.match(source, /TraceWorkflowDetails workflow=/u);
});

test('missing evidence remains an explicit unverified state on the Trace surface', () => {
    const summary = summarizeGroundingEvidence({
        citations: [],
        execution: [],
        provenanceAssessment: undefined,
    });

    assert.equal(summary.status, 'not_recorded');
    assert.equal(summary.label, 'No grounding evidence recorded');
    assert.match(summary.explanation, /Treat important claims as unverified/u);
});

test('public Trace omits retrieved bodies and image-generation prompts', async () => {
    const source = await readFile(tracePagePath, 'utf8');

    assert.doesNotMatch(source, /citation\.snippet/u);
    assert.doesNotMatch(source, /imageGeneration\.prompts/u);
    assert.doesNotMatch(source, /renderImageGenerationSection/u);
    assert.match(source, /traceData\.citations\?\.map\(\(\{ title, url \}\)/u);
    assert.match(source, /JSON\.stringify\(sanitizedTraceData/u);
});

test('public Trace does not render operator execution diagnostics', async () => {
    const source = await readFile(tracePagePath, 'utf8');

    assert.doesNotMatch(source, /traceData\.execution/u);
    assert.doesNotMatch(source, /Recorded outcome codes/u);
    assert.doesNotMatch(source, /executionCount:/u);
    assert.match(
        source,
        /This limited public projection is not an operator report/u
    );
});
