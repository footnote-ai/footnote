/**
 * @description: Verifies changed-file lists use stable code-unit ordering.
 * @footnote-scope: test
 * @footnote-module: FormatChangedTests
 * @footnote-risk: low - Covers deterministic ordering in developer tooling.
 * @footnote-ethics: low - Test uses synthetic paths and has no direct user impact.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { uniqueSorted } = require('./format-changed.cjs');

test('uniqueSorted uses code-unit order instead of locale collation', () => {
    assert.deepEqual(
        uniqueSorted(['ä.ts', 'Z.ts', 'a.ts', 'Å.ts', 'A.ts', 'z.ts', 'A.ts']),
        ['A.ts', 'Z.ts', 'a.ts', 'z.ts', 'Å.ts', 'ä.ts']
    );
});
