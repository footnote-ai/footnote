/**
 * @description: Locks down baseline backend transport contracts at the real server boundary.
 * Covers CORS, route negotiation, static/SPA/CSP behavior, NDJSON streaming, and upgrade dispatch.
 * @footnote-scope: test
 * @footnote-module: ServerContractTests
 * @footnote-risk: high - Missing server-level contracts can let route and transport behavior drift during refactors.
 * @footnote-ethics: medium - Stable transport behavior supports transparency and reliable safety controls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import { startBackendServerContractHarness } from './serverContractHarness.js';

const createChatRequestPayload = (): Record<string, unknown> => ({
    surface: 'discord',
    trigger: { kind: 'direct' },
    latestUserInput: 'hello from contract test',
    conversation: [
        {
            role: 'user',
            content: 'hello from contract test',
        },
    ],
    capabilities: {
        canReact: true,
        canGenerateImages: true,
        canUseTts: true,
    },
});

const createInternalImageStreamPayload = (): Record<string, unknown> => ({
    task: 'generate',
    prompt: 'draw one geometric icon',
    textModel: 'gpt-5-mini',
    imageModel: 'gpt-image-1-mini',
    size: '1024x1024',
    quality: 'low',
    background: 'auto',
    style: 'vivid',
    allowPromptAdjustment: true,
    outputFormat: 'png',
    outputCompression: 100,
    stream: true,
    user: {
        username: 'contract-test',
        nickname: 'contract-test',
        guildName: 'contract-test',
    },
});

const canBindPort = async (port: number): Promise<boolean> =>
    await new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.listen(port, '::', () => {
            server.close(() => resolve(true));
        });
    });

const waitForSetupEventFromHarnessOutput = async (
    readOutput: () => string,
    timeoutMs: number = 5_000
): Promise<string> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const output = readOutput();
        const match = output.match(/\[SETUP_EVENT\]\s+(\{[^\n]+\})/);
        if (match?.[1]) {
            return match[1];
        }
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 100);
        });
    }
    throw new Error('Timed out waiting for setup bootstrap event in logs.');
};

const readUpgradeResponse = async ({
    host,
    port,
    pathname,
    headers = {},
}: {
    host: string;
    port: number;
    pathname: string;
    headers?: Record<string, string>;
}): Promise<string> =>
    await new Promise((resolve, reject) => {
        const socket = net.connect({ host, port });
        const chunks: string[] = [];
        let accumulated = '';
        let settled = false;

        const cleanup = () => {
            socket.removeAllListeners();
            socket.on('error', () => undefined);
            if (!socket.destroyed) {
                socket.destroy();
            }
        };

        const finish = (value: string) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve(value);
        };

        const fail = (error: Error) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            reject(error);
        };

        socket.on('connect', () => {
            const mergedHeaders: Record<string, string> = {
                Host: `${host}:${port}`,
                Connection: 'Upgrade',
                Upgrade: 'websocket',
                'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
                'Sec-WebSocket-Version': '13',
                ...headers,
            };
            const headerLines = Object.entries(mergedHeaders)
                .map(([key, value]) => `${key}: ${value}`)
                .join('\r\n');
            const request = `GET ${pathname} HTTP/1.1\r\n${headerLines}\r\n\r\n`;
            socket.write(request);
        });

        socket.on('data', (chunk: Buffer) => {
            const text = chunk.toString('utf8');
            chunks.push(text);
            accumulated += text;

            if (accumulated.includes('\r\n\r\n')) {
                finish(chunks.join(''));
            }
        });

        socket.on('end', () => {
            finish(chunks.join(''));
        });

        socket.on('close', () => {
            finish(chunks.join(''));
        });

        socket.on('error', fail);

        setTimeout(() => {
            finish(chunks.join(''));
        }, 750).unref();
    });

test('backend server contract baseline routes and transport behavior stay stable', async (t) => {
    const harness = await startBackendServerContractHarness();
    t.after(async () => {
        await harness.stop();
    });

    await t.test(
        '/api/chat OPTIONS responds as CORS preflight contract',
        async () => {
            const response = await fetch(`${harness.baseUrl}/api/chat`, {
                method: 'OPTIONS',
                headers: {
                    Origin: 'https://allowed.example',
                    'Access-Control-Request-Method': 'POST',
                    'Access-Control-Request-Headers': 'Content-Type',
                },
            });

            assert.equal(response.status, 204);
            assert.equal(
                response.headers.get('access-control-allow-origin'),
                'https://allowed.example'
            );
            assert.equal(
                response.headers.get('access-control-allow-methods'),
                'POST, OPTIONS'
            );
            assert.match(response.headers.get('vary') ?? '', /origin/i);
        }
    );

    await t.test(
        '/api/chat returns provider-unavailable 503 when no runtime provider is configured',
        async () => {
            const response = await fetch(`${harness.baseUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Trace-Token': 'trace-token',
                },
                body: JSON.stringify(createChatRequestPayload()),
            });

            assert.equal(response.status, 503);
            assert.match(
                response.headers.get('content-type') ?? '',
                /application\/json/i
            );

            const payload = (await response.json()) as {
                error?: string;
                details?: string;
            };
            assert.equal(payload.error, 'Generation provider unavailable');
            assert.equal(payload.details, 'provider_unavailable');
        }
    );

    await t.test(
        '/api/traces/{id} negotiates Accept and sets Vary: Accept',
        async () => {
            const traceId = 'server-contract-missing-trace-id';
            const jsonResponse = await fetch(
                `${harness.baseUrl}/api/traces/${encodeURIComponent(traceId)}`,
                {
                    headers: {
                        Accept: 'application/json',
                    },
                }
            );

            assert.equal(jsonResponse.status, 404);
            assert.match(
                jsonResponse.headers.get('content-type') ?? '',
                /application\/json/i
            );
            assert.match(jsonResponse.headers.get('vary') ?? '', /accept/i);

            const htmlResponse = await fetch(
                `${harness.baseUrl}/api/traces/${encodeURIComponent(traceId)}`,
                {
                    headers: {
                        Accept: 'text/html',
                    },
                }
            );

            assert.equal(htmlResponse.status, 200);
            assert.match(
                htmlResponse.headers.get('content-type') ?? '',
                /text\/html/i
            );
            assert.match(htmlResponse.headers.get('vary') ?? '', /accept/i);
            assert.ok(
                (htmlResponse.headers.get('content-security-policy') ?? '')
                    .length > 0
            );
        }
    );

    await t.test(
        '/config.json keeps config transport contract stable',
        async () => {
            const response = await fetch(`${harness.baseUrl}/config.json`);
            assert.equal(response.status, 200);
            assert.match(
                response.headers.get('content-type') ?? '',
                /application\/json/i
            );
            assert.equal(response.headers.get('cache-control'), 'no-store');

            const payload = (await response.json()) as {
                turnstileSiteKey?: string;
                setup?: {
                    required?: boolean;
                    routePath?: string;
                };
            };
            assert.equal(typeof payload.turnstileSiteKey, 'string');
            assert.equal(typeof payload.setup?.required, 'boolean');
            assert.equal(payload.setup?.routePath, '/setup');
        }
    );

    await t.test(
        'static asset and SPA fallback behavior remain stable with CSP on HTML',
        async () => {
            const staticResponse = await fetch(
                `${harness.baseUrl}${harness.staticFixture.routePath}`
            );
            assert.equal(staticResponse.status, 200);
            assert.match(
                staticResponse.headers.get('content-type') ?? '',
                /application\/javascript/i
            );
            assert.equal(
                staticResponse.headers.get('content-security-policy'),
                null
            );
            assert.match(await staticResponse.text(), /SERVER_CONTRACT_ASSET/);

            const spaResponse = await fetch(
                `${harness.baseUrl}/contract/spa/fallback/route`
            );
            assert.equal(spaResponse.status, 200);
            assert.match(
                spaResponse.headers.get('content-type') ?? '',
                /text\/html/i
            );
            assert.ok(
                (spaResponse.headers.get('content-security-policy') ?? '')
                    .length > 0
            );
        }
    );

    await t.test(
        '/api/internal/voice/realtime upgrade route dispatch and rejection behavior remain stable',
        async () => {
            const matchedRouteResponse = await readUpgradeResponse({
                host: harness.host,
                port: harness.port,
                pathname: '/api/internal/voice/realtime',
                headers: {
                    'X-Trace-Token': 'trace-token',
                },
            });
            assert.match(matchedRouteResponse, /503 Service Unavailable/);
            assert.match(
                matchedRouteResponse,
                /Internal voice realtime provider unavailable/
            );

            const unmatchedRouteResponse = await readUpgradeResponse({
                host: harness.host,
                port: harness.port,
                pathname: '/api/internal/voice/realtime/extra',
                headers: {
                    'X-Trace-Token': 'trace-token',
                },
            });
            assert.doesNotMatch(
                unmatchedRouteResponse,
                /101 Switching Protocols/
            );
        }
    );
});

test('/api/internal/image stream path keeps NDJSON response contract', async (t) => {
    const harness = await startBackendServerContractHarness({
        envOverrides: {
            OPENAI_API_KEY: 'test-openai-key',
            OPENAI_REQUEST_TIMEOUT_MS: '50',
        },
    });
    t.after(async () => {
        await harness.stop();
    });

    const response = await fetch(`${harness.baseUrl}/api/internal/image`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Trace-Token': 'trace-token',
        },
        body: JSON.stringify(createInternalImageStreamPayload()),
    });

    assert.equal(response.status, 200);
    assert.equal(
        response.headers.get('content-type'),
        'application/x-ndjson; charset=utf-8'
    );
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-accel-buffering'), 'no');

    const lines = (await response.text())
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    assert.ok(lines.length > 0);

    const parsedEvents = lines.map(
        (line) => JSON.parse(line) as { type: string }
    );
    for (const event of parsedEvents) {
        assert.ok(
            event.type === 'partial_image' ||
                event.type === 'result' ||
                event.type === 'error'
        );
    }
    const terminalType = parsedEvents[parsedEvents.length - 1]?.type;
    assert.ok(terminalType === 'result' || terminalType === 'error');
});

test('backend stays available when static index output is missing', async (t) => {
    const harness = await startBackendServerContractHarness({
        staticFixtureMode: 'none',
    });
    t.after(async () => {
        await harness.stop();
    });

    const staticResponse = await fetch(
        `${harness.baseUrl}/missing-static-route`
    );
    assert.equal(staticResponse.status, 404);
    assert.equal(await staticResponse.text(), 'Not Found');

    const configResponse = await fetch(`${harness.baseUrl}/config.json`);
    assert.equal(configResponse.status, 200);
    assert.match(
        configResponse.headers.get('content-type') ?? '',
        /application\/json/i
    );
});

test('admin settings server contract: auth, YAML read/write ETag flow, and restart semantics stay stable', async (t) => {
    const harness = await startBackendServerContractHarness({
        envOverrides: {
            SETTINGS_ADMIN_TOKEN: 'contract-admin-token',
        },
    });
    t.after(async () => {
        await harness.stop();
    });

    await t.test(
        'admin routes require x-admin-token when enabled',
        async () => {
            const response = await fetch(
                `${harness.baseUrl}/api/admin/settings/schema`
            );
            assert.equal(response.status, 401);
        }
    );

    await t.test(
        'admin template read returns canonical text/yaml payload',
        async () => {
            const response = await fetch(
                `${harness.baseUrl}/api/admin/settings/template`,
                {
                    headers: {
                        'x-admin-token': 'contract-admin-token',
                    },
                }
            );
            assert.equal(response.status, 200);
            assert.equal(
                response.headers.get('content-type'),
                'text/yaml; charset=utf-8'
            );
            const template = await response.text();
            assert.match(template, /version:\s*1/);
            assert.match(template, /discord-bots:\s*\[\]/);
        }
    );

    await t.test(
        'admin template read rejects unauthenticated requests',
        async () => {
            const response = await fetch(
                `${harness.baseUrl}/api/admin/settings/template`
            );
            assert.equal(response.status, 401);
        }
    );

    await t.test(
        'admin YAML read returns content-type and etag headers',
        async () => {
            const response = await fetch(
                `${harness.baseUrl}/api/admin/settings.yaml`,
                {
                    headers: {
                        'x-admin-token': 'contract-admin-token',
                    },
                }
            );
            assert.equal(response.status, 200);
            assert.equal(
                response.headers.get('content-type'),
                'text/yaml; charset=utf-8'
            );
            const etag = response.headers.get('etag');
            assert.ok(etag && etag.length > 0);
        }
    );

    await t.test(
        'admin validate returns restartRequired=true and write returns applied=false with new etag',
        async () => {
            const validateResponse = await fetch(
                `${harness.baseUrl}/api/admin/settings/validate`,
                {
                    method: 'POST',
                    headers: {
                        'x-admin-token': 'contract-admin-token',
                        'content-type': 'text/yaml',
                    },
                    body: [
                        'version: 1',
                        'rate-limits:',
                        '  web-api-rate-limit-ip: 17',
                        '',
                    ].join('\n'),
                }
            );
            assert.equal(validateResponse.status, 200);
            const validatePayload = (await validateResponse.json()) as {
                restartRequired: boolean;
                valid: boolean;
            };
            assert.equal(validatePayload.valid, true);
            assert.equal(validatePayload.restartRequired, true);

            const readBefore = await fetch(
                `${harness.baseUrl}/api/admin/settings.yaml`,
                {
                    headers: {
                        'x-admin-token': 'contract-admin-token',
                    },
                }
            );
            const priorEtag = readBefore.headers.get('etag');
            assert.ok(priorEtag);

            const writeResponse = await fetch(
                `${harness.baseUrl}/api/admin/settings.yaml`,
                {
                    method: 'PUT',
                    headers: {
                        'x-admin-token': 'contract-admin-token',
                        'if-match': priorEtag!,
                        'content-type': 'text/yaml',
                    },
                    body: [
                        'version: 1',
                        'rate-limits:',
                        '  web-api-rate-limit-ip: 21',
                        '',
                    ].join('\n'),
                }
            );
            assert.equal(writeResponse.status, 200);
            const writePayload = (await writeResponse.json()) as {
                etag: string;
                restartRequired: boolean;
                applied: boolean;
            };
            assert.equal(writePayload.restartRequired, true);
            assert.equal(writePayload.applied, false);
            assert.notEqual(writePayload.etag, priorEtag);

            const readAfter = await fetch(
                `${harness.baseUrl}/api/admin/settings.yaml`,
                {
                    headers: {
                        'x-admin-token': 'contract-admin-token',
                    },
                }
            );
            assert.equal(readAfter.status, 200);
            assert.equal(readAfter.headers.get('etag'), writePayload.etag);
            const yamlBody = await readAfter.text();
            assert.match(yamlBody, /web-api-rate-limit-ip:\s*21/);
        }
    );
});

test('first-setup contract: /config.json setup-required + setup session auth + first-write sentinel flow', async (t) => {
    if (!(await canBindPort(3000))) {
        t.skip(
            'Skipped setup-required server contract because default port 3000 is busy in this environment.'
        );
        return;
    }
    const harness = await startBackendServerContractHarness({
        envOverrides: {
            SETTINGS_ADMIN_TOKEN: '',
        },
        createSettingsFile: false,
    });
    t.after(async () => {
        await harness.stop();
    });

    const configResponse = await fetch(`${harness.baseUrl}/config.json`);
    assert.equal(configResponse.status, 200);
    const configPayload = (await configResponse.json()) as {
        setup?: {
            required?: boolean;
            routePath?: string;
        };
    };
    assert.equal(configPayload.setup?.required, true);
    assert.equal(configPayload.setup?.routePath, '/setup');

    const unauthAdminResponse = await fetch(
        `${harness.baseUrl}/api/admin/settings/schema`
    );
    assert.equal(unauthAdminResponse.status, 401);

    const setupEventLogs = await fetch(`${harness.baseUrl}/api/setup/session`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
        },
        body: JSON.stringify({ code: 'fn_setup_invalid' }),
    });
    assert.equal(setupEventLogs.status, 401);

    const setupEventJson = await waitForSetupEventFromHarnessOutput(
        harness.readProcessOutput
    );
    const setupEvent = JSON.parse(setupEventJson) as {
        setupPath: string;
        setupUrl: string;
    };
    const codeFromPath = setupEvent.setupPath.split('#code=')[1] ?? '';
    const setupCode = decodeURIComponent(codeFromPath);
    assert.ok(setupCode.startsWith('fn_setup_'));
    assert.match(
        setupEvent.setupUrl,
        /^http:\/\/localhost:3000\/setup#code=fn_setup_/
    );

    const sessionResponse = await fetch(
        `${harness.baseUrl}/api/setup/session`,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({ code: setupCode }),
        }
    );
    assert.equal(sessionResponse.status, 200);
    const sessionPayload = (await sessionResponse.json()) as {
        ok: boolean;
        csrfToken: string;
        expiresAt: string;
    };
    assert.equal(sessionPayload.ok, true);
    assert.equal(typeof sessionPayload.csrfToken, 'string');
    assert.equal(typeof sessionPayload.expiresAt, 'string');
    const sessionCookie = sessionResponse.headers
        .get('set-cookie')
        ?.split(';')[0];
    assert.ok(sessionCookie);

    const schemaResponse = await fetch(
        `${harness.baseUrl}/api/admin/settings/schema`,
        {
            headers: {
                cookie: sessionCookie!,
            },
        }
    );
    assert.equal(schemaResponse.status, 200);

    const missingCsrfWrite = await fetch(
        `${harness.baseUrl}/api/admin/settings.yaml`,
        {
            method: 'PUT',
            headers: {
                cookie: sessionCookie!,
                'if-match': '"footnote-settings-missing"',
            },
            body: [
                'version: 1',
                'rate-limits:',
                '  web-api-rate-limit-ip: 13',
                '',
            ].join('\n'),
        }
    );
    assert.equal(missingCsrfWrite.status, 403);

    const firstWrite = await fetch(
        `${harness.baseUrl}/api/admin/settings.yaml`,
        {
            method: 'PUT',
            headers: {
                cookie: sessionCookie!,
                'x-setup-csrf': sessionPayload.csrfToken,
                'if-match': '"footnote-settings-missing"',
            },
            body: [
                'version: 1',
                'rate-limits:',
                '  web-api-rate-limit-ip: 13',
                '',
            ].join('\n'),
        }
    );
    assert.equal(firstWrite.status, 200);
    const firstWritePayload = (await firstWrite.json()) as {
        restartRequired: boolean;
        applied: boolean;
    };
    assert.equal(firstWritePayload.restartRequired, true);
    assert.equal(firstWritePayload.applied, false);

    const configAfterWrite = await fetch(`${harness.baseUrl}/config.json`);
    assert.equal(configAfterWrite.status, 200);
    const configAfterWritePayload = (await configAfterWrite.json()) as {
        setup?: { required?: boolean };
    };
    assert.equal(configAfterWritePayload.setup?.required, false);
});

test('first-setup setup-event uses Fly hostname when FLY_APP_NAME is set', async (t) => {
    if (!(await canBindPort(3000))) {
        t.skip(
            'Skipped setup-event fly-url contract because default port 3000 is busy in this environment.'
        );
        return;
    }
    const harness = await startBackendServerContractHarness({
        envOverrides: {
            FLY_APP_NAME: 'footnote',
        },
        createSettingsFile: false,
    });
    t.after(async () => {
        await harness.stop();
    });

    const setupEventJson = await waitForSetupEventFromHarnessOutput(
        harness.readProcessOutput
    );
    const setupEvent = JSON.parse(setupEventJson) as {
        setupPath: string;
        setupUrl: string;
    };
    assert.match(
        setupEvent.setupUrl,
        /^https:\/\/footnote\.fly\.dev\/setup#code=fn_setup_/
    );
    assert.match(setupEvent.setupPath, /^\/setup#code=fn_setup_/);
});

test('first-write sentinel transitions to normal ETag checks once settings file exists', async (t) => {
    if (!(await canBindPort(3000))) {
        t.skip(
            'Skipped setup-required sentinel contract because default port 3000 is busy in this environment.'
        );
        return;
    }
    const harness = await startBackendServerContractHarness({
        envOverrides: {
            SETTINGS_ADMIN_TOKEN: 'contract-admin-token',
        },
        createSettingsFile: false,
    });
    t.after(async () => {
        await harness.stop();
    });

    const firstWrite = await fetch(
        `${harness.baseUrl}/api/admin/settings.yaml`,
        {
            method: 'PUT',
            headers: {
                'x-admin-token': 'contract-admin-token',
                'if-match': '"footnote-settings-missing"',
            },
            body: [
                'version: 1',
                'rate-limits:',
                '  web-api-rate-limit-ip: 14',
                '',
            ].join('\n'),
        }
    );
    assert.equal(firstWrite.status, 200);

    const sentinelAfterExists = await fetch(
        `${harness.baseUrl}/api/admin/settings.yaml`,
        {
            method: 'PUT',
            headers: {
                'x-admin-token': 'contract-admin-token',
                'if-match': '"footnote-settings-missing"',
            },
            body: [
                'version: 1',
                'rate-limits:',
                '  web-api-rate-limit-ip: 15',
                '',
            ].join('\n'),
        }
    );
    assert.equal(sentinelAfterExists.status, 412);

    const readAfter = await fetch(
        `${harness.baseUrl}/api/admin/settings.yaml`,
        {
            headers: {
                'x-admin-token': 'contract-admin-token',
            },
        }
    );
    assert.equal(readAfter.status, 200);
    const etag = readAfter.headers.get('etag');
    assert.ok(etag);

    const normalWrite = await fetch(
        `${harness.baseUrl}/api/admin/settings.yaml`,
        {
            method: 'PUT',
            headers: {
                'x-admin-token': 'contract-admin-token',
                'if-match': etag!,
            },
            body: [
                'version: 1',
                'rate-limits:',
                '  web-api-rate-limit-ip: 16',
                '',
            ].join('\n'),
        }
    );
    assert.equal(normalWrite.status, 200);
});
