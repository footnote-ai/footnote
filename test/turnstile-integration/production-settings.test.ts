/**
 * @description: Prevents official Turnstile dummy credentials from entering canonical production settings.
 * @footnote-scope: test
 * @footnote-module: TurnstileProductionSettingsGuard
 * @footnote-risk: medium - A false negative could make automated test credentials deployable.
 * @footnote-ethics: high - Production authentication must never accept test-only CAPTCHA credentials.
 */
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const productionSettingsPath = path.resolve('footnote.yaml');
const dummyCredentials = [
    '1x00000000000000000000BB',
    '2x00000000000000000000BB',
    '1x0000000000000000000000000000000AA',
    '2x0000000000000000000000000000000AA',
];

test('canonical production settings contain no official dummy Turnstile credentials', () => {
    const settings = fs.readFileSync(productionSettingsPath, 'utf8');
    for (const credential of dummyCredentials) {
        assert.equal(
            settings.includes(credential),
            false,
            `production settings must not contain ${credential}`
        );
    }
});
