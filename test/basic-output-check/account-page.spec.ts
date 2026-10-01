/**
 * @description: Checks the account page's signed-out and signed-in browser behavior against API-shaped fixtures.
 * @footnote-scope: test
 * @footnote-module: AccountPageBrowserCheck
 * @footnote-risk: medium - Browser checks protect account controls and account-scoped data access.
 * @footnote-ethics: high - Coverage supports clear identity, privacy, and destructive-action consent.
 */
import { expect, test, type Page } from '@playwright/test';

const mockConfig = async (page: Page): Promise<void> => {
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

const mockSignedOut = async (page: Page): Promise<void> => {
    await mockConfig(page);
    await page.route('**/api/auth/session', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ enabled: true, authenticated: false }),
        });
    });
    await page.route('**/api/auth/discord-connection', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ state: 'none' }),
        });
    });
};

const mockSignedIn = async (
    page: Page,
    discordConnected = false,
    discordUsername: string | null = 'jordan'
): Promise<{ disconnectCsrf: string[] }> => {
    await mockConfig(page);
    await page.route('**/api/auth/session', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                enabled: true,
                authenticated: true,
                principal: {
                    issuer: 'https://identity.example/',
                    subject: 'provider-subject-not-for-display',
                    displayName: 'Jordan Example',
                },
                isAdministrator: true,
                expiresAt: '2030-01-01T00:00:00.000Z',
                csrfToken: 'account-csrf-token',
            }),
        });
    });
    await page.route('**/api/auth/discord-connection', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ state: 'none' }),
        });
    });
    const disconnectCsrf: string[] = [];
    await page.route('**/api/account/discord-connection', async (route) => {
        if (route.request().method() === 'DELETE') {
            disconnectCsrf.push(route.request().headers()['x-auth-csrf'] ?? '');
            await route.fulfill({ status: 204 });
            return;
        }
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                connected: discordConnected,
                accounts: discordConnected
                    ? [{ username: discordUsername }]
                    : [],
            }),
        });
    });
    await page.route('**/api/account/incidents', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                incidents: [
                    {
                        incidentId: 'ABC123',
                        status: 'under_review',
                        createdAt: '2026-09-20T10:00:00.000Z',
                        updatedAt: '2026-09-22T10:00:00.000Z',
                    },
                ],
            }),
        });
    });
    await page.route('**/api/account/memories', async (route) => {
        if (route.request().method() === 'GET') {
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                    memories: [
                        {
                            id: '00000000-0000-4000-8000-000000000001',
                            text: 'Prefers concise technical answers.',
                            createdAt: '2026-09-20T10:00:00.000Z',
                        },
                    ],
                }),
            });
            return;
        }
        const body: unknown = JSON.parse(route.request().postData() ?? '{}');
        const text =
            typeof body === 'object' &&
            body !== null &&
            'text' in body &&
            typeof body.text === 'string'
                ? body.text
                : '';
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                memory: {
                    id: '00000000-0000-4000-8000-000000000002',
                    text,
                    createdAt: '2026-09-20T11:00:00.000Z',
                },
            }),
        });
    });
    await page.route('**/api/account/memories/*', async (route) => {
        await route.fulfill({ contentType: 'application/json', body: '{}' });
    });
    return { disconnectCsrf };
};

test('signed-out Account offers one sign-in path', async ({
    page,
}, testInfo) => {
    await mockSignedOut(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.getByRole('link', { name: 'Account' }).click();
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
    await page.screenshot({
        path: testInfo.outputPath('account-signed-out.png'),
        fullPage: true,
    });

    await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();
    await expect(
        page.getByRole('link', { name: 'Sign in', exact: true })
    ).toHaveCount(1);
    await expect(
        page.getByRole('heading', { name: 'Your reports' })
    ).toHaveCount(0);
    await expect(
        page.getByRole('heading', { name: 'Your memories' })
    ).toHaveCount(0);
});

test('signed-in Account shows manageable data without provider identifiers', async ({
    page,
}, testInfo) => {
    await mockSignedIn(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/account');
    await expect(
        page.getByRole('heading', { name: 'Signed in as Jordan Example' })
    ).toBeVisible();
    await page.screenshot({
        path: testInfo.outputPath('account-signed-in.png'),
        fullPage: true,
    });
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(
        page.getByRole('button', { name: 'Switch to light mode' })
    ).toBeVisible();
    await page.screenshot({
        path: testInfo.outputPath('account-signed-in-dark.png'),
        fullPage: true,
    });
    await page.getByRole('button', { name: 'Switch to light mode' }).click();

    await expect(page.getByText('Signed in as Jordan Example')).toBeVisible();
    await expect(
        page.getByText('provider-subject-not-for-display')
    ).toHaveCount(0);
    await expect(page.getByText('identity.example')).toHaveCount(0);
    await expect(
        page.getByRole('link', { name: 'Admin settings' })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Memory' })).toBeVisible();
    await expect(
        page.getByRole('heading', { name: 'Connections' })
    ).toBeVisible();
    await expect(page.getByText('Discord not connected.')).toBeVisible();
    await expect(page.getByText('/account connect')).toBeVisible();
    await expect(
        page.getByText(
            "Things you've asked Footnote to remember for future chats."
        )
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await expect(
        page.getByRole('heading', { name: 'Report ABC123' })
    ).toBeVisible();
    await expect(
        page.getByRole('heading', { name: 'Account data' })
    ).toBeVisible();
    await expect(
        page.getByRole('link', { name: 'Download account data' })
    ).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
        path: testInfo.outputPath('account-signed-in-mobile.png'),
        fullPage: true,
    });
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
        )
    ).toBe(true);
});

