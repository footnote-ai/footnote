/**
 * @description: Tests request log level selection for the operator-facing log contract.
 * @footnote-scope: test
 * @footnote-module: RequestLoggerTests
 * @footnote-risk: low - Level regressions affect signal-to-noise, not request behavior.
 * @footnote-ethics: medium - Bounded request logs reduce exposure of user-derived data.
 */

import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { logger } from '../src/utils/logger.js';
import {
    logRequest,
    selectRequestLogLevel,
} from '../src/utils/requestLogger.js';

test('keeps successful request logs at debug', () => {
    assert.equal(selectRequestLogLevel(200), 'debug');
    assert.equal(selectRequestLogLevel(399), 'debug');
});

test('keeps client failures at warn and server failures at error', () => {
    assert.equal(selectRequestLogLevel(400), 'warn');
    assert.equal(selectRequestLogLevel(499), 'warn');
    assert.equal(selectRequestLogLevel(500), 'error');
});

test('redacts mounted auth callback query values from request logs', () => {
    const request = Object.assign(Object.create(null), {
        method: 'GET',
        url: '/callback?code=authorization-code&state=csrf-state',
        originalUrl:
            '/api/auth/callback?code=authorization-code&state=csrf-state',
    }) as IncomingMessage & { originalUrl: string };
    const response = { statusCode: 302 } as ServerResponse;
    const originalDebug = logger.debug;
    let emittedMessage = '';
    logger.debug = ((message: string) => {
        emittedMessage = message;
    }) as typeof logger.debug;

    try {
        logRequest(request, response);
    } finally {
        logger.debug = originalDebug;
    }

    assert.match(emittedMessage, /GET \/api\/auth\/callback -> 302/);
    assert.doesNotMatch(emittedMessage, /authorization-code/);
    assert.doesNotMatch(emittedMessage, /csrf-state/);
});
