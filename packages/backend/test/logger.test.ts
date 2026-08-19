/**
 * @description: Regression tests for log sanitization so raw Discord IDs are scrubbed without corrupting object structure.
 * @footnote-scope: test
 * @footnote-module: LoggerTests
 * @footnote-risk: low - Test failures only hide logger regressions.
 * @footnote-ethics: medium - Logging tests help prevent accidental identifier leakage or misleading audit data.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { transports } from 'winston';

import { logger, sanitizeLogData } from '../src/utils/logger.js';

test('sanitizeLogData preserves shared references that are not circular', () => {
    const shared = {
        id: '123456789012345678',
        nested: { label: 'same child' },
    };

    const sanitized = sanitizeLogData({
        first: shared,
        second: shared,
    });

    assert.deepEqual(sanitized, {
        first: {
            id: '[REDACTED_ID]',
            nested: { label: 'same child' },
        },
        second: {
            id: '[REDACTED_ID]',
            nested: { label: 'same child' },
        },
    });
});

test('sanitizeLogData collapses true circular references safely', () => {
    const circular: { id: string; self?: unknown } = {
        id: '123456789012345678',
    };
    circular.self = circular;

    const sanitized = sanitizeLogData(circular);

    assert.deepEqual(sanitized, {
        id: '[REDACTED_ID]',
        self: '[Circular]',
    });
});

test('lifecycle console records include bounded phase and readiness fields', () => {
    const captured: string[] = [];
    const stream = new PassThrough();
    stream.on('data', (chunk) => {
        captured.push(chunk.toString());
    });
    const streamTransport = new transports.Stream({ stream });

    logger.add(streamTransport);
    try {
        logger.info('footnote.runtime.ready service=backend', {
            event: 'footnote.runtime.ready',
            phase: 'ready',
            service: 'backend',
            readiness: 'http_listener',
        });
    } finally {
        logger.remove(streamTransport);
    }

    const output = captured.join(' ');
    assert.match(output, /phase=ready/);
    assert.match(output, /readiness=http_listener/);
});
