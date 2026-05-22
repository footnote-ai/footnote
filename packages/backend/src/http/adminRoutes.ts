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
    handleAdminSettingsYamlRequest: RequestHandler;
    handleAdminSettingsValidateRequest: RequestHandler;
    handleAdminSettingsYamlPutRequest: RequestHandler;
    logRequest: LogRequest;
};

const registerAdminRoutes = ({
    app,
    normalizePathname,
    handleAdminSettingsSchemaRequest,
    handleAdminSettingsYamlRequest,
    handleAdminSettingsValidateRequest,
    handleAdminSettingsYamlPutRequest,
    logRequest,
}: RegisterAdminRoutesDeps): void => {
    const adminRouter = createDispatchRouter({
        normalizePathname,
        logRequest,
        matcher: async ({ req, res, next, normalizedPathname }) => {
            if (
                req.method === 'GET' &&
                normalizedPathname === '/api/admin/settings/schema'
            ) {
                await handleAdminSettingsSchemaRequest(req, res);
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
