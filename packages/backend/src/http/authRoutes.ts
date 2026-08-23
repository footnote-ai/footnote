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

type RegisterAuthRoutesDeps = {
    app: express.Express;
    normalizePathname: (pathname: string) => string;
    handleAuthLoginRequest: RequestHandler;
    handleAuthCallbackRequest: RequestHandler;
    handleAuthSessionRequest: RequestHandler;
    handleAuthLogoutRequest: RequestHandler;
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
    logRequest,
}: RegisterAuthRoutesDeps): void => {
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
            next();
        },
    });

    app.use('/api/auth', authRouter);
};
