/**
 * @description: Exercises the one-time repository-context setup flow with backend-shaped responses.
 * Confirms the setup session controls destination tests and loading without exposing TrustGraph secrets.
 * @footnote-scope: test
 * @footnote-module: RepositoryContextSetupBrowserCheck
 * @footnote-risk: high - Browser setup regressions could expose credentials or bypass the intended connection test.
 * @footnote-ethics: high - Operators need a clear preview and truthful load result before sharing project files.
 */
import { expect, test, type Page } from '@playwright/test';

const SETUP_SESSION_COOKIE = 'footnote_setup_session';
const SETUP_CSRF_HEADER = 'x-setup-csrf';

const mockSetupBase = async (page: Page): Promise<void> => {
    await page.route('**/config.json', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                turnstileSiteKey: '',
                setup: { required: false, routePath: '/setup' },
            }),
        });
    });
    await page.context().addCookies([
        {
            name: SETUP_SESSION_COOKIE,
            value: 'browser-setup-session',
            domain: 'output-check.localhost',
            path: '/api',
        },
    ]);
    await page.route('**/api/setup/session', async (route) => {
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
        await route.fulfill({
            contentType: 'text/yaml',
            headers: { etag: '"setup-etag"' },
            body: 'version: 1\n',
        });
    });
};

test('setup can test a configured target, review context, and show load results', async ({
    page,
}) => {
    await mockSetupBase(page);
    let testedTarget = '';
    let testedCsrf = '';
    let loadedTarget = '';
    let loadedCsrf = '';

    await page.route(
        '**/api/setup/repository-context/connection',
        async (route) => {
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                    configured: true,
                    targets: [
                        {
                            id: 'approved-target',
                            flow: 'context-flow',
                            collection: 'repository-context',
                            workspace: 'server-workspace',
                        },
                    ],
                }),
            });
        }
    );
    await page.route(
        '**/api/setup/repository-context/connection/test',
        async (route) => {
            const request = route.request();
            testedTarget = (request.postDataJSON() as { targetId: string })
                .targetId;
            testedCsrf = request.headers()[SETUP_CSRF_HEADER] ?? '';
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                    connected: true,
                    targetId: 'approved-target',
                    testedAt: '2026-10-07T12:00:00.000Z',
                }),
            });
        }
    );
    await page.route(
        '**/api/setup/repository-context/preview',
        async (route) => {
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                    revision: 'a'.repeat(40),
                    fileCount: 1,
                    totalBytes: 1_024,
                    files: [{ path: 'README.md', sizeBytes: 1_024 }],
                    skipped: [
                        {
                            path: 'docs/private.md',
                            reason: 'excluded by policy',
                        },
                    ],
                }),
            });
        }
    );
    await page.route('**/api/setup/repository-context/load', async (route) => {
        const request = route.request();
        loadedTarget = (request.postDataJSON() as { targetId: string })
            .targetId;
        loadedCsrf = request.headers()[SETUP_CSRF_HEADER] ?? '';
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                repositoryId: 'https://github.com/footnote-ai/footnote',
                startedAt: '2026-10-07T12:00:00.000Z',
                completedAt: '2026-10-07T12:00:01.000Z',
                selectedFileCount: 1,
                selectedBytes: 1_024,
                counts: {
                    added: 1,
                    changed: 0,
                    unchanged: 0,
                    skipped: 0,
                    failed: 0,
                },
                items: [
                    { path: 'README.md', status: 'added', sizeBytes: 1_024 },
                ],
            }),
        });
    });

    await page.goto('/setup#code=setup-code');
    await expect(
        page.getByRole('heading', { name: 'Repository context' })
    ).toBeVisible();
    await expect(page.getByText('1 file · 1.0 KB (1,024 bytes)')).toBeVisible();
    await expect(page.getByText('README.md')).toBeVisible();
    await page.getByText('1 skipped file').click();
    await expect(page.getByText('docs/private.md')).toBeVisible();

    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('Connection tested.')).toBeVisible();
    await page.getByRole('button', { name: 'Load context' }).click();
    await expect(page.getByText('Repository context loaded.')).toBeVisible();
    await expect(
        page.locator('.setup-context__result dl div').filter({
            hasText: 'Added',
        })
    ).toContainText('1');
    await expect(page.getByText('README.md — added')).toBeVisible();

    expect(testedTarget).toBe('approved-target');
    expect(loadedTarget).toBe('approved-target');
    expect(testedCsrf).toBe('setup-csrf-token');
    expect(loadedCsrf).toBe('setup-csrf-token');
    await expect(page.getByText(/token|secret/i)).toHaveCount(0);
});

test('setup keeps context preview available without configured TrustGraph', async ({
    page,
}) => {
    await mockSetupBase(page);
    await page.route(
        '**/api/setup/repository-context/connection',
        async (route) => {
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({ configured: false, targets: [] }),
            });
        }
    );
    await page.route(
        '**/api/setup/repository-context/preview',
        async (route) => {
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                    revision: 'a'.repeat(40),
                    fileCount: 0,
                    totalBytes: 0,
                    files: [],
                    skipped: [],
                }),
            });
        }
    );

    await page.goto('/setup#code=setup-code');
    await expect(
        page.getByText('TrustGraph is not configured on this deployment.')
    ).toBeVisible();
    await expect(
        page.getByRole('heading', { name: 'Repository context' })
    ).toBeVisible();
    await expect(page.getByText('0 files · 0 bytes')).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Test connection' })
    ).toHaveCount(0);
});
