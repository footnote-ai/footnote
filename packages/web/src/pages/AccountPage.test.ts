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
    assert.match(headerSource, /<Link to="\/account">\s*Account\s*<\/Link>/);
    assert.match(headerSource, /<Link to="\/account">Account<\/Link>/);
    assert.doesNotMatch(headerSource, /aria-disabled="true"/);
    assert.doesNotMatch(publicStyles, /public-header__unavailable/);
    assert.match(stylesIndex, /@import '\.\/account\.css';/);
});

test('account page uses typed session APIs and exposes all public states', async () => {
    const [source, reports] = await Promise.all([
        readFile(`${webSourceDirectory}pages/AccountPage.tsx`, 'utf8'),
        readFile(`${webSourceDirectory}components/ReportsSection.tsx`, 'utf8'),
    ]);

    assert.match(source, /getAuthSession\(controller\.signal\)/);
    assert.match(source, /controller\.abort\(\)/);
    assert.match(source, /logoutAccount\(session\.csrfToken\)/);
    assert.match(source, /getAccountIncidents\(controller\.signal\)/);
    assert.match(source, /claimIncident\(submittedCode, session\.csrfToken\)/);
    assert.match(source, /Report added to your account/);
    assert.match(reports, /Report \{incident\.incidentId\}/);
    assert.match(source, /Loading account…/);
    assert.match(source, /Sign in to manage your Footnote account/);
    assert.match(source, /Account sign-in isn't available/);
    assert.match(source, /Signed in as \$\{principal\.displayName/);
    assert.match(source, /href="\/api\/auth\/login"/);
    assert.doesNotMatch(
        source,
        /principal\.displayName \?\? principal\.subject/
    );
    assert.match(source, /disabled=\{logoutState === 'submitting'\}/);
    assert.doesNotMatch(source, /Signing out ends only this Footnote session/);
    assert.match(source, /authenticatedSession\.isAdministrator/);
    assert.doesNotMatch(source, /localStorage|sessionStorage/);
    assert.doesNotMatch(source, /accessToken|refreshToken|idToken/);
});

test('account page exposes icon-led memory add, edit, list, and forget controls', async () => {
    const [source, memorySection] = await Promise.all([
        readFile(`${webSourceDirectory}pages/AccountPage.tsx`, 'utf8'),
        readFile(`${webSourceDirectory}components/MemorySection.tsx`, 'utf8'),
    ]);
    assert.match(source, /getAccountMemories/);
    assert.match(
        source,
        /addAccountMemory\([\s\S]*?sessionState\.session\.csrfToken/
    );
    assert.match(
        source,
        /updateAccountMemory\([\s\S]*?sessionState\.session\.csrfToken/
    );
    assert.match(
        source,
        /forgetAccountMemory\([\s\S]*?sessionState\.session\.csrfToken/
    );
    assert.match(
        memorySection,
        /Things you've asked Footnote to remember for future chats/
    );
    assert.match(memorySection, /className="account-page__memory-list"/);
    assert.match(memorySection, /<AccountIcon name="add" \/>/);
    assert.match(memorySection, /<AccountIcon name="edit" \/>/);
    assert.match(memorySection, /<AccountIcon name="delete" \/>/);
    assert.match(memorySection, /<dialog/);
    assert.match(
        memorySection,
        /readState === 'ready' && memories\.length === 0/
    );
    assert.match(memorySection, /Memory limit reached/);
    assert.match(source, /<AccountIcon name="download" \/>/);
});

test('account page confirms deletion and reports signed-out result', async () => {
    const source = await readFile(
        `${webSourceDirectory}pages/AccountPage.tsx`,
        'utf8'
    );

    assert.match(source, /showDeleteConfirmation/);
    assert.match(source, /role="group"/);
    assert.match(source, /deleteAccount\(session\.csrfToken\)/);
    assert.match(source, /Delete account/);
    assert.match(source, /Your Footnote account was deleted/);
    assert.match(source, /Claimed\s+safety reports will remain/);
    assert.match(
        source,
        /identifying details and contact\s+information are removed/
    );
    assert.match(source, /Unclaimed\s+reports are unchanged/);
    assert.match(
        source,
        /Your external\s+sign-in and Discord accounts won't be\s+deleted/
    );
});

test('account report claim drafts reset across logout and account changes', async () => {
    const [source, reports] = await Promise.all([
        readFile(`${webSourceDirectory}pages/AccountPage.tsx`, 'utf8'),
        readFile(`${webSourceDirectory}components/ReportsSection.tsx`, 'utf8'),
    ]);

    assert.match(source, /incidentsState\.accountKey === accountKey/);
    assert.match(reports, /Use a claim code to add a report to your account/);
    assert.match(source, /activeAccountKeyRef\.current === accountKey/);
    assert.match(source, /previousAccountKey !== accountKey/);
    assert.match(
        source,
        /setClaimCodeDraft\(\{ accountKey: null, value: '' \}\)/
    );
    assert.doesNotMatch(source, /getAccountIncident\(/);
    assert.doesNotMatch(source, /View report/);
    assert.doesNotMatch(source, /already used/);
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
    assert.match(source, /accountTitleRef\.current\?\.focus\(\)/);
});

test('Discord connection removes its fragment and offers explicit consent and cancel', async () => {
    const source = await readFile(
        `${webSourceDirectory}pages/AccountPage.tsx`,
        'utf8'
    );

    assert.match(source, /fragment\.get\('connect'\)/);
    assert.match(source, /if \(connectionEffectStartedRef\.current\) return;/);
    assert.match(source, /history\.replaceState/);
    assert.match(source, /exchangeDiscordConnection\(capability\)/);
    assert.match(source, /consentDiscordConnection\(csrfToken\)/);
    assert.match(source, /cancelDiscordConnection\(csrfToken\)/);
    assert.match(source, /Approve connection/);
    assert.match(source, /\/account confirm code:/);
    assert.match(source, /<p role="status">/);
    assert.match(source, /getAccountDiscordStatus\(controller\.signal\)/);
    assert.match(source, /disconnectAccountDiscord\(session\.csrfToken\)/);
    assert.match(source, /Discord connected/);
    assert.match(source, /Discord not connected/);
    assert.doesNotMatch(source, /Discord ID:/);
    assert.match(source, /`@\$\{username\}`/);
    assert.match(source, /<AccountIcon name="disconnect" \/>/);
    assert.match(source, /Disconnecting only removes this/);
});
