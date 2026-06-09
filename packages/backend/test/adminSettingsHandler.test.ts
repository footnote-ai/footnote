/**
 * @description: Verifies trusted admin settings handlers for auth gating, YAML read/validate/write semantics, and optimistic concurrency.
 * @footnote-scope: test
 * @footnote-module: AdminSettingsHandlerTests
 * @footnote-risk: high - Missing tests can allow privileged settings endpoint regressions across auth, validation, and write safety.
 * @footnote-ethics: high - Admin settings tests protect governance-sensitive runtime configuration behavior.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    computeSettingsEtag,
    createAdminSettingsHandlers,
    writeSettingsFileAtomically,
} from '../src/handlers/adminSettings.js';
import {
    createSetupSessionHandlers,
    isLoopbackAddress,
} from '../src/handlers/setupSession.js';
import { settingsSpecEntries } from '../src/config/settings-spec.js';
import {
    createSetupBootstrapService,
    SETUP_MISSING_IF_MATCH_ETAG,
} from '../src/services/setupBootstrap.js';

type TestServer = {
    url: string;
    settingsPath: string;
    issueSetupCode: () => Promise<{ code: string; expiresAt: string } | null>;
    close: () => Promise<void>;
    cleanup: () => void;
};

const createAdminSettingsTestServer = async (options?: {
    adminToken?: string | null;
    maxBodyBytes?: number;
    settingsYaml?: string;
    createSettingsFile?: boolean;
}): Promise<TestServer> => {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-admin-settings-handler-')
    );
    const settingsPath = path.join(tempDir, 'footnote.yaml');
    const settingsYaml =
        options?.settingsYaml ??
        ['version: 1', 'rate-limits:', '  web-api-rate-limit-ip: 5', ''].join(
            '\n'
        );
    const adminToken =
        options && Object.hasOwn(options, 'adminToken')
            ? (options.adminToken ?? null)
            : 'test-admin-token';
    const createSettingsFile = options?.createSettingsFile ?? true;
    if (createSettingsFile) {
        fs.writeFileSync(settingsPath, settingsYaml, 'utf8');
    }
    const setupBootstrapService = createSetupBootstrapService({
        settingsPath,
    });

    const handlers = createAdminSettingsHandlers({
        adminToken,
        maxBodyBytes: options?.maxBodyBytes ?? 20_000,
        settingsPath,
        settingsSpecEntries,
        setupBootstrapService,
        logger: {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        },
        logRequest: () => undefined,
    });
    const setupSessionHandlers = createSetupSessionHandlers({
        setupBootstrapService,
        settingsPath,
        setupBaseUrl: 'http://127.0.0.1',
        logger: {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        },
        logRequest: () => undefined,
    });

    const server = http.createServer((req, res) => {
        if ((req.url ?? '') === '/api/admin/settings/schema') {
            void handlers.handleAdminSettingsSchemaRequest(req, res);
            return;
        }
        if ((req.url ?? '') === '/api/admin/settings/template') {
            void handlers.handleAdminSettingsTemplateRequest(req, res);
            return;
        }
        if (
            (req.url ?? '') === '/api/admin/settings.yaml' &&
            req.method === 'GET'
        ) {
            void handlers.handleAdminSettingsYamlRequest(req, res);
            return;
        }
        if (
            (req.url ?? '') === '/api/admin/settings.yaml' &&
            req.method === 'PUT'
        ) {
            void handlers.handleAdminSettingsYamlPutRequest(req, res);
            return;
        }
        if ((req.url ?? '') === '/api/admin/settings/validate') {
            void handlers.handleAdminSettingsValidateRequest(req, res);
            return;
        }
        if ((req.url ?? '') === '/api/setup/session' && req.method === 'POST') {
            void setupSessionHandlers.handleSetupSessionPostRequest(req, res);
            return;
        }
        if (
            (req.url ?? '') === '/api/setup/session' &&
            req.method === 'DELETE'
        ) {
            void setupSessionHandlers.handleSetupSessionDeleteRequest(req, res);
            return;
        }
        if (
            (req.url ?? '') === '/api/setup/operator-link' &&
            req.method === 'POST'
        ) {
            void setupSessionHandlers.handleSetupOperatorLinkPostRequest(
                req,
                res
            );
            return;
        }

        res.statusCode = 404;
        res.end('Not Found');
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    return {
        url: `http://127.0.0.1:${address.port}`,
        settingsPath,
        issueSetupCode: () => setupBootstrapService.issueOrGetActiveCode(),
        close: () =>
            new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            }),
        cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
    };
};

test('admin settings schema returns 503 when admin token is not configured', async () => {
    const server = await createAdminSettingsTestServer({
        adminToken: null,
    });
    try {
        const response = await fetch(`${server.url}/api/admin/settings/schema`);
        assert.equal(response.status, 503);
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('admin settings endpoints require x-admin-token auth and reject invalid tokens', async () => {
    const server = await createAdminSettingsTestServer();
    try {
        const missingAuth = await fetch(
            `${server.url}/api/admin/settings/schema`
        );
        assert.equal(missingAuth.status, 401);

        const invalidAuth = await fetch(
            `${server.url}/api/admin/settings/schema`,
            {
                headers: {
                    'x-admin-token': 'wrong-token',
                },
            }
        );
        assert.equal(invalidAuth.status, 403);
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('admin settings schema returns editable settings metadata', async () => {
    const server = await createAdminSettingsTestServer();
    try {
        const response = await fetch(
            `${server.url}/api/admin/settings/schema`,
            {
                headers: {
                    'x-admin-token': 'test-admin-token',
                },
            }
        );
        assert.equal(response.status, 200);
        const payload = (await response.json()) as {
            ok: boolean;
            fields: Array<{ envKey: string; path: string[] }>;
        };
        assert.equal(payload.ok, true);
        assert.ok(payload.fields.length > 0);
        assert.ok(payload.fields.some((field) => field.envKey === 'HOST'));
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('admin settings template returns canonical commented YAML', async () => {
    const server = await createAdminSettingsTestServer();
    try {
        const response = await fetch(
            `${server.url}/api/admin/settings/template`,
            {
                headers: {
                    'x-admin-token': 'test-admin-token',
                },
            }
        );
        assert.equal(response.status, 200);
        assert.equal(
            response.headers.get('content-type'),
            'text/yaml; charset=utf-8'
        );
        const body = await response.text();
        assert.match(body, /version:\s*1/);
        assert.match(body, /discord-bots:\s*\[\]/);
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('admin settings YAML read returns canonical YAML body with ETag', async () => {
    const server = await createAdminSettingsTestServer();
    try {
        const response = await fetch(`${server.url}/api/admin/settings.yaml`, {
            headers: {
                'x-admin-token': 'test-admin-token',
            },
        });
        assert.equal(response.status, 200);
        assert.equal(
            response.headers.get('content-type'),
            'text/yaml; charset=utf-8'
        );
        const etag = response.headers.get('etag');
        assert.ok(etag && etag.length > 0);
        const body = await response.text();
        assert.match(body, /version:\s*1/);
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('admin settings YAML read returns 404 when settings file is missing', async () => {
    const server = await createAdminSettingsTestServer({
        createSettingsFile: false,
    });
    try {
        const response = await fetch(`${server.url}/api/admin/settings.yaml`, {
            headers: {
                'x-admin-token': 'test-admin-token',
            },
        });
        assert.equal(response.status, 404);
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('/api/setup/session returns 409 when setup is not required', async () => {
    const server = await createAdminSettingsTestServer({
        createSettingsFile: true,
        adminToken: null,
    });
    try {
        const response = await fetch(`${server.url}/api/setup/session`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({ code: 'fn_setup_invalid' }),
        });
        assert.equal(response.status, 409);
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('operator link local access guard accepts only loopback addresses', () => {
    assert.equal(isLoopbackAddress('127.0.0.1'), true);
    assert.equal(isLoopbackAddress('::1'), true);
    assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
    assert.equal(isLoopbackAddress('203.0.113.10'), false);
    assert.equal(isLoopbackAddress(undefined), false);
});

test('/api/setup/operator-link settings issues operator code for existing settings', async () => {
    const server = await createAdminSettingsTestServer({
        createSettingsFile: true,
        adminToken: null,
    });
    try {
        const operatorResponse = await fetch(
            `${server.url}/api/setup/operator-link`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ action: 'settings' }),
            }
        );
        assert.equal(operatorResponse.status, 200);
        const operatorPayload = (await operatorResponse.json()) as {
            ok: boolean;
            action: string;
            mode: string;
            setupPath: string;
            setupUrl: string;
            settingsState: string;
        };
        assert.equal(operatorPayload.ok, true);
        assert.equal(operatorPayload.action, 'settings');
        assert.equal(operatorPayload.mode, 'operator');
        assert.equal(operatorPayload.settingsState, 'present');
        assert.match(operatorPayload.setupPath, /^\/setup#code=fn_setup_/);
        assert.match(
            operatorPayload.setupUrl,
            /^http:\/\/127\.0\.0\.1\/setup#code=fn_setup_/
        );
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('/api/setup/operator-link settings issues first-run code when settings are missing', async () => {
    const server = await createAdminSettingsTestServer({
        createSettingsFile: false,
        adminToken: null,
    });
    try {
        const operatorResponse = await fetch(
            `${server.url}/api/setup/operator-link`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ action: 'settings' }),
            }
        );
        assert.equal(operatorResponse.status, 200);
        const operatorPayload = (await operatorResponse.json()) as {
            mode: string;
            settingsState: string;
        };
        assert.equal(operatorPayload.mode, 'first-run');
        assert.equal(operatorPayload.settingsState, 'missing');
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('/api/setup/operator-link reset backs up and removes existing settings before first-run code', async () => {
    const server = await createAdminSettingsTestServer({
        createSettingsFile: true,
        adminToken: null,
        settingsYaml: [
            'version: 1',
            'rate-limits:',
            '  web-api-rate-limit-ip: 77',
            '',
        ].join('\n'),
    });
    try {
        const operatorResponse = await fetch(
            `${server.url}/api/setup/operator-link`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ action: 'reset' }),
            }
        );
        assert.equal(operatorResponse.status, 200);
        const operatorPayload = (await operatorResponse.json()) as {
            mode: string;
            settingsState: string;
            backupPath?: string;
        };
        assert.equal(operatorPayload.mode, 'first-run');
        assert.equal(operatorPayload.settingsState, 'reset');
        assert.ok(operatorPayload.backupPath);
        assert.equal(fs.existsSync(server.settingsPath), false);
        assert.equal(fs.existsSync(operatorPayload.backupPath!), true);
        assert.match(
            fs.readFileSync(operatorPayload.backupPath!, 'utf8'),
            /web-api-rate-limit-ip:\s*77/
        );
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('operator setup session can read and write existing settings until expiry', async () => {
    const server = await createAdminSettingsTestServer({
        createSettingsFile: true,
        adminToken: null,
    });
    try {
        const operatorResponse = await fetch(
            `${server.url}/api/setup/operator-link`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ action: 'settings' }),
            }
        );
        assert.equal(operatorResponse.status, 200);
        const operatorPayload = (await operatorResponse.json()) as {
            setupPath: string;
        };
        const setupCode = new URLSearchParams(
            operatorPayload.setupPath.split('#')[1] ?? ''
        ).get('code');
        assert.ok(setupCode);

        const exchangeResponse = await fetch(
            `${server.url}/api/setup/session`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ code: setupCode }),
            }
        );
        assert.equal(exchangeResponse.status, 200);
        const exchangePayload = (await exchangeResponse.json()) as {
            csrfToken: string;
        };
        const setupCookie = exchangeResponse.headers
            .get('set-cookie')
            ?.split(';')[0];
        assert.ok(setupCookie);

        const readResponse = await fetch(
            `${server.url}/api/admin/settings.yaml`,
            {
                headers: {
                    cookie: setupCookie!,
                },
            }
        );
        assert.equal(readResponse.status, 200);
        const etag = readResponse.headers.get('etag');
        assert.ok(etag);

        const writeResponse = await fetch(
            `${server.url}/api/admin/settings.yaml`,
            {
                method: 'PUT',
                headers: {
                    cookie: setupCookie!,
                    'x-setup-csrf': exchangePayload.csrfToken,
                    'if-match': etag!,
                },
                body: [
                    'version: 1',
                    'rate-limits:',
                    '  web-api-rate-limit-ip: 88',
                    '',
                ].join('\n'),
            }
        );
        assert.equal(writeResponse.status, 200);

        const readAfterWriteResponse = await fetch(
            `${server.url}/api/admin/settings.yaml`,
            {
                headers: {
                    cookie: setupCookie!,
                },
            }
        );
        assert.equal(readAfterWriteResponse.status, 200);
        assert.match(
            await readAfterWriteResponse.text(),
            /web-api-rate-limit-ip:\s*88/
        );
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('/api/setup/session exchange validates payload/code and issues one-time setup session cookie', async () => {
    const server = await createAdminSettingsTestServer({
        createSettingsFile: false,
        adminToken: null,
    });
    try {
        const invalidPayloadResponse = await fetch(
            `${server.url}/api/setup/session`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ code: 123 }),
            }
        );
        assert.equal(invalidPayloadResponse.status, 400);

        const invalidCodeResponse = await fetch(
            `${server.url}/api/setup/session`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ code: 'fn_setup_invalid' }),
            }
        );
        assert.equal(invalidCodeResponse.status, 401);

        const issued = await server.issueSetupCode();
        assert.ok(issued);

        const exchangeResponse = await fetch(
            `${server.url}/api/setup/session`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ code: issued.code }),
            }
        );
        assert.equal(exchangeResponse.status, 200);
        const exchangePayload = (await exchangeResponse.json()) as {
            ok: boolean;
            expiresAt: string;
            csrfToken: string;
        };
        assert.equal(exchangePayload.ok, true);
        assert.equal(typeof exchangePayload.expiresAt, 'string');
        assert.equal(typeof exchangePayload.csrfToken, 'string');
        assert.ok((exchangePayload.csrfToken ?? '').length > 0);

        const setCookie = exchangeResponse.headers.get('set-cookie');
        assert.ok(setCookie);
        assert.match(setCookie!, /footnote_setup_session=/);
        assert.match(setCookie!, /Path=\//);
        assert.match(setCookie!, /HttpOnly/);
        assert.match(setCookie!, /SameSite=Strict/);

        const reuseResponse = await fetch(`${server.url}/api/setup/session`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({ code: issued.code }),
        });
        assert.equal(reuseResponse.status, 401);

        const deleteResponse = await fetch(`${server.url}/api/setup/session`, {
            method: 'DELETE',
            headers: {
                cookie: setCookie!.split(';')[0]!,
            },
        });
        assert.equal(deleteResponse.status, 204);
        const clearCookie = deleteResponse.headers.get('set-cookie');
        assert.ok(clearCookie);
        assert.match(clearCookie!, /footnote_setup_session=/);
        assert.match(clearCookie!, /Max-Age=0/);
        assert.match(clearCookie!, /Path=\//);
        assert.match(clearCookie!, /HttpOnly/);
        assert.match(clearCookie!, /SameSite=Strict/);
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('setup session auth path requires x-setup-csrf on non-GET admin calls and is disabled after first write', async () => {
    const server = await createAdminSettingsTestServer({
        createSettingsFile: false,
        adminToken: null,
    });
    try {
        const missingAuthResponse = await fetch(
            `${server.url}/api/admin/settings/schema`
        );
        assert.equal(missingAuthResponse.status, 401);

        const issued = await server.issueSetupCode();
        assert.ok(issued);
        const exchangeResponse = await fetch(
            `${server.url}/api/setup/session`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ code: issued.code }),
            }
        );
        assert.equal(exchangeResponse.status, 200);
        const exchangePayload = (await exchangeResponse.json()) as {
            csrfToken: string;
        };
        const setupCookie = exchangeResponse.headers
            .get('set-cookie')
            ?.split(';')[0];
        assert.ok(setupCookie);

        const schemaResponse = await fetch(
            `${server.url}/api/admin/settings/schema`,
            {
                headers: {
                    cookie: setupCookie!,
                },
            }
        );
        assert.equal(schemaResponse.status, 200);

        const missingCsrfResponse = await fetch(
            `${server.url}/api/admin/settings/validate`,
            {
                method: 'POST',
                headers: {
                    cookie: setupCookie!,
                    'content-type': 'text/yaml',
                },
                body: 'version: 1\n',
            }
        );
        assert.equal(missingCsrfResponse.status, 403);

        const validateResponse = await fetch(
            `${server.url}/api/admin/settings/validate`,
            {
                method: 'POST',
                headers: {
                    cookie: setupCookie!,
                    'x-setup-csrf': exchangePayload.csrfToken,
                    'content-type': 'text/yaml',
                },
                body: [
                    'version: 1',
                    'rate-limits:',
                    '  web-api-rate-limit-ip: 9',
                    '',
                ].join('\n'),
            }
        );
        assert.equal(validateResponse.status, 200);

        const firstWriteResponse = await fetch(
            `${server.url}/api/admin/settings.yaml`,
            {
                method: 'PUT',
                headers: {
                    cookie: setupCookie!,
                    'x-setup-csrf': exchangePayload.csrfToken,
                    'if-match': SETUP_MISSING_IF_MATCH_ETAG,
                },
                body: [
                    'version: 1',
                    'rate-limits:',
                    '  web-api-rate-limit-ip: 33',
                    '',
                ].join('\n'),
            }
        );
        assert.equal(firstWriteResponse.status, 200);

        const setupAfterWriteResponse = await fetch(
            `${server.url}/api/admin/settings/schema`,
            {
                headers: {
                    cookie: setupCookie!,
                },
            }
        );
        assert.equal(setupAfterWriteResponse.status, 503);
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('admin settings validate returns success payload for valid YAML', async () => {
    const server = await createAdminSettingsTestServer();
    try {
        const response = await fetch(
            `${server.url}/api/admin/settings/validate`,
            {
                method: 'POST',
                headers: {
                    'x-admin-token': 'test-admin-token',
                    'content-type': 'text/yaml',
                },
                body: [
                    'version: 1',
                    'rate-limits:',
                    '  web-api-rate-limit-ip: 9',
                    '',
                ].join('\n'),
            }
        );
        assert.equal(response.status, 200);
        const payload = (await response.json()) as {
            ok: boolean;
            valid: boolean;
            restartRequired: boolean;
            normalizedSummary: { version: number };
        };
        assert.equal(payload.ok, true);
        assert.equal(payload.valid, true);
        assert.equal(payload.restartRequired, true);
        assert.equal(payload.normalizedSummary.version, 1);
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('admin settings validate returns structured validation details for invalid YAML', async () => {
    const server = await createAdminSettingsTestServer();
    try {
        const response = await fetch(
            `${server.url}/api/admin/settings/validate`,
            {
                method: 'POST',
                headers: {
                    'x-admin-token': 'test-admin-token',
                    'content-type': 'text/yaml',
                },
                body: [
                    'version: 2',
                    'rate-limits:',
                    '  web-api-rate-limit-ip: 9',
                    '',
                ].join('\n'),
            }
        );
        assert.equal(response.status, 400);
        const payload = (await response.json()) as {
            validationErrors: Array<{
                message: string;
                pointer: string | null;
                category: string;
            }>;
        };
        assert.equal(Array.isArray(payload.validationErrors), true);
        assert.equal(payload.validationErrors.length, 1);
        assert.equal(payload.validationErrors[0]?.category, 'invalid_version');
        assert.equal(payload.validationErrors[0]?.pointer, 'version');
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('admin settings PUT requires If-Match and enforces ETag checks', async () => {
    const server = await createAdminSettingsTestServer();
    try {
        const missingIfMatch = await fetch(
            `${server.url}/api/admin/settings.yaml`,
            {
                method: 'PUT',
                headers: {
                    'x-admin-token': 'test-admin-token',
                },
                body: [
                    'version: 1',
                    'rate-limits:',
                    '  web-api-rate-limit-ip: 10',
                    '',
                ].join('\n'),
            }
        );
        assert.equal(missingIfMatch.status, 428);

        const staleIfMatch = await fetch(
            `${server.url}/api/admin/settings.yaml`,
            {
                method: 'PUT',
                headers: {
                    'x-admin-token': 'test-admin-token',
                    'if-match': '"stale-etag"',
                },
                body: [
                    'version: 1',
                    'rate-limits:',
                    '  web-api-rate-limit-ip: 10',
                    '',
                ].join('\n'),
            }
        );
        assert.equal(staleIfMatch.status, 412);
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('admin settings PUT first-write sentinel is accepted only while settings file is missing', async () => {
    const server = await createAdminSettingsTestServer({
        createSettingsFile: false,
    });
    try {
        const staleWithoutSentinel = await fetch(
            `${server.url}/api/admin/settings.yaml`,
            {
                method: 'PUT',
                headers: {
                    'x-admin-token': 'test-admin-token',
                    'if-match': '"stale-etag"',
                },
                body: [
                    'version: 1',
                    'rate-limits:',
                    '  web-api-rate-limit-ip: 10',
                    '',
                ].join('\n'),
            }
        );
        assert.equal(staleWithoutSentinel.status, 412);

        const firstWrite = await fetch(
            `${server.url}/api/admin/settings.yaml`,
            {
                method: 'PUT',
                headers: {
                    'x-admin-token': 'test-admin-token',
                    'if-match': SETUP_MISSING_IF_MATCH_ETAG,
                },
                body: [
                    'version: 1',
                    'rate-limits:',
                    '  web-api-rate-limit-ip: 11',
                    '',
                ].join('\n'),
            }
        );
        assert.equal(firstWrite.status, 200);

        const sentinelAfterFileExists = await fetch(
            `${server.url}/api/admin/settings.yaml`,
            {
                method: 'PUT',
                headers: {
                    'x-admin-token': 'test-admin-token',
                    'if-match': SETUP_MISSING_IF_MATCH_ETAG,
                },
                body: [
                    'version: 1',
                    'rate-limits:',
                    '  web-api-rate-limit-ip: 12',
                    '',
                ].join('\n'),
            }
        );
        assert.equal(sentinelAfterFileExists.status, 412);
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('admin settings PUT returns 413 when request body exceeds configured limit', async () => {
    const server = await createAdminSettingsTestServer({
        maxBodyBytes: 16,
    });
    try {
        const readResponse = await fetch(
            `${server.url}/api/admin/settings.yaml`,
            {
                headers: {
                    'x-admin-token': 'test-admin-token',
                },
            }
        );
        const etag = readResponse.headers.get('etag');
        assert.ok(etag);

        const response = await fetch(`${server.url}/api/admin/settings.yaml`, {
            method: 'PUT',
            headers: {
                'x-admin-token': 'test-admin-token',
                'if-match': etag!,
            },
            body: 'version: 1\nrate-limits:\n  web-api-rate-limit-ip: 12345\n',
        });
        assert.equal(response.status, 413);
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('admin settings PUT writes validated YAML and returns new ETag + restart semantics', async () => {
    const server = await createAdminSettingsTestServer();
    try {
        const readBefore = await fetch(
            `${server.url}/api/admin/settings.yaml`,
            {
                headers: {
                    'x-admin-token': 'test-admin-token',
                },
            }
        );
        const priorEtag = readBefore.headers.get('etag');
        assert.ok(priorEtag);

        const replacementYaml = [
            'version: 1',
            'rate-limits:',
            '  web-api-rate-limit-ip: 17',
            '',
        ].join('\n');
        const putResponse = await fetch(
            `${server.url}/api/admin/settings.yaml`,
            {
                method: 'PUT',
                headers: {
                    'x-admin-token': 'test-admin-token',
                    'if-match': priorEtag!,
                },
                body: replacementYaml,
            }
        );
        assert.equal(putResponse.status, 200);
        const putPayload = (await putResponse.json()) as {
            ok: boolean;
            etag: string;
            restartRequired: boolean;
            applied: boolean;
        };
        assert.equal(putPayload.ok, true);
        assert.equal(putPayload.restartRequired, true);
        assert.equal(putPayload.applied, false);
        assert.notEqual(putPayload.etag, priorEtag);

        const readAfter = await fetch(`${server.url}/api/admin/settings.yaml`, {
            headers: {
                'x-admin-token': 'test-admin-token',
            },
        });
        assert.equal(readAfter.status, 200);
        assert.equal(readAfter.headers.get('etag'), putPayload.etag);
        const updatedYaml = await readAfter.text();
        assert.match(updatedYaml, /web-api-rate-limit-ip:\s*17/);
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('admin settings PUT serializes concurrent writes with same If-Match so one fails 412', async () => {
    const server = await createAdminSettingsTestServer();
    try {
        const readBefore = await fetch(
            `${server.url}/api/admin/settings.yaml`,
            {
                headers: {
                    'x-admin-token': 'test-admin-token',
                },
            }
        );
        const priorEtag = readBefore.headers.get('etag');
        assert.ok(priorEtag);

        const bodyA = [
            'version: 1',
            'rate-limits:',
            '  web-api-rate-limit-ip: 31',
            '',
        ].join('\n');
        const bodyB = [
            'version: 1',
            'rate-limits:',
            '  web-api-rate-limit-ip: 32',
            '',
        ].join('\n');

        const [responseA, responseB] = await Promise.all([
            fetch(`${server.url}/api/admin/settings.yaml`, {
                method: 'PUT',
                headers: {
                    'x-admin-token': 'test-admin-token',
                    'if-match': priorEtag!,
                },
                body: bodyA,
            }),
            fetch(`${server.url}/api/admin/settings.yaml`, {
                method: 'PUT',
                headers: {
                    'x-admin-token': 'test-admin-token',
                    'if-match': priorEtag!,
                },
                body: bodyB,
            }),
        ]);

        const statuses = [responseA.status, responseB.status].sort(
            (a, b) => a - b
        );
        assert.deepEqual(statuses, [200, 412]);
    } finally {
        await server.close();
        server.cleanup();
    }
});

test('computeSettingsEtag is deterministic and content-sensitive', () => {
    const yamlA = 'version: 1\n';
    const yamlB = 'version: 1\nrate-limits:\n  web-api-rate-limit-ip: 2\n';

    const etagA1 = computeSettingsEtag(yamlA);
    const etagA2 = computeSettingsEtag(yamlA);
    const etagB = computeSettingsEtag(yamlB);

    assert.equal(etagA1, etagA2);
    assert.notEqual(etagA1, etagB);
});

test('writeSettingsFileAtomically replaces file contents', async () => {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-admin-settings-write-')
    );
    const settingsPath = path.join(tempDir, 'footnote.yaml');
    try {
        fs.writeFileSync(settingsPath, 'version: 1\n', 'utf8');
        await writeSettingsFileAtomically(
            settingsPath,
            'version: 1\nrate-limits:\n  web-api-rate-limit-ip: 99\n'
        );
        const written = fs.readFileSync(settingsPath, 'utf8');
        assert.match(written, /web-api-rate-limit-ip:\s*99/);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('writeSettingsFileAtomically preserves destination file permissions', async () => {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-admin-settings-write-mode-')
    );
    const settingsPath = path.join(tempDir, 'footnote.yaml');
    try {
        fs.writeFileSync(settingsPath, 'version: 1\n', {
            encoding: 'utf8',
            mode: 0o600,
        });
        fs.chmodSync(settingsPath, 0o600);
        const beforeMode = fs.statSync(settingsPath).mode & 0o777;

        await writeSettingsFileAtomically(
            settingsPath,
            'version: 1\nrate-limits:\n  web-api-rate-limit-ip: 100\n'
        );

        const afterMode = fs.statSync(settingsPath).mode & 0o777;
        assert.equal(afterMode, beforeMode);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('writeSettingsFileAtomically creates parent directory for first write', async () => {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-admin-settings-write-create-dir-')
    );
    const settingsPath = path.join(
        tempDir,
        'nested',
        'config',
        'footnote.yaml'
    );
    try {
        await writeSettingsFileAtomically(
            settingsPath,
            'version: 1\nrate-limits:\n  web-api-rate-limit-ip: 101\n'
        );
        const written = fs.readFileSync(settingsPath, 'utf8');
        assert.match(written, /web-api-rate-limit-ip:\s*101/);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
