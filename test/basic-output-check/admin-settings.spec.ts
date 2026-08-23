/**
 * @description: Exercises administrator settings access and recovery through the browser UI with backend-shaped responses.
 * @footnote-scope: test
 * @footnote-module: AdminSettingsBrowserCheck
 * @footnote-risk: high - Browser regressions can bypass or break privileged settings authorization.
 * @footnote-ethics: high - Coverage protects administrator-only control and recovery boundaries.
 */
import { expect, test, type Page } from '@playwright/test';

const ACCOUNT_SESSION_COOKIE = 'footnote_account_session';
const SETUP_SESSION_COOKIE = 'footnote_setup_session';
const ACCOUNT_CSRF_HEADER = 'x-auth-csrf';
const SETUP_CSRF_HEADER = 'x-setup-csrf';

const mockRuntimeConfig = async (page: Page): Promise<void> => {
    await page.route('**/config.json', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                turnstileSiteKey: '',
                setup: { required: false, routePath: '/setup' },
            }),
        });
    });
};

test('anonymous administrators see a sign-in prompt without settings requests', async ({
    page,
}) => {
    await mockRuntimeConfig(page);
    await page.route('**/api/auth/session', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ enabled: true, authenticated: false }),
        });
    });

    let settingsRequestCount = 0;
    await page.route('**/api/admin/**', async (route) => {
        settingsRequestCount += 1;
        await route.fulfill({ status: 401, body: 'Unauthorized' });
    });

    await page.goto('/admin');

    await expect(
        page.getByText(
            'Sign in to an administrator account before opening Footnote settings.'
        )
    ).toBeVisible();
    expect(settingsRequestCount).toBe(0);
});

test('account-session administrators read and validate settings with account CSRF', async ({
    page,
}) => {
    await mockRuntimeConfig(page);
    await page.context().addCookies([
        {
            name: ACCOUNT_SESSION_COOKIE,
            value: 'browser-account-session',
            domain: 'output-check.localhost',
            path: '/api',
        },
    ]);
    await page.route('**/api/auth/session', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                enabled: true,
                authenticated: true,
                principal: {
                    issuer: 'https://identity.example/',
                    subject: 'browser-subject',
                    displayName: 'Browser Administrator',
                },
                expiresAt: '2030-01-01T00:00:00.000Z',
                csrfToken: 'account-csrf-token',
            }),
        });
    });

    let readCookie = '';
    let validateCookie = '';
    let validateCsrf = '';
    let validateBody = '';
    let putCookie = '';
    let putCsrf = '';
    await page.route('**/api/admin/settings.yaml', async (route) => {
        const request = route.request();
        if (request.method() === 'GET') {
            readCookie = request.headers().cookie ?? '';
            await route.fulfill({
                contentType: 'text/yaml',
                headers: { etag: '"account-etag"' },
                body: 'version: 1\n',
            });
            return;
        }

        putCookie = request.headers().cookie ?? '';
        putCsrf = request.headers()[ACCOUNT_CSRF_HEADER] ?? '';
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                etag: '"account-etag-2"',
                restartRequired: true,
            }),
        });
    });
    await page.route('**/api/admin/settings/validate', async (route) => {
        const request = route.request();
        validateCookie = request.headers().cookie ?? '';
        validateCsrf = request.headers()[ACCOUNT_CSRF_HEADER] ?? '';
        validateBody = request.postData() ?? '';
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, warnings: [] }),
        });
    });

    await page.goto('/admin');
    await expect(
        page.getByText('Administrator session is active until')
    ).toBeVisible();
    await expect(page.locator('textarea')).toHaveValue('version: 1\n');

    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(
        page.getByText('Settings saved. Restart Footnote to use them.')
    ).toBeVisible();

    expect(readCookie).toContain(
        `${ACCOUNT_SESSION_COOKIE}=browser-account-session`
    );
    expect(validateCookie).toContain(
        `${ACCOUNT_SESSION_COOKIE}=browser-account-session`
    );
    expect(validateCsrf).toBe('account-csrf-token');
    expect(validateBody).toBe('version: 1\n');
    expect(putCookie).toContain(
        `${ACCOUNT_SESSION_COOKIE}=browser-account-session`
    );
    expect(putCsrf).toBe('account-csrf-token');
});

test('setup recovery uses the setup session and setup CSRF header', async ({
    page,
}) => {
    await mockRuntimeConfig(page);
    await page.context().addCookies([
        {
            name: SETUP_SESSION_COOKIE,
            value: 'browser-setup-session',
            domain: 'output-check.localhost',
            path: '/api',
        },
    ]);

    let setupCode = '';
    let validateCookie = '';
    let validateCsrf = '';
    let putCsrf = '';
    await page.route('**/api/setup/session', async (route) => {
        const payload = route.request().postDataJSON() as { code: string };
        setupCode = payload.code;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                expiresAt: '2030-01-01T00:00:00.000Z',
                csrfToken: 'setup-csrf-token',
            }),
        });
    });
    await page.route('**/api/admin/settings.yaml', async (route) => {
        const request = route.request();
        if (request.method() === 'GET') {
            await route.fulfill({
                contentType: 'text/yaml',
                headers: { etag: '"setup-etag"' },
                body: 'version: 1\n',
            });
            return;
        }

        putCsrf = request.headers()[SETUP_CSRF_HEADER] ?? '';
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                etag: '"setup-etag-2"',
                restartRequired: true,
            }),
        });
    });
    await page.route('**/api/admin/settings/validate', async (route) => {
        const request = route.request();
        validateCookie = request.headers().cookie ?? '';
        validateCsrf = request.headers()[SETUP_CSRF_HEADER] ?? '';
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, warnings: [] }),
        });
    });

    await page.goto('/setup#code=setup-code');
    await expect(page.getByText('Setup session is active until')).toBeVisible();
    await expect(page.locator('textarea')).toHaveValue('version: 1\n');

    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(
        page.getByText('Settings saved. Restart Footnote to use them.')
    ).toBeVisible();

    expect(setupCode).toBe('setup-code');
    expect(validateCookie).toContain(
        `${SETUP_SESSION_COOKIE}=browser-setup-session`
    );
    expect(validateCsrf).toBe('setup-csrf-token');
    expect(putCsrf).toBe('setup-csrf-token');
});
