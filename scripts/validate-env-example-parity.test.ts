/**
 * @description: Verifies environment parity diagnostics use stable code-unit ordering.
 * @footnote-scope: test
 * @footnote-module: ValidateEnvExampleParityTests
 * @footnote-risk: low - Covers deterministic ordering in developer tooling.
 * @footnote-ethics: low - Test uses synthetic keys and has no direct user impact.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { sortKeysInCodeUnitOrder } from './validate-env-example-parity';

test('diagnostic keys sort in code-unit order instead of locale collation', () => {
    assert.deepEqual(
        sortKeysInCodeUnitOrder(['ä_KEY', 'Z_KEY', 'a_KEY', 'Å_KEY', 'A_KEY']),
        ['A_KEY', 'Z_KEY', 'a_KEY', 'Å_KEY', 'ä_KEY']
    );
});
