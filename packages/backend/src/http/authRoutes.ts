/**
 * @description: Composes backend-owned account authentication routes under /api/auth.
 * @footnote-scope: interface
 * @footnote-module: AccountAuthRoutes
 * @footnote-risk: high - Route mismatches could bypass or break sign-in checks.
 * @footnote-ethics: high - Explicit route ownership keeps identity handling auditable.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import { createDispatchRouter, type LogRequest } from './dispatchRouter.js';

type RequestHandler = (
    req: IncomingMessage,
    res: ServerResponse
) => Promise<void>;

const accountConnectionDisabled: RequestHandler = async (_req, res) => {
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Account connection unavailable' }));
};

type RegisterAuthRoutesDeps = {
    app: express.Express;
    normalizePathname: (pathname: string) => string;
    handleAuthLoginRequest: RequestHandler;
    handleAuthCallbackRequest: RequestHandler;
    handleAuthSessionRequest: RequestHandler;
    handleAuthLogoutRequest: RequestHandler;
    handleDiscordBrowserExchange?: RequestHandler;
    handleDiscordBrowserStatus?: RequestHandler;
    handleDiscordBrowserConsent?: RequestHandler;
    handleDiscordBrowserCancel?: RequestHandler;
    logRequest: LogRequest;
};

/**
 * Registers only the four account-auth operation and method pairs. Unmatched
 * requests fall through to the remaining backend transport boundaries.
 */
export const registerAuthRoutes = ({
    app,
    normalizePathname,
    handleAuthLoginRequest,
    handleAuthCallbackRequest,
    handleAuthSessionRequest,
    handleAuthLogoutRequest,
    handleDiscordBrowserExchange = accountConnectionDisabled,
    handleDiscordBrowserStatus = accountConnectionDisabled,
    handleDiscordBrowserConsent = accountConnectionDisabled,
    handleDiscordBrowserCancel = accountConnectionDisabled,
    logRequest,
}: RegisterAuthRoutesDeps): void => {
    const discordBrowserRoutes = new Map<string, RequestHandler>([
        [
            'POST /api/auth/discord-connection/exchange',
            handleDiscordBrowserExchange,
        ],
        ['GET /api/auth/discord-connection', handleDiscordBrowserStatus],
        [
            'POST /api/auth/discord-connection/consent',
            handleDiscordBrowserConsent,
        ],
        [
            'POST /api/auth/discord-connection/cancel',
            handleDiscordBrowserCancel,
        ],
    ]);
    const authRouter = createDispatchRouter({
        normalizePathname,
        logRequest,
        matcher: async ({ req, res, next, normalizedPathname }) => {
            if (
                normalizedPathname === '/api/auth/login' &&
                req.method === 'GET'
            ) {
                await handleAuthLoginRequest(req, res);
                return;
            }
            if (
                normalizedPathname === '/api/auth/callback' &&
                req.method === 'GET'
            ) {
                await handleAuthCallbackRequest(req, res);
                return;
            }
            if (
                normalizedPathname === '/api/auth/session' &&
                req.method === 'GET'
            ) {
                await handleAuthSessionRequest(req, res);
                return;
            }
            if (
                normalizedPathname === '/api/auth/logout' &&
                req.method === 'POST'
            ) {
                await handleAuthLogoutRequest(req, res);
                return;
            }
            const discordBrowserHandler = discordBrowserRoutes.get(
                `${req.method} ${normalizedPathname}`
            );
            if (discordBrowserHandler) {
                await discordBrowserHandler(req, res);
                return;
            }
            next();
        },
    });

    app.use('/api/auth', authRouter);
};