test('account holders can see and disconnect their Discord link', async ({
    page,
}, testInfo) => {
    const { disconnectCsrf } = await mockSignedIn(page, true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/account');

    await expect(page.getByText('Discord connected.')).toBeVisible();
    await expect(page.getByText('@jordan')).toBeVisible();
    await expect(page.getByText('123456789012345678')).toHaveCount(0);
    await page.screenshot({
        path: testInfo.outputPath('account-discord-connected.png'),
        fullPage: true,
    });
    await page.getByRole('button', { name: 'Disconnect Discord' }).click();
    await expect(page.getByText('Discord not connected.')).toBeVisible();
    await expect(page.getByText('123456789012345678')).toHaveCount(0);
    await expect(disconnectCsrf).toEqual(['account-csrf-token']);
    await expect(page.getByText('/account connect')).toBeVisible();
    await page.screenshot({
        path: testInfo.outputPath('account-discord-disconnected.png'),
        fullPage: true,
    });
});

test('legacy Discord links remain connected without showing an ID', async ({
    page,
}) => {
    await mockSignedIn(page, true, null);
    await page.goto('/account');

    await expect(page.getByText('Discord connected.')).toBeVisible();
    await expect(page.getByText('123456789012345678')).toHaveCount(0);
    await expect(page.getByText(/^@/)).toHaveCount(0);
});

test('account holders can save memories, claim reports, and download their data', async ({
    page,
}) => {
    await mockSignedIn(page);
    let failedMemoryEdits = 1;
    let exportRequested = false;
    let claimRequest = '';
    let logoutCsrf = '';
    let memoryPatch = '';
    let memoryPatchCsrf = '';
    await page.route('**/api/account/incidents/claim', async (route) => {
        claimRequest = route.request().postData() ?? '';
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ success: true }),
        });
    });
    await page.route('**/api/account/export', async (route) => {
        exportRequested = true;
        await route.fulfill({
            contentType: 'application/json',
            headers: {
                'content-disposition':
                    'attachment; filename="footnote-account-export.json"',
            },
            body: JSON.stringify({ format: 'footnote-account-export' }),
        });
    });
    await page.route('**/api/account/memories/*', async (route) => {
        if (route.request().method() === 'PATCH') {
            if (failedMemoryEdits > 0) {
                failedMemoryEdits -= 1;
                await route.fulfill({ status: 500 });
                return;
            }
            memoryPatch = route.request().postData() ?? '';
            memoryPatchCsrf = route.request().headers()['x-auth-csrf'] ?? '';
            const body: unknown = JSON.parse(memoryPatch);
            const text =
                typeof body === 'object' &&
                body !== null &&
                'text' in body &&
                typeof body.text === 'string'
                    ? body.text
                    : '';
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({
                    memory: {
                        id: '00000000-0000-4000-8000-000000000002',
                        text,
                        createdAt: '2026-09-20T11:00:00.000Z',
                    },
                }),
            });
            return;
        }
        await route.fulfill({
            status: 200,
            body: JSON.stringify({ success: true }),
        });
    });
    await page.route('**/api/auth/logout', async (route) => {
        logoutCsrf = route.request().headers()['x-auth-csrf'] ?? '';
        await route.fulfill({ status: 204 });
    });

    await page.goto('/account');
    await page.getByRole('button', { name: 'Add memory' }).click();
    const memoryDialog = page.getByRole('dialog', { name: 'Add a memory' });
    await expect(memoryDialog).toBeVisible();
    await memoryDialog.getByLabel('Memory').fill('Uses keyboard shortcuts.');
    await memoryDialog.getByRole('button', { name: 'Save memory' }).click();
    await expect(page.getByText('Uses keyboard shortcuts.')).toBeVisible();
    await page
        .getByRole('button', { name: 'Edit memory: Uses keyboard shortcuts.' })
        .click();
    const editDialog = page.getByRole('dialog', { name: 'Edit memory' });
    await expect(editDialog.getByLabel('Memory')).toHaveValue(
        'Uses keyboard shortcuts.'
    );
    await editDialog
        .getByLabel('Memory')
        .fill('Uses custom keyboard shortcuts.');
    await editDialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(editDialog.getByRole('alert')).toContainText(
        'The memory could not be updated. Please try again.'
    );
    await editDialog.getByRole('button', { name: 'Cancel' }).click();
    await page
        .getByRole('button', { name: 'Edit memory: Uses keyboard shortcuts.' })
        .click();
    await expect(
        page.getByRole('dialog', { name: 'Edit memory' }).getByRole('alert')
    ).toHaveCount(0);
    await page
        .getByRole('dialog', { name: 'Edit memory' })
        .getByLabel('Memory')
        .fill('Uses custom keyboard shortcuts.');
    await page
        .getByRole('dialog', { name: 'Edit memory' })
        .getByRole('button', { name: 'Save changes' })
        .click();
    await expect(
        page.getByText('Uses custom keyboard shortcuts.')
    ).toBeVisible();
    expect(memoryPatch).toBe(
        JSON.stringify({ text: 'Uses custom keyboard shortcuts.' })
    );
    expect(memoryPatchCsrf).toBe('account-csrf-token');
    await page
        .getByRole('button', {
            name: 'Forget memory: Prefers concise technical answers.',
        })
        .click();
    await expect(
        page.getByText('Prefers concise technical answers.')
    ).toHaveCount(0);
    await expect(
        page.getByText('Uses custom keyboard shortcuts.')
    ).toBeVisible();
    await expect(
        page.getByRole('heading', { name: 'Report ABC123' })
    ).toBeVisible();
    await expect(page.getByLabel('Claim code')).not.toBeVisible();
    const claimButton = page.getByRole('button', { name: 'Claim a report' });
    await claimButton.click();
    const claimDialog = page.getByRole('dialog', { name: 'Add a report' });
    await expect(claimDialog).toBeVisible();
    await claimDialog.getByLabel('Claim code').fill('a'.repeat(43));
    await claimDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(claimDialog).not.toBeVisible();
    await expect(claimButton).toBeFocused();
    await claimButton.click();
    await claimDialog.getByLabel('Claim code').fill('a'.repeat(43));
    await claimDialog.getByRole('button', { name: 'Add report' }).click();
    await expect(claimDialog).not.toBeVisible();
    await expect(
        page
            .getByRole('status')
            .filter({ hasText: 'Report added to your account.' })
    ).toBeVisible();
    expect(claimRequest).toBe(JSON.stringify({ claimCode: 'a'.repeat(43) }));

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download account data' }).click();
    expect((await download).suggestedFilename()).toBe(
        'footnote-account-export.json'
    );
    expect(exportRequested).toBe(true);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Account' })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Reports' })).toHaveCount(0);
    expect(logoutCsrf).toBe('account-csrf-token');
});

