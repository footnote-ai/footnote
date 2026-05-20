#!/usr/bin/env node
/**
 * @description: Builds launcher-core and launcher-cli outputs required before SEA packaging.
 * @footnote-scope: utility
 * @footnote-module: SeaPrepareBuild
 * @footnote-risk: medium - Missing prebuild artifacts will break SEA packaging workflows.
 * @footnote-ethics: low - Build-only script with no runtime governance impact.
 */

import { spawnSync } from 'node:child_process';

const run = (command, args) => {
    const result = spawnSync(command, args, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
};

run('pnpm', ['build:launcher-core']);
run('pnpm', ['build:launcher-cli']);
