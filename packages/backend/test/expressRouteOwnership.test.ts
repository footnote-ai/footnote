/**
 * @description: Verifies Express-owned route boundaries for standard, internal, and trace write/card HTTP surfaces.
 * Confirms special transport dispatch remains explicit for Accept-negotiated trace reads.
 * @footnote-scope: test
 * @footnote-module: ExpressRouteOwnershipTests
 * @footnote-risk: medium - Missing ownership tests can hide route-composition regressions at transport boundaries.
 * @footnote-ethics: low - Route ownership checks do not alter policy or user data semantics.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createExpressApp } from '../src/http/expressApp.js';

const TEST_HOST = '127.0.0.1';

const createTestServer = (
    app: ReturnType<typeof createExpressApp>
): Promise<{
    baseUrl: string;
    stop: () => Promise<void>;
}> =>
    new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.on('error', reject);
        server.listen(0, TEST_HOST, () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('Failed to resolve test server address.'));
                return;
            }
            resolve({
                baseUrl: `http://${TEST_HOST}:${address.port}`,
                stop: async () => {
                    await new Promise<void>((resolveClose, rejectClose) => {
                        server.close((error) => {
                            if (error) {
                                rejectClose(error);
                                return;
                            }
                            resolveClose();
                        });
                    });
                },
            });
        });
    });

const createUnhandledRouteHandler = async (
    _req: http.IncomingMessage,
    res: http.ServerResponse
): Promise<void> => {
    res.statusCode = 501;
    res.end('not-implemented');
};

const normalizePathname = (pathname: string): string =>
    pathname.length > 1 && pathname.endsWith('/')
        ? pathname.slice(0, -1)
        : pathname;

type CreateExpressAppDeps = Parameters<typeof createExpressApp>[0];

const baseAppDeps = (
    dispatchCalls: string[],
    overrides: Partial<CreateExpressAppDeps> = {}
): CreateExpressAppDeps => ({
    dispatchHttpRoute: async ({ normalizedPathname }) => {
        dispatchCalls.push(normalizedPathname);
        return 'fallthrough';
    },
    normalizePathname,
    trustProxy: false,
    handleIncidentListRequest: async (_req, res) => {
        res.statusCode = 200;
        res.end('incident-list');
    },
    handleIncidentReportRequest: async (_req, res) => {
        res.statusCode = 200;
        res.end('incident-report');
    },
    handleIncidentStatusRequest: async (_req, res) => {
        res.statusCode = 200;
        res.end('incident-status');
    },
    handleIncidentNotesRequest: async (_req, res) => {
        res.statusCode = 200;
        res.end('incident-notes');
    },
    handleIncidentRemediationRequest: async (_req, res) => {
        res.statusCode = 200;
        res.end('incident-remediation');
    },
    handleIncidentDetailRequest: async (_req, res) => {
        res.statusCode = 200;
        res.end('incident-detail');
    },
    handleChatRequest: createUnhandledRouteHandler,
    handleInternalTextRequest: createUnhandledRouteHandler,
    handleInternalImageRequest: createUnhandledRouteHandler,
    handleInternalVoiceTtsRequest: createUnhandledRouteHandler,
    handleTraceUpsertRequest: createUnhandledRouteHandler,
    handleTraceCardCreateRequest: createUnhandledRouteHandler,
    handleTraceCardFromTraceRequest: createUnhandledRouteHandler,
    handleTraceCardAssetRequest: async (req, res) =>
        createUnhandledRouteHandler(req, res),
    handleRuntimeConfigRequest: createUnhandledRouteHandler,
    handleChatProfilesRequest: createUnhandledRouteHandler,
    handlePreparedLandingConversationsRequest: createUnhandledRouteHandler,
    handleAdminSettingsSchemaRequest: createUnhandledRouteHandler,
    handleAdminSettingsTemplateRequest: createUnhandledRouteHandler,
    handleAdminSettingsYamlRequest: createUnhandledRouteHandler,
    handleAdminSettingsValidateRequest: createUnhandledRouteHandler,
    handleAdminSettingsYamlPutRequest: createUnhandledRouteHandler,
    handleSetupSessionPostRequest: createUnhandledRouteHandler,
    handleSetupSessionDeleteRequest: createUnhandledRouteHandler,
    handleSetupOperatorLinkPostRequest: createUnhandledRouteHandler,
    handleStaticTransportRequest: async ({ res }) => {
        res.statusCode = 404;
        res.end('static');
    },
    resolveAsset: async () => undefined,
    mimeMap: new Map<string, string>(),
    frameAncestors: [],
    logRequest: () => undefined,
    ...overrides,
});

test('chat route is Express-owned and bypasses central dispatch', async (t) => {
    const dispatchCalls: string[] = [];
    let chatCalls = 0;

    const app = createExpressApp(
        baseAppDeps(dispatchCalls, {
            handleChatRequest: async (_req, res) => {
                chatCalls += 1;
                res.statusCode = 200;
                res.end('chat');
            },
        })
    );

    const server = await createTestServer(app);
    t.after(async () => {
        await server.stop();
    });

    const chatResponse = await fetch(`${server.baseUrl}/api/chat`, {
        method: 'POST',
    });
    assert.equal(chatResponse.status, 200);
    assert.equal(await chatResponse.text(), 'chat');
    assert.equal(chatCalls, 1);
    assert.equal(dispatchCalls.includes('/api/chat'), false);

    const unrelatedApiResponse = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(unrelatedApiResponse.status, 404);
    assert.equal(dispatchCalls.includes('/api/health'), true);
});

test('internal HTTP routes are Express-owned and bypass central dispatch', async (t) => {
    const dispatchCalls: string[] = [];
    const internalCalls: string[] = [];

    const app = createExpressApp(
        baseAppDeps(dispatchCalls, {
            handleInternalTextRequest: async (_req, res) => {
                internalCalls.push('/api/internal/text');
                res.statusCode = 200;
                res.end('internal-text');
            },
            handleInternalImageRequest: async (_req, res) => {
                internalCalls.push('/api/internal/image');
                res.statusCode = 200;
                res.end('internal-image');
            },
            handleInternalVoiceTtsRequest: async (_req, res) => {
                internalCalls.push('/api/internal/voice/tts');
                res.statusCode = 200;
                res.end('internal-voice-tts');
            },
        })
    );

    const server = await createTestServer(app);
    t.after(async () => {
        await server.stop();
    });

    const textResponse = await fetch(`${server.baseUrl}/api/internal/text`, {
        method: 'POST',
    });
    assert.equal(textResponse.status, 200);
    assert.equal(await textResponse.text(), 'internal-text');

    const imageResponse = await fetch(`${server.baseUrl}/api/internal/image`, {
        method: 'POST',
    });
    assert.equal(imageResponse.status, 200);
    assert.equal(await imageResponse.text(), 'internal-image');

    const ttsResponse = await fetch(
        `${server.baseUrl}/api/internal/voice/tts`,
        {
            method: 'POST',
        }
    );
    assert.equal(ttsResponse.status, 200);
    assert.equal(await ttsResponse.text(), 'internal-voice-tts');

    assert.deepEqual(internalCalls, [
        '/api/internal/text',
        '/api/internal/image',
        '/api/internal/voice/tts',
    ]);
    assert.equal(dispatchCalls.includes('/api/internal/text'), false);
    assert.equal(dispatchCalls.includes('/api/internal/image'), false);
    assert.equal(dispatchCalls.includes('/api/internal/voice/tts'), false);

    const unrelatedApiResponse = await fetch(
        `${server.baseUrl}/api/internal/voice/realtime`
    );
    assert.equal(unrelatedApiResponse.status, 404);
    assert.equal(dispatchCalls.includes('/api/internal/voice/realtime'), true);
});

test('admin settings routes are Express-owned and bypass central dispatch', async (t) => {
    const dispatchCalls: string[] = [];
    const adminCalls: string[] = [];

    const app = createExpressApp(
        baseAppDeps(dispatchCalls, {
            handleAdminSettingsSchemaRequest: async (_req, res) => {
                adminCalls.push('/api/admin/settings/schema');
                res.statusCode = 200;
                res.end('admin-schema');
            },
            handleAdminSettingsTemplateRequest: async (_req, res) => {
                adminCalls.push('/api/admin/settings/template');
                res.statusCode = 200;
                res.end('admin-template');
            },
            handleAdminSettingsYamlRequest: async (_req, res) => {
                adminCalls.push('/api/admin/settings.yaml:get');
                res.statusCode = 200;
                res.end('admin-yaml-get');
            },
            handleAdminSettingsValidateRequest: async (_req, res) => {
                adminCalls.push('/api/admin/settings/validate');
                res.statusCode = 200;
                res.end('admin-validate');
            },
            handleAdminSettingsYamlPutRequest: async (_req, res) => {
                adminCalls.push('/api/admin/settings.yaml:put');
                res.statusCode = 200;
                res.end('admin-yaml-put');
            },
        })
    );

    const server = await createTestServer(app);
    t.after(async () => {
        await server.stop();
    });

    const schemaResponse = await fetch(
        `${server.baseUrl}/api/admin/settings/schema`
    );
    assert.equal(schemaResponse.status, 200);
    assert.equal(await schemaResponse.text(), 'admin-schema');

    const templateResponse = await fetch(
        `${server.baseUrl}/api/admin/settings/template`
    );
    assert.equal(templateResponse.status, 200);
    assert.equal(await templateResponse.text(), 'admin-template');

    const yamlGetResponse = await fetch(
        `${server.baseUrl}/api/admin/settings.yaml`
    );
    assert.equal(yamlGetResponse.status, 200);
    assert.equal(await yamlGetResponse.text(), 'admin-yaml-get');

    const validateResponse = await fetch(
        `${server.baseUrl}/api/admin/settings/validate`,
        {
            method: 'POST',
        }
    );
    assert.equal(validateResponse.status, 200);
    assert.equal(await validateResponse.text(), 'admin-validate');

    const yamlPutResponse = await fetch(
        `${server.baseUrl}/api/admin/settings.yaml`,
        {
            method: 'PUT',
        }
    );
    assert.equal(yamlPutResponse.status, 200);
    assert.equal(await yamlPutResponse.text(), 'admin-yaml-put');

    assert.deepEqual(adminCalls, [
        '/api/admin/settings/schema',
        '/api/admin/settings/template',
        '/api/admin/settings.yaml:get',
        '/api/admin/settings/validate',
        '/api/admin/settings.yaml:put',
    ]);
    assert.equal(dispatchCalls.includes('/api/admin/settings/schema'), false);
    assert.equal(dispatchCalls.includes('/api/admin/settings/template'), false);
    assert.equal(dispatchCalls.includes('/api/admin/settings.yaml'), false);
    assert.equal(dispatchCalls.includes('/api/admin/settings/validate'), false);
});

test('admin settings schema/validate enforce method ownership and template path enforces in handler', async (t) => {
    const dispatchCalls: string[] = [];
    const adminCalls: string[] = [];

    const app = createExpressApp(
        baseAppDeps(dispatchCalls, {
            handleAdminSettingsSchemaRequest: async (_req, res) => {
                adminCalls.push('/api/admin/settings/schema');
                res.statusCode = 200;
                res.end('admin-schema');
            },
            handleAdminSettingsTemplateRequest: async (_req, res) => {
                adminCalls.push('/api/admin/settings/template');
                res.statusCode = 405;
                res.end('method-not-allowed');
            },
            handleAdminSettingsValidateRequest: async (_req, res) => {
                adminCalls.push('/api/admin/settings/validate');
                res.statusCode = 200;
                res.end('admin-validate');
            },
        })
    );

    const server = await createTestServer(app);
    t.after(async () => {
        await server.stop();
    });

    const schemaPost = await fetch(
        `${server.baseUrl}/api/admin/settings/schema`,
        {
            method: 'POST',
        }
    );
    assert.equal(schemaPost.status, 404);

    const validateGet = await fetch(
        `${server.baseUrl}/api/admin/settings/validate`,
        {
            method: 'GET',
        }
    );
    assert.equal(validateGet.status, 404);

    const templatePost = await fetch(
        `${server.baseUrl}/api/admin/settings/template`,
        {
            method: 'POST',
        }
    );
    assert.equal(templatePost.status, 405);

    assert.equal(adminCalls.includes('/api/admin/settings/schema'), false);
    assert.equal(adminCalls.includes('/api/admin/settings/template'), true);
    assert.equal(adminCalls.includes('/api/admin/settings/validate'), false);
    assert.equal(dispatchCalls.includes('/api/admin/settings/schema'), true);
    assert.equal(dispatchCalls.includes('/api/admin/settings/template'), false);
    assert.equal(dispatchCalls.includes('/api/admin/settings/validate'), true);
});

test('setup session routes are Express-owned and bypass central dispatch', async (t) => {
    const dispatchCalls: string[] = [];
    const setupCalls: string[] = [];

    const app = createExpressApp(
        baseAppDeps(dispatchCalls, {
            handleSetupSessionPostRequest: async (_req, res) => {
                setupCalls.push('/api/setup/session:post');
                res.statusCode = 200;
                res.end('setup-post');
            },
            handleSetupSessionDeleteRequest: async (_req, res) => {
                setupCalls.push('/api/setup/session:delete');
                res.statusCode = 204;
                res.end();
            },
            handleSetupOperatorLinkPostRequest: async (_req, res) => {
                setupCalls.push('/api/setup/operator-link:post');
                res.statusCode = 200;
                res.end('operator-link');
            },
        })
    );

    const server = await createTestServer(app);
    t.after(async () => {
        await server.stop();
    });

    const postResponse = await fetch(`${server.baseUrl}/api/setup/session`, {
        method: 'POST',
    });
    assert.equal(postResponse.status, 200);
    assert.equal(await postResponse.text(), 'setup-post');

    const deleteResponse = await fetch(`${server.baseUrl}/api/setup/session`, {
        method: 'DELETE',
    });
    assert.equal(deleteResponse.status, 204);

    const getResponse = await fetch(`${server.baseUrl}/api/setup/session`);
    assert.equal(getResponse.status, 404);

    const operatorLinkResponse = await fetch(
        `${server.baseUrl}/api/setup/operator-link`,
        {
            method: 'POST',
        }
    );
    assert.equal(operatorLinkResponse.status, 200);
    assert.equal(await operatorLinkResponse.text(), 'operator-link');

    assert.deepEqual(setupCalls, [
        '/api/setup/session:post',
        '/api/setup/session:delete',
        '/api/setup/operator-link:post',
    ]);
    assert.equal(dispatchCalls.includes('/api/setup/session'), true);
    assert.equal(dispatchCalls.includes('/api/setup/operator-link'), false);
});

test('trace write/card route is Express-owned while Accept-negotiated trace read stays in special transport dispatch', async (t) => {
    const dispatchCalls: string[] = [];
    const traceCalls: string[] = [];

    const app = createExpressApp(
        baseAppDeps(dispatchCalls, {
            dispatchHttpRoute: async ({ normalizedPathname, res }) => {
                dispatchCalls.push(normalizedPathname);
                if (normalizedPathname.startsWith('/api/traces/')) {
                    res.statusCode = 208;
                    res.end('trace-special-dispatch');
                    return 'handled';
                }
                return 'fallthrough';
            },
            handleTraceUpsertRequest: async (_req, res) => {
                traceCalls.push('/api/traces');
                res.statusCode = 200;
                res.end('trace-upsert');
            },
            handleTraceCardCreateRequest: async (_req, res) => {
                traceCalls.push('/api/trace-cards');
                res.statusCode = 200;
                res.end('trace-card-create');
            },
            handleTraceCardFromTraceRequest: async (_req, res) => {
                traceCalls.push('/api/trace-cards/from-trace');
                res.statusCode = 200;
                res.end('trace-card-from-trace');
            },
            handleTraceCardAssetRequest: async (_req, res) => {
                traceCalls.push('/api/traces/:id/assets/trace-card.svg');
                res.statusCode = 200;
                res.end('trace-card-asset');
            },
        })
    );

    const server = await createTestServer(app);
    t.after(async () => {
        await server.stop();
    });

    const tracesResponse = await fetch(`${server.baseUrl}/api/traces`, {
        method: 'POST',
    });
    assert.equal(tracesResponse.status, 200);
    assert.equal(await tracesResponse.text(), 'trace-upsert');

    const traceCardResponse = await fetch(`${server.baseUrl}/api/trace-cards`, {
        method: 'POST',
    });
    assert.equal(traceCardResponse.status, 200);
    assert.equal(await traceCardResponse.text(), 'trace-card-create');

    const fromTraceResponse = await fetch(
        `${server.baseUrl}/api/trace-cards/from-trace`,
        {
            method: 'POST',
        }
    );
    assert.equal(fromTraceResponse.status, 200);
    assert.equal(await fromTraceResponse.text(), 'trace-card-from-trace');

    const traceAssetResponse = await fetch(
        `${server.baseUrl}/api/traces/trace_123/assets/trace-card.svg`
    );
    assert.equal(traceAssetResponse.status, 200);
    assert.equal(await traceAssetResponse.text(), 'trace-card-asset');

    const traceDetailResponse = await fetch(
        `${server.baseUrl}/api/traces/trace_123`,
        {
            headers: {
                Accept: 'application/json',
            },
        }
    );
    assert.equal(traceDetailResponse.status, 208);
    assert.equal(await traceDetailResponse.text(), 'trace-special-dispatch');

    assert.deepEqual(traceCalls, [
        '/api/traces',
        '/api/trace-cards',
        '/api/trace-cards/from-trace',
        '/api/traces/:id/assets/trace-card.svg',
    ]);
    assert.equal(dispatchCalls.includes('/api/traces'), false);
    assert.equal(dispatchCalls.includes('/api/trace-cards'), false);
    assert.equal(dispatchCalls.includes('/api/trace-cards/from-trace'), false);
    assert.equal(
        dispatchCalls.includes('/api/traces/trace_123/assets/trace-card.svg'),
        false
    );
    assert.equal(dispatchCalls.includes('/api/traces/trace_123'), true);
});
