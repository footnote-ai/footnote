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

const mockAdministratorSession = async (page: Page): Promise<void> => {
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
                isAdministrator: true,
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
        page.getByText('Sign in with an admin account to continue.')
    ).toBeVisible();
    await expect(
        page.locator('#main-content').getByRole('link', { name: 'Sign in' })
    ).toHaveAttribute('href', '/api/auth/login');
    expect(settingsRequestCount).toBe(0);
});

test('signed-in non-admins see no settings controls or settings requests', async ({
    page,
}) => {
    await mockRuntimeConfig(page);
    await page.route('**/api/auth/session', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                enabled: true,
                authenticated: true,
                principal: {
                    issuer: 'https://identity.example/',
                    subject: 'ordinary-user',
                    displayName: 'Jordan Example',
                },
                expiresAt: '2030-01-01T00:00:00.000Z',
                csrfToken: 'account-csrf-token',
                isAdministrator: false,
            }),
        });
    });

    let settingsRequestCount = 0;
    await page.route('**/api/admin/**', async (route) => {
        settingsRequestCount += 1;
        await route.fulfill({ status: 403, body: 'Forbidden' });
    });

    await page.goto('/admin');
    await expect(
        page.getByText("You don't have access to admin settings.")
    ).toBeVisible();
    await expect(
        page.locator('#main-content').getByRole('link', { name: 'Account' })
    ).toBeVisible();
    await expect(page.locator('textarea')).toHaveCount(0);
    expect(settingsRequestCount).toBe(0);
});

test('account-session administrators read and validate settings with account CSRF', async ({
    page,
}, testInfo) => {
    await mockRuntimeConfig(page);
    await mockAdministratorSession(page);
    await page.context().addCookies([
        {
            name: ACCOUNT_SESSION_COOKIE,
            value: 'browser-account-session',
            domain: 'output-check.localhost',
            path: '/api',
        },
    ]);
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
    await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText(/session is active until/i)).toHaveCount(0);
    await expect(page.getByText('Settings YAML editor')).toHaveCount(0);
    await page.screenshot({
        path: testInfo.outputPath('admin-settings.png'),
        fullPage: true,
    });
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await page.screenshot({
        path: testInfo.outputPath('admin-settings-dark.png'),
        fullPage: true,
    });
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
        path: testInfo.outputPath('admin-settings-mobile.png'),
        fullPage: true,
    });
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
        )
    ).toBe(true);
    await expect(page.locator('textarea')).toHaveValue('version: 1\n');

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
        page.getByText('Saved. Restart Footnote to apply changes.')
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

test('admin save explains a stale settings file without lock terminology', async ({
    page,
}) => {
    await mockRuntimeConfig(page);
    await mockAdministratorSession(page);
    await page.route('**/api/admin/settings.yaml', async (route) => {
        if (route.request().method() === 'GET') {
            await route.fulfill({
                contentType: 'text/yaml',
                headers: { etag: '"account-etag"' },
                body: 'version: 1\n',
            });
            return;
        }
        await route.fulfill({ status: 412, body: 'Precondition failed' });
    });
    await page.route('**/api/admin/settings/validate', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, warnings: [] }),
        });
    });

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
        page.getByText(
            'Settings changed elsewhere. Reload the page and try again.'
        )
    ).toBeVisible();
    await expect(page.getByText(/optimistic lock/i)).toHaveCount(0);
});

test('admin save retains the validator error and its specific guidance', async ({
    page,
}) => {
    await mockRuntimeConfig(page);
    await mockAdministratorSession(page);
    await page.route('**/api/admin/settings.yaml', async (route) => {
        if (route.request().method() === 'GET') {
            await route.fulfill({
                contentType: 'text/yaml',
                headers: { etag: '"account-etag"' },
                body: 'version: 1\n',
            });
            return;
        }
        throw new Error('Invalid YAML must not be written');
    });
    await page.route('**/api/admin/settings/validate', async (route) => {
        await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
                error: 'Settings validation failed',
                validationErrors: [
                    {
                        category: 'invalid_version',
                        pointer: '/version',
                        message: 'Version must be 1.',
                    },
                ],
            }),
        });
    });

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
        page.getByText('Validation failed. Fix the listed issues.')
    ).toBeVisible();
    await expect(page.getByText('Version must be 1.')).toBeVisible();
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
