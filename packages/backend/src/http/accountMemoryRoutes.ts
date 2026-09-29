/**
 * @description: Registers the signed-in account memory routes.
 * @footnote-scope: interface
 * @footnote-module: AccountMemoryRoutes
 * @footnote-risk: medium - Incorrect route matching can bypass account handlers.
 * @footnote-ethics: high - These routes expose and alter private saved memories.
 */
import express from 'express';
import { createDispatchRouter, type LogRequest } from './dispatchRouter.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

type AccountMemoryRequestHandler = (
    req: IncomingMessage,
    res: ServerResponse
) => void | Promise<void>;

/** @api.operationId: getAccountMemories @api.path: GET /api/account/memories */
/** @api.operationId: postAccountMemory @api.path: POST /api/account/memories */
/** @api.operationId: deleteAccountMemory @api.path: DELETE /api/account/memories/{memoryId} */
export const registerAccountMemoryRoutes = ({
    app,
    normalizePathname,
    handleAccountMemoriesRequest,
    handleAccountMemoryCreateRequest,
    handleAccountMemoryDeleteRequest,
    logRequest,
}: {
    app: express.Express;
    normalizePathname: (pathname: string) => string;
    handleAccountMemoriesRequest: AccountMemoryRequestHandler;
    handleAccountMemoryCreateRequest: AccountMemoryRequestHandler;
    handleAccountMemoryDeleteRequest: AccountMemoryRequestHandler;
    logRequest: LogRequest;
}): void => {
    const router = createDispatchRouter({
        normalizePathname,
        logRequest,
        matcher: async ({ req, res, next, normalizedPathname }) => {
            if (normalizedPathname === '/api/account/memories') {
                if (req.method === 'GET')
                    await handleAccountMemoriesRequest(req, res);
                else if (req.method === 'POST')
                    await handleAccountMemoryCreateRequest(req, res);
                else next();
                return;
            }
            if (
                /^\/api\/account\/memories\/[^/]+$/.test(normalizedPathname) &&
                req.method === 'DELETE'
            ) {
                await handleAccountMemoryDeleteRequest(req, res);
                return;
            }
            next();
        },
    });
    app.use('/api/account', router);
};
