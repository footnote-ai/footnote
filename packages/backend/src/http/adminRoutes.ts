/**
 * @description: Composes trusted admin settings routes under /api/admin with explicit path and method ownership.
 * @footnote-scope: interface
 * @footnote-module: AdminRoutes
 * @footnote-risk: high - Route mismatches can expose privileged settings write paths or break trusted admin operations.
 * @footnote-ethics: high - Admin route boundaries control governance-sensitive runtime configuration updates.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import { createDispatchRouter, type LogRequest } from './dispatchRouter.js';

type RequestHandler = (
    req: IncomingMessage,
    res: ServerResponse
) => Promise<void>;

type RegisterAdminRoutesDeps = {
    app: express.Express;
    normalizePathname: (pathname: string) => string;
    handleAdminSettingsSchemaRequest: RequestHandler;
    handleAdminSettingsTemplateRequest: RequestHandler;
    handleAdminSettingsYamlRequest: RequestHandler;
    handleAdminSettingsValidateRequest: RequestHandler;
    handleAdminSettingsYamlPutRequest: RequestHandler;
    handleOperatorExecutionRequest?: RequestHandler;
    logRequest: LogRequest;
};

const registerAdminRoutes = ({
    app,
    normalizePathname,
    handleAdminSettingsSchemaRequest,
    handleAdminSettingsTemplateRequest,
    handleAdminSettingsYamlRequest,
    handleAdminSettingsValidateRequest,
    handleAdminSettingsYamlPutRequest,
    handleOperatorExecutionRequest,
    logRequest,
}: RegisterAdminRoutesDeps): void => {
    const adminRouter = createDispatchRouter({
        normalizePathname,
        logRequest,
        matcher: async ({ req, res, next, normalizedPathname }) => {
            if (
                /^\/api\/admin\/executions\/[^/]+\/?$/u.test(normalizedPathname)
            ) {
                if (req.method !== 'GET') {
                    res.statusCode = 405;
                    res.setHeader(
                        'Content-Type',
                        'application/json; charset=utf-8'
                    );
                    res.setHeader('Cache-Control', 'no-store');
                    res.end(JSON.stringify({ error: 'Method not allowed' }));
                } else if (handleOperatorExecutionRequest) {
                    await handleOperatorExecutionRequest(req, res);
                } else {
                    res.statusCode = 503;
                    res.setHeader(
                        'Content-Type',
                        'application/json; charset=utf-8'
                    );
                    res.setHeader('Cache-Control', 'no-store');
                    res.end(
                        JSON.stringify({
                            error: 'Execution records unavailable',
                        })
                    );
                }
                return;
            }

            if (
                req.method === 'GET' &&
                normalizedPathname === '/api/admin/settings/schema'
            ) {
                await handleAdminSettingsSchemaRequest(req, res);
                return;
            }

            if (normalizedPathname === '/api/admin/settings/template') {
                await handleAdminSettingsTemplateRequest(req, res);
                return;
            }

            if (
                req.method === 'POST' &&
                normalizedPathname === '/api/admin/settings/validate'
            ) {
                await handleAdminSettingsValidateRequest(req, res);
                return;
            }

            if (normalizedPathname === '/api/admin/settings.yaml') {
                if (req.method === 'GET') {
                    await handleAdminSettingsYamlRequest(req, res);
                    return;
                }
                if (req.method === 'PUT') {
                    await handleAdminSettingsYamlPutRequest(req, res);
                    return;
                }
            }

            next();
        },
    });

    app.use('/api/admin', adminRouter);
};

export { registerAdminRoutes };
