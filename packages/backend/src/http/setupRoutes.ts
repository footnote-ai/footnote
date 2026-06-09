/**
 * @description: Composes first-setup bootstrap session routes under /api/setup with explicit method ownership.
 * @footnote-scope: interface
 * @footnote-module: SetupRoutes
 * @footnote-risk: medium - Route mismatches can break setup-session issuance or revocation during first-run onboarding.
 * @footnote-ethics: medium - Setup route boundaries shape first-run access control and operator onboarding clarity.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import { createDispatchRouter, type LogRequest } from './dispatchRouter.js';

type RequestHandler = (
    req: IncomingMessage,
    res: ServerResponse
) => Promise<void>;

type RegisterSetupRoutesDeps = {
    app: express.Express;
    normalizePathname: (pathname: string) => string;
    handleSetupSessionPostRequest: RequestHandler;
    handleSetupSessionDeleteRequest: RequestHandler;
    handleSetupOperatorLinkPostRequest: RequestHandler;
    logRequest: LogRequest;
};

/**
 * Registers exported setup-route API boundary ownership for `/api/setup`.
 *
 * Route/method contract:
 * - Mounted at `/api/setup` via `registerSetupRoutes`.
 * - Matcher handles `/api/setup/session` and `/api/setup/operator-link` only.
 * - `POST /api/setup/session` dispatches to `handleSetupSessionPostRequest`.
 * - `DELETE /api/setup/session` dispatches to `handleSetupSessionDeleteRequest`.
 * - `POST /api/setup/operator-link` dispatches to `handleSetupOperatorLinkPostRequest`.
 *
 * Fall-through contract:
 * - Matcher intentionally calls `next()` for non-matching paths/methods so other
 *   routers can continue handling the request.
 * - Callers must not assume this router fully short-circuits request handling.
 */
const registerSetupRoutes = ({
    app,
    normalizePathname,
    handleSetupSessionPostRequest,
    handleSetupSessionDeleteRequest,
    handleSetupOperatorLinkPostRequest,
    logRequest,
}: RegisterSetupRoutesDeps): void => {
    const setupRouter = createDispatchRouter({
        normalizePathname,
        logRequest,
        matcher: async ({ req, res, next, normalizedPathname }) => {
            if (normalizedPathname === '/api/setup/session') {
                if (req.method === 'POST') {
                    await handleSetupSessionPostRequest(req, res);
                    return;
                }
                if (req.method === 'DELETE') {
                    await handleSetupSessionDeleteRequest(req, res);
                    return;
                }
            }
            if (
                normalizedPathname === '/api/setup/operator-link' &&
                req.method === 'POST'
            ) {
                await handleSetupOperatorLinkPostRequest(req, res);
                return;
            }
            next();
        },
    });

    app.use('/api/setup', setupRouter);
};

export { registerSetupRoutes };