test('account holders can cancel or confirm account deletion', async ({
    page,
}) => {
    await mockSignedIn(page);
    let deleteCsrf = '';
    let deleteRequestCount = 0;
    let completeDelete: (() => void) | null = null;
    await page.route('**/api/auth/delete', async (route) => {
        deleteRequestCount += 1;
        deleteCsrf = route.request().headers()['x-auth-csrf'] ?? '';
        await new Promise<void>((resolve) => {
            completeDelete = resolve;
        });
        await route.fulfill({ status: 204 });
    });

    await page.goto('/account');
    await page.getByRole('button', { name: 'Delete account' }).click();
    await expect(page.getByRole('group')).toContainText(
        "This can't be undone."
    );
    await page
        .getByRole('group')
        .getByRole('button', { name: 'Cancel' })
        .click();
    expect(deleteRequestCount).toBe(0);
    await expect(
        page.getByRole('button', { name: 'Delete account' })
    ).toBeFocused();

    await page.getByRole('button', { name: 'Delete account' }).click();
    await page
        .getByRole('group')
        .getByRole('button', { name: 'Delete account' })
        .click();
    await expect(page.getByRole('group')).toContainText('Deleting…');
    await expect(
        page.getByRole('group').getByRole('button', { name: 'Cancel' })
    ).toBeDisabled();
    await expect.poll(() => deleteRequestCount).toBe(1);
    await expect.poll(() => completeDelete).not.toBeNull();
    if (!completeDelete) throw new Error('Delete request did not start');
    completeDelete();
    await expect(page.getByRole('status')).toContainText(
        'Your Footnote account was deleted.'
    );
    expect(deleteRequestCount).toBe(1);
    expect(deleteCsrf).toBe('account-csrf-token');
});
