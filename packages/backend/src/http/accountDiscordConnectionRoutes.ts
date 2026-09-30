/**
 * @description: Registers the signed-in account's Discord status and disconnect routes.
 * @footnote-scope: interface
 * @footnote-module: AccountDiscordConnectionRoutes
 * @footnote-risk: medium - Route ownership controls access to durable identity links.
 * @footnote-ethics: high - Route checks preserve account ownership and user control.
 */
import express from 'express';
import { createDispatchRouter, type LogRequest } from './dispatchRouter.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

type RequestHandler = (
    req: IncomingMessage,
    res: ServerResponse
) => void | Promise<void>;

/** @api.operationId: getAccountDiscordConnection @api.path: GET /api/account/discord-connection */
/** @api.operationId: deleteAccountDiscordConnection @api.path: DELETE /api/account/discord-connection */
export const registerAccountDiscordConnectionRoutes = ({
    app,
    normalizePathname,
    handleAccountDiscordStatusRequest,
    handleAccountDiscordDisconnectRequest,
    logRequest,
}: {
    app: express.Express;
    normalizePathname: (pathname: string) => string;
    handleAccountDiscordStatusRequest: RequestHandler;
    handleAccountDiscordDisconnectRequest: RequestHandler;
    logRequest: LogRequest;
}): void => {
    const router = createDispatchRouter({
        normalizePathname,
        logRequest,
        matcher: async ({ req, res, next, normalizedPathname }) => {
            if (normalizedPathname !== '/api/account/discord-connection') {
                next();
                return;
            }
            if (req.method === 'GET') {
                await handleAccountDiscordStatusRequest(req, res);
            } else if (req.method === 'DELETE') {
                await handleAccountDiscordDisconnectRequest(req, res);
            } else {
                next();
            }
        },
    });
    app.use('/api/account', router);
};
