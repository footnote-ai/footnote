#!/usr/bin/env node
/**
 * @description: Verifies SEA launcher binaries expose help and read-only status behavior.
 * @footnote-scope: utility
 * @footnote-module: SeaVerify
 * @footnote-risk: medium - Incomplete verification can allow broken release artifacts.
 * @footnote-ethics: low - Verification improves reliability transparency for distributed binaries.
 */

import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const outputDir = join(
    repoRoot,
    'artifacts',
    'sea',
    `${process.platform}-${process.arch}`
);
const binaryName =
    process.platform === 'win32'
        ? `footnote-${process.platform}-${process.arch}.exe`
        : `footnote-${process.platform}-${process.arch}`;
const binaryPath = join(outputDir, binaryName);

const run = (args) => {
    const result = spawnSync(binaryPath, args, {
        stdio: 'pipe',
        encoding: 'utf8',
    });
    return result;
};

const helpResult = run(['--help']);
if (helpResult.status !== 0) {
    console.error(helpResult.stdout);
    console.error(helpResult.stderr);
    process.exit(helpResult.status ?? 1);
}

const tempConfigDir = mkdtempSync(
    join(os.tmpdir(), 'footnote-launcher-status-')
);
const statusResult = run(['status', '--config-dir', tempConfigDir]);
if (statusResult.status !== 0) {
    console.error(statusResult.stdout);
    console.error(statusResult.stderr);
    process.exit(statusResult.status ?? 1);
}

if (!statusResult.stdout.includes('state: not_found')) {
    console.error(`Unexpected status output for ${basename(binaryPath)}:`);
    console.error(statusResult.stdout);
    process.exit(1);
}

console.log(`SEA verification passed for ${basename(binaryPath)}.`);
