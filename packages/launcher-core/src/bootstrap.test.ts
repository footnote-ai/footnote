/**
 * @description: Unit tests for launcher bootstrap file creation options.
 * @footnote-scope: test
 * @footnote-module: LauncherBootstrapTests
 * @footnote-risk: low - File bootstrap tests operate on temp directories only.
 * @footnote-ethics: low - Validation improves deterministic local setup behavior.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { bootstrapConfigFiles } from './bootstrap.js';
import { resolveConfigPaths } from './configRoot.js';

const exists = async (filePath: string): Promise<boolean> => {
    try {
        await access(filePath, constants.F_OK);
        return true;
    } catch {
        return false;
    }
};

test('bootstrapConfigFiles can skip settings file creation for setup mode', async () => {
    const tempRoot = await mkdtemp(
        path.join(os.tmpdir(), 'footnote-launcher-')
    );
    const configRoot = path.join(tempRoot, 'config');

    try {
        const paths = resolveConfigPaths(configRoot);
        const result = await bootstrapConfigFiles(paths, {
            createSettingsFile: false,
        });

        assert.equal(await exists(paths.envFilePath), true);
        assert.equal(await exists(paths.launcherMetadataPath), true);
        assert.equal(await exists(paths.settingsFilePath), false);
        assert.equal(
            result.createdPaths.includes(paths.settingsFilePath),
            false
        );
    } finally {
        await rm(tempRoot, { recursive: true, force: true });
    }
});
