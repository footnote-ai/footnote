/**
 * @description: Validates that review orchestration continues to parse Footnote validator diagnostics after the TypeScript validator migration.
 * @footnote-scope: test
 * @footnote-module: ReviewOrchestratorTests
 * @footnote-risk: low - This test only covers tooling integration between validator output and review parsing.
 * @footnote-ethics: low - The assertions only inspect synthetic diagnostics and do not involve user data.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseFootnoteTagDiagnostics, parseStructuredDiagnostics } =
    require('./review.cjs') as {
        parseFootnoteTagDiagnostics: (result: {
            status: number;
            stdout: string;
            stderr: string;
        }) => Array<{ file: string; line: number; message: string }>;
        parseStructuredDiagnostics: (
            result: { status: number; stdout: string; stderr: string },
            fallbackFile: string
        ) => Array<{
            file: string;
            line: number;
            message: string;
            severity: 'error' | 'warning';
        }>;
    };

test('review parser keeps recognizing Footnote validator diagnostics', () => {
    const diagnostics = parseFootnoteTagDiagnostics({
        status: 1,
        stdout: '',
        stderr: 'Footnote tag error in packages/example/src/module.ts: Line 4: Missing required @footnote-module tag.',
    });

    assert.deepEqual(diagnostics, [
        {
            file: 'packages/example/src/module.ts',
            line: 1,
            message: 'Line 4: Missing required @footnote-module tag.',
            severity: 'error',
        },
    ]);
});

test('review parser keeps structured warnings and errors from validators', () => {
    const diagnostics = parseStructuredDiagnostics(
        {
            status: 0,
            stdout: '{"file":".devin/wiki.json","line":1,"message":"Headroom is low.","severity":"warning"}\nsummary',
            stderr: '',
        },
        'scripts/validate-deepwiki.ts'
    );

    assert.deepEqual(diagnostics, [
        {
            file: '.devin/wiki.json',
            line: 1,
            message: 'Headroom is low.',
            severity: 'warning',
        },
    ]);
});
