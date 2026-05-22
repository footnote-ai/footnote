/**
 * @description: Unit tests for setup bootstrap event parsing and expiry checks.
 * @footnote-scope: test
 * @footnote-module: LauncherSetupEventTests
 * @footnote-risk: low - Parser tests verify deterministic text parsing and do not touch runtime lifecycle.
 * @footnote-ethics: low - Parsing tests improve operator tooling clarity without affecting policy decisions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isSetupBootstrapEventUsable,
    parseSetupBootstrapEventLine,
} from './setupEvent.js';

test('parseSetupBootstrapEventLine extracts structured setup event payload', () => {
    const line =
        '[SETUP_EVENT] {"event":"footnote.setup.bootstrap","setupPath":"/setup#code=fn_setup_abc","setupUrl":"http://localhost:3000/setup#code=fn_setup_abc","expiresAt":"2099-01-01T00:00:00.000Z"}';
    const parsed = parseSetupBootstrapEventLine(line);
    assert.ok(parsed);
    assert.equal(parsed?.setupPath, '/setup#code=fn_setup_abc');
});

test('parseSetupBootstrapEventLine tolerates ANSI-prefixed logger output', () => {
    const line =
        '\u001b[32m2026-01-01 [info]: [SETUP_EVENT] {"event":"footnote.setup.bootstrap","setupPath":"/setup#code=fn_setup_abc","setupUrl":"http://localhost:3000/setup#code=fn_setup_abc","expiresAt":"2099-01-01T00:00:00.000Z"}\u001b[39m';
    const parsed = parseSetupBootstrapEventLine(line);
    assert.ok(parsed);
    assert.equal(
        parsed?.setupUrl,
        'http://localhost:3000/setup#code=fn_setup_abc'
    );
});

test('isSetupBootstrapEventUsable enforces expiry semantics', () => {
    assert.equal(
        isSetupBootstrapEventUsable(
            { expiresAt: '2099-01-01T00:00:00.000Z' },
            Date.parse('2026-01-01T00:00:00.000Z')
        ),
        true
    );
    assert.equal(
        isSetupBootstrapEventUsable(
            { expiresAt: '2026-01-01T00:00:00.000Z' },
            Date.parse('2026-01-01T00:00:01.000Z')
        ),
        false
    );
});
