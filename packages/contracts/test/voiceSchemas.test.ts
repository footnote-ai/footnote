/**
 * @description: Protects speech request schemas from silently accepting blank explicit overrides.
 * @footnote-scope: test
 * @footnote-module: VoiceSchemasTest
 * @footnote-risk: low - Tests pin validation behavior at the shared voice boundary.
 * @footnote-ethics: medium - Blank explicit overrides must not be mistaken for accepted operator intent.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    InternalVoiceRealtimeClientEventSchema,
    PostInternalVoiceTtsRequestSchema,
} from '../src/voice/schemas.js';

test('TTS rejects whitespace-only explicit speech settings', () => {
    const invalidSettings = [
        { model: ' ' },
        { voice: '\t' },
        { delivery: '  ' },
        { styleNote: '\n' },
    ];

    for (const options of invalidSettings) {
        const parsed = PostInternalVoiceTtsRequestSchema.safeParse({
            task: 'synthesize',
            text: 'Hello',
            outputFormat: 'mp3',
            options,
        });

        assert.equal(parsed.success, false, JSON.stringify(options));
    }
});

test('Realtime rejects whitespace-only explicit speech settings', () => {
    for (const options of [
        { model: ' ' },
        { voice: '\t' },
        { delivery: '\n' },
    ]) {
        const parsed = InternalVoiceRealtimeClientEventSchema.safeParse({
            type: 'session.start',
            context: { participants: [] },
            options,
        });

        assert.equal(parsed.success, false, JSON.stringify(options));
    }
});
