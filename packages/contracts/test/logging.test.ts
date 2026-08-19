/**
 * @description: Tests the serializable runtime lifecycle event contract.
 * @footnote-scope: test
 * @footnote-module: RuntimeLoggingContractTests
 * @footnote-risk: low - Contract test failures expose event drift before deployment.
 * @footnote-ethics: medium - Stable readiness fields support honest operator communication.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeLifecycleEvent } from '../src/logging.js';

test('creates a starting event with only bounded runtime identity', () => {
    assert.deepEqual(
        createRuntimeLifecycleEvent(
            { service: 'discord-bot', nodeId: 'danny', profileId: 'default' },
            'starting'
        ),
        {
            event: 'footnote.runtime.starting',
            phase: 'starting',
            service: 'discord-bot',
            nodeId: 'danny',
            profileId: 'default',
        }
    );
});

test('creates a ready event with its declared readiness boundary', () => {
    const event = createRuntimeLifecycleEvent(
        { service: 'backend' },
        'ready',
        'http_listener'
    );

    assert.deepEqual(event, {
        event: 'footnote.runtime.ready',
        phase: 'ready',
        service: 'backend',
        readiness: 'http_listener',
    });
    assert.equal(JSON.stringify(event).includes('secret'), false);
});
