/**
 * @description: Protects account-page session states, typed API usage, and route integration.
 * @footnote-scope: test
 * @footnote-module: AccountPageTests
 * @footnote-risk: low - Assertions inspect account web source and styles only.
 * @footnote-ethics: high - Coverage prevents misleading identity state or unsafe browser credential storage.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const webSourceDirectory = `${path.join(
    process.cwd(),
    'packages',
    'web',
    'src'
)}${path.sep}`;

test('account route is lazy, preloaded, styled, and linked from the public header', async () => {
    const [appSource, headerSource, stylesIndex, publicStyles] =
        await Promise.all([
            readFile(`${webSourceDirectory}App.tsx`, 'utf8'),
            readFile(
                `${webSourceDirectory}components/PublicHeader.tsx`,
                'utf8'
            ),
            readFile(`${webSourceDirectory}styles/index.css`, 'utf8'),
            readFile(`${webSourceDirectory}styles/public-home.css`, 'utf8'),
        ]);

    assert.match(appSource, /loadAccountPage/);
    assert.match(appSource, /path="\/account"/);
    assert.match(appSource, /<AccountPage \/>/);
    assert.match(appSource, /loadAccountPage\(\)/);
    assert.match(headerSource, /<Link to="\/account">\s*Sign in\s*<\/Link>/);
    assert.doesNotMatch(headerSource, /aria-disabled="true"/);
    assert.doesNotMatch(publicStyles, /public-header__unavailable/);
    assert.match(stylesIndex, /@import '\.\/account\.css';/);
});

test('account page uses typed session APIs and exposes all public states', async () => {
    const source = await readFile(
        `${webSourceDirectory}pages/AccountPage.tsx`,
        'utf8'
    );

    assert.match(source, /getAuthSession\(controller\.signal\)/);
    assert.match(source, /controller\.abort\(\)/);
    assert.match(source, /logoutAccount\(session\.csrfToken\)/);
    assert.match(source, /Loading account…/);
    assert.match(source, /Sign-in is unavailable/);
    assert.match(source, /Signed out/);
    assert.match(source, /Signed in/);
    assert.match(source, /href="\/api\/auth\/login"/);
    assert.match(source, /principal\.displayName \?\? principal\.subject/);
    assert.match(source, /disabled=\{logoutState === 'submitting'\}/);
    assert.match(source, /Signing out ends only this Footnote session/);
    assert.doesNotMatch(source, /localStorage|sessionStorage/);
    assert.doesNotMatch(source, /accessToken|refreshToken|idToken/);
});

test('account page reports callback failure without retaining its query marker', async () => {
    const source = await readFile(
        `${webSourceDirectory}pages/AccountPage.tsx`,
        'utf8'
    );

    assert.match(source, /get\('auth'\) === 'failed'/);
    assert.match(source, /searchParams\.delete\('auth'\)/);
    assert.match(source, /history\.replaceState/);
    assert.match(source, /Sign-in could not be completed/);
    assert.match(source, /role="alert"/);
    assert.match(source, /aria-live="polite"/);
    assert.match(source, /accountStatusHeadingRef\.current\?\.focus\(\)/);
});
