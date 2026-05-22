/**
 * @description: Unit tests for launcher CLI argument parsing including setup command routing.
 * @footnote-scope: test
 * @footnote-module: LauncherCliArgsTests
 * @footnote-risk: low - Parser tests validate command routing inputs and do not mutate runtime resources.
 * @footnote-ethics: low - Argument parsing tests improve predictability without governance impact.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLauncherArgs } from './args.js';

test('parseLauncherArgs accepts setup command', () => {
    const parsed = parseLauncherArgs(['setup']);
    assert.equal(parsed.command, 'setup');
    assert.equal(parsed.headless, false);
});

test('parseLauncherArgs keeps setup command compatible with shared options', () => {
    const parsed = parseLauncherArgs(['setup', '--config-dir', './tmp']);
    assert.equal(parsed.command, 'setup');
    assert.equal(parsed.configDir, './tmp');
});

test('parseLauncherArgs defaults no-arg command to info', () => {
    const parsed = parseLauncherArgs([]);
    assert.equal(parsed.command, 'info');
    assert.equal(parsed.headless, false);
    assert.equal(parsed.follow, true);
});

test('parseLauncherArgs accepts info command', () => {
    const parsed = parseLauncherArgs(['info']);
    assert.equal(parsed.command, 'info');
    assert.equal(parsed.headless, false);
});

test('parseLauncherArgs accepts update command', () => {
    const parsed = parseLauncherArgs(['update']);
    assert.equal(parsed.command, 'update');
    assert.equal(parsed.headless, false);
});
