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

    assert.match(source, /api\.getResponseVersions/);
    assert.match(source, /candidate\.state === 'selected'/);
    assert.match(source, /showPreviousNextControls/);
    assert.match(source, /This version was superseded/);
    assert.match(source, /Response history is unavailable/);
    assert.match(source, /ariaLabel="Response versions"/);
});
