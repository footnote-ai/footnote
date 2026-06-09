#!/usr/bin/env node
/* eslint-env node */
/* global __dirname, process, console */

/**
 * @description: Backs up current settings, resets the canonical config path, and opens first-start settings setup.
 * @footnote-scope: utility
 * @footnote-module: ResetCommand
 * @footnote-risk: high - Reset changes which runtime config file is active and must preserve backups.
 * @footnote-ethics: high - Reset affects governance-sensitive runtime configuration and operator control.
 */

const path = require('node:path');
const { resolveDeploymentTarget } = require('./lib/deployment-target.cjs');
const { requestOperatorLink } = require('./lib/operator-link.cjs');
const { openUrl } = require('./lib/open-url.cjs');

const repoRoot = path.resolve(__dirname, '..');

const main = async () => {
    const target = resolveDeploymentTarget({
        argv: process.argv.slice(2),
        repoRoot,
    });
    console.log(
        `[reset] Target: ${
            target.target === 'fly' ? `fly (${target.flyApp})` : 'local'
        }`
    );

    let payload;
    try {
        payload = await requestOperatorLink({
            ...target,
            action: 'reset',
        });
    } catch (error) {
        if (target.target === 'local') {
            console.error(
                'Footnote is not running. Start it with pnpm start, then run pnpm reset again.'
            );
        }
        throw error;
    }

    if (payload.backupPath) {
        console.log(
            `[reset] Backed up current config to: ${payload.backupPath}`
        );
    } else {
        console.log('[reset] No existing config was present to back up.');
    }
    console.log(`[reset] Link expires at: ${payload.expiresAt}`);
    console.log(`[reset] Setup URL: ${payload.setupUrl}`);
    openUrl(payload.setupUrl, 'reset');
};

void main().catch((error) => {
    console.error(
        `[reset] Failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
});
