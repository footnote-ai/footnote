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

const SAFE_BROWSER_URL_PATTERN =
    /^https?:\/\/[A-Za-z0-9][A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]*$/u;

const parseBrowserUrl = (url) => {
    if (typeof url !== 'string') {
        return null;
    }

    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        if (parsed.username || parsed.password) {
            return null;
        }
        if (!SAFE_BROWSER_URL_PATTERN.test(parsed.href)) {
            return null;
        }
        return parsed.href;
    } catch {
        return null;
    }
};

const openUrl = (url, label = 'settings') => {
    const safeUrl = parseBrowserUrl(url);
    if (!safeUrl) {
        console.warn(`[${label}] Refusing to open an invalid browser URL.`);
        console.log(`[${label}] Open this URL manually: ${url}`);
        return false;
    }

    const command =
        process.platform === 'win32'
            ? 'rundll32.exe'
            : process.platform === 'darwin'
              ? 'open'
              : 'xdg-open';
    const args =
        process.platform === 'win32'
            ? ['url.dll,FileProtocolHandler', safeUrl]
            : [safeUrl];

    const result = spawnSync(command, args, {
        stdio: 'ignore',
        shell: false,
    });

    if (result.error || (result.status ?? 1) !== 0) {
        console.warn(`[${label}] Could not open browser automatically.`);
        console.log(`[${label}] Open this URL manually: ${safeUrl}`);
        return false;
    }
    return true;
};

module.exports = {
    openUrl,
    parseBrowserUrl,
};
