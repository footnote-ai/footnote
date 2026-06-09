#!/usr/bin/env node
/* eslint-env node */
/* global __dirname, process, console */

/**
 * @description: Opens a short-lived operator settings editor link for the detected Footnote deployment.
 * @footnote-scope: utility
 * @footnote-module: SettingsCommand
 * @footnote-risk: high - Settings links grant privileged config access and must target the intended runtime.
 * @footnote-ethics: high - Settings edits affect governance-sensitive runtime behavior.
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
        `[settings] Target: ${
            target.target === 'fly' ? `fly (${target.flyApp})` : 'local'
        }`
    );

    let payload;
    try {
        payload = await requestOperatorLink({
            ...target,
            action: 'settings',
        });
    } catch (error) {
        if (target.target === 'local') {
            console.error(
                'Footnote is not running. Start it with pnpm start, then run pnpm settings again.'
            );
        }
        throw error;
    }

    console.log(`[settings] Settings state: ${payload.settingsState}`);
    console.log(`[settings] Link expires at: ${payload.expiresAt}`);
    console.log(`[settings] Setup URL: ${payload.setupUrl}`);
    openUrl(payload.setupUrl, 'settings');
};

void main().catch((error) => {
    console.error(
        `[settings] Failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
});
