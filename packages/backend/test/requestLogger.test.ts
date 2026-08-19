/**
 * @description: Tests request log level selection for the operator-facing log contract.
 * @footnote-scope: test
 * @footnote-module: RequestLoggerTests
 * @footnote-risk: low - Level regressions affect signal-to-noise, not request behavior.
 * @footnote-ethics: medium - Bounded request logs reduce exposure of user-derived data.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { selectRequestLogLevel } from '../src/utils/requestLogger.js';

test('keeps successful request logs at debug', () => {
    assert.equal(selectRequestLogLevel(200), 'debug');
    assert.equal(selectRequestLogLevel(399), 'debug');
});

test('keeps client failures at warn and server failures at error', () => {
    assert.equal(selectRequestLogLevel(400), 'warn');
    assert.equal(selectRequestLogLevel(499), 'warn');
    assert.equal(selectRequestLogLevel(500), 'error');
});
