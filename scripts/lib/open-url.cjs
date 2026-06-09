#!/usr/bin/env node
/* eslint-env node */

/**
 * @description: Opens operator URLs in the platform browser while failing open by printing the link.
 * @footnote-scope: utility
 * @footnote-module: OpenUrlHelper
 * @footnote-risk: low - Browser launch failures should not block manual operator setup.
 * @footnote-ethics: low - Helper only affects local operator convenience.
 */

const { spawnSync } = require('node:child_process');

const openUrl = (url, label = 'settings') => {
    const command =
        process.platform === 'win32'
            ? 'cmd'
            : process.platform === 'darwin'
              ? 'open'
              : 'xdg-open';
    const args =
        process.platform === 'win32' ? ['/c', 'start', '', url] : [url];

    const result = spawnSync(command, args, {
        stdio: 'ignore',
        shell: false,
    });

    if (result.error || (result.status ?? 1) !== 0) {
        console.warn(`[${label}] Could not open browser automatically.`);
        console.log(`[${label}] Open this URL manually: ${url}`);
        return false;
    }
    return true;
};

module.exports = {
    openUrl,
};
