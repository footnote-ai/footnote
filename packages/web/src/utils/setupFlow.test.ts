/**
 * @description: Unit tests for setup routing and fragment-code parsing helpers.
 * @footnote-scope: test
 * @footnote-module: SetupFlowUtilsTests
 * @footnote-risk: low - Pure helper tests only validate deterministic setup-gating utility behavior.
 * @footnote-ethics: low - Tests use synthetic route/hash inputs with no user data.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSetupCodeFromHash, shouldRedirectToSetup } from './setupFlow';

test('parseSetupCodeFromHash extracts code from URL fragment', () => {
    assert.equal(
        parseSetupCodeFromHash('#code=fn_setup_abc123'),
        'fn_setup_abc123'
    );
    assert.equal(
        parseSetupCodeFromHash('#foo=bar&code=fn_setup_two'),
        'fn_setup_two'
    );
    assert.equal(parseSetupCodeFromHash('#code='), null);
    assert.equal(parseSetupCodeFromHash(''), null);
});

test('shouldRedirectToSetup enforces setup route only when required', () => {
    assert.equal(
        shouldRedirectToSetup({
            setupRequired: true,
            routePath: '/setup',
            currentPath: '/',
        }),
        true
    );
    assert.equal(
        shouldRedirectToSetup({
            setupRequired: true,
            routePath: '/setup',
            currentPath: '/setup',
        }),
        false
    );
    assert.equal(
        shouldRedirectToSetup({
            setupRequired: false,
            routePath: '/setup',
            currentPath: '/',
        }),
        false
    );
});
