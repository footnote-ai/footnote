/**
 * @description: Verifies remaining bot-local prompt paths apply profile overlay composition consistently.
 * @footnote-scope: test
 * @footnote-module: ProfileLocalPromptPathTests
 * @footnote-risk: low - These tests validate prompt construction only.
 * @footnote-ethics: high - Local prompt paths must preserve base safety while applying vendor overlays consistently.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RealtimeContextBuilder } from '../src/utils/prompting/RealtimeContextBuilder.js';

test('RealtimeContextBuilder keeps participant and transcript data in session context', () => {
    const builder = new RealtimeContextBuilder();
    const result = builder.buildContext({
        participants: [{ id: 'u1', displayName: 'Jordan' }],
        transcripts: ['Earlier topic summary'],
    });

    assert.deepEqual(result.sessionContext, {
        participants: [{ id: 'u1', displayName: 'Jordan' }],
        transcripts: ['Earlier topic summary'],
    });
});
