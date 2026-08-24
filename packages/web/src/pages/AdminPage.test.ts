/**
 * @description: Protects the administrator route wiring and account-session settings mode.
 * @footnote-scope: test
 * @footnote-module: AdminPageTests
 * @footnote-risk: medium - Route assertions catch accidental loss of the administrator entry point.
 * @footnote-ethics: high - Tests keep privileged presentation separate from backend authorization.
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

test('admin route lazy-loads the account-session settings page', async () => {
    const [appSource, adminSource, setupSource] = await Promise.all([
        readFile(`${webSourceDirectory}App.tsx`, 'utf8'),
        readFile(`${webSourceDirectory}pages/AdminPage.tsx`, 'utf8'),
        readFile(`${webSourceDirectory}pages/SetupPage.tsx`, 'utf8'),
    ]);

    assert.match(appSource, /loadAdminPage/);
    assert.match(appSource, /path="\/admin"/);
    assert.match(appSource, /<AdminPage \/>/);
    assert.match(adminSource, /<SetupPage mode="admin" \/>/);
    assert.match(setupSource, /getAuthSession\(\)/);
    assert.match(setupSource, /Sign in to an administrator account/);
    assert.match(setupSource, /Administrator settings/);
    assert.match(setupSource, /ACCOUNT_CSRF_HEADER_NAME = 'x-auth-csrf'/);
    assert.match(setupSource, /SETUP_CSRF_HEADER_NAME = 'x-setup-csrf'/);
    assert.match(setupSource, /\[csrfHeaderName\]: exchangeState\.csrfToken/);
    assert.doesNotMatch(setupSource, /localStorage|sessionStorage/);
});
