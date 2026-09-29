/**
 * @description: Registers the signed-in account incident routes.
 * @footnote-scope: interface
 * @footnote-module: AccountIncidentRoutes
 * @footnote-risk: medium - Incorrect route matching can bypass account handlers.
 * @footnote-ethics: high - These routes expose private reporter status.
 */
import express from 'express';
import {
    createDispatchRouter,
    type LogRequest,
    type RequestHandler,
} from './dispatchRouter.js';

/** @api.operationId: getAccountIncidents @api.path: GET /api/account/incidents */
/** @api.operationId: postAccountIncidentClaim @api.path: POST /api/account/incidents/claim */
export const registerAccountIncidentRoutes = ({
    app,
    normalizePathname,
    handleAccountIncidentsRequest,
    handleAccountIncidentClaimRequest,
    logRequest,
}: {
    app: express.Express;
    normalizePathname: (pathname: string) => string;
    handleAccountIncidentsRequest: RequestHandler;
    handleAccountIncidentClaimRequest: RequestHandler;
    logRequest: LogRequest;
}): void => {
    const router = createDispatchRouter({
        normalizePathname,
        logRequest,
        matcher: async ({ req, res, next, normalizedPathname }) => {
            if (
                normalizedPathname === '/api/account/incidents' &&
                req.method === 'GET'
            ) {
                await handleAccountIncidentsRequest(req, res);
                return;
            }
            if (
                normalizedPathname === '/api/account/incidents/claim' &&
                req.method === 'POST'
            ) {
                await handleAccountIncidentClaimRequest(req, res);
                return;
            }
            next();
        },
    });
    app.use('/api/account', router);
};
