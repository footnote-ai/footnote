/**
 * @description: Verifies the public context readiness gate defaults safely and parses explicit enablement.
 * @footnote-scope: test
 * @footnote-module: WebConfigTests
 * @footnote-risk: low - Configuration tests protect optional public messaging from premature exposure.
 * @footnote-ethics: medium - Readiness gates must not advertise unavailable source context.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWebSection } from '../src/config/sections/web.js';

test('public context messaging is disabled by default', () => {
    const config = buildWebSection({}, () => undefined);

    assert.equal(config.publicContext.nycSept11RecordsEnabled, false);
});

test('public context messaging accepts explicit readiness enablement', () => {
    const config = buildWebSection(
        { FOOTNOTE_PUBLIC_NYC_SEPT11_RECORDS_ENABLED: 'true' },
        () => undefined
    );

    assert.equal(config.publicContext.nycSept11RecordsEnabled, true);
});
