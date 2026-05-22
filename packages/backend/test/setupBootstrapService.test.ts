/**
 * @description: Verifies setup bootstrap code/session lifecycle semantics for first-setup access control.
 * @footnote-scope: test
 * @footnote-module: SetupBootstrapServiceTests
 * @footnote-risk: high - Missing tests can allow setup bootstrap/session regressions that weaken privileged setup gating.
 * @footnote-ethics: high - First-setup auth tests protect who can initialize governance-sensitive runtime configuration.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSetupBootstrapService } from '../src/services/setupBootstrap.js';

const createTempSettingsPath = (): {
    tempDir: string;
    settingsPath: string;
    cleanup: () => void;
} => {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-setup-bootstrap-')
    );
    const settingsPath = path.join(tempDir, 'footnote.yaml');
    return {
        tempDir,
        settingsPath,
        cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
    };
};

test('bootstrap code is reused while active, single-use on exchange, and rotated after expiry', async () => {
    const { settingsPath, cleanup } = createTempSettingsPath();
    let nowMs = Date.now();
    let tokenCounter = 0;
    const service = createSetupBootstrapService({
        settingsPath,
        now: () => nowMs,
        bootstrapCodeTtlMs: 60_000,
        sessionTtlMs: 60_000,
        randomToken: () => `token_${++tokenCounter}`,
    });
    try {
        const first = await service.issueOrGetActiveCode();
        assert.ok(first);
        const reused = await service.issueOrGetActiveCode();
        assert.ok(reused);
        assert.equal(reused.code, first.code);

        const exchanged = await service.exchangeCodeForSession(first.code);
        assert.equal(exchanged.ok, true);

        const reusedAfterExchange = await service.exchangeCodeForSession(
            first.code
        );
        assert.deepEqual(reusedAfterExchange, {
            ok: false,
            reason: 'invalid_code',
        });

        nowMs += 60_001;
        const rotated = await service.issueOrGetActiveCode();
        assert.ok(rotated);
        assert.notEqual(rotated.code, first.code);
    } finally {
        cleanup();
    }
});

test('setup session validate/expiry/clear lifecycle is enforced', async () => {
    const { settingsPath, cleanup } = createTempSettingsPath();
    let nowMs = Date.now();
    let tokenCounter = 0;
    const service = createSetupBootstrapService({
        settingsPath,
        now: () => nowMs,
        bootstrapCodeTtlMs: 60_000,
        sessionTtlMs: 10_000,
        randomToken: () => `token_${++tokenCounter}`,
    });
    try {
        const issued = await service.issueOrGetActiveCode();
        assert.ok(issued);
        const exchanged = await service.exchangeCodeForSession(issued.code);
        assert.equal(exchanged.ok, true);
        if (!exchanged.ok) {
            return;
        }

        const validated = await service.validateSetupSession(
            exchanged.session.sessionId
        );
        assert.ok(validated);
        assert.equal(validated?.csrfToken, exchanged.session.csrfToken);

        service.clearSetupSession(exchanged.session.sessionId);
        const cleared = await service.validateSetupSession(
            exchanged.session.sessionId
        );
        assert.equal(cleared, null);

        const secondCode = await service.issueOrGetActiveCode();
        assert.ok(secondCode);
        const secondExchange = await service.exchangeCodeForSession(
            secondCode.code
        );
        assert.equal(secondExchange.ok, true);
        if (!secondExchange.ok) {
            return;
        }

        nowMs += 10_001;
        const expired = await service.validateSetupSession(
            secondExchange.session.sessionId
        );
        assert.equal(expired, null);
    } finally {
        cleanup();
    }
});
