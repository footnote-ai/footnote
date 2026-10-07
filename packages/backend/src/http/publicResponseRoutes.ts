/**
 * @description: Registers the public-response API without changing trace-route negotiation.
 * @footnote-scope: interface
 * @footnote-module: PublicResponseRoutes
 * @footnote-risk: medium - Route ownership errors can expose or hide publication operations.
 * @footnote-ethics: high - This router is the transport edge for anonymous public artifacts.
 */
import express from 'express';
import {
    createDispatchRouter,
    type LogRequest,
    type ParsedUrlHandler,
} from './dispatchRouter.js';

type RegisterPublicResponseRoutesDependencies = {
    app: express.Express;
    normalizePathname: (pathname: string) => string;
    handlePublicResponsesRequest: ParsedUrlHandler;
    logRequest: LogRequest;
};

/** Registers only create/read/revoke operations for explicit public responses. */
const registerPublicResponseRoutes = ({
    app,
    normalizePathname,
    handlePublicResponsesRequest,
    logRequest,
}: RegisterPublicResponseRoutesDependencies): void => {
    const router = createDispatchRouter({
        normalizePathname,
        logRequest,
        matcher: async ({ req, res, next, parsedUrl, normalizedPathname }) => {
            if (
                normalizedPathname === '/api/public-responses' ||
                normalizedPathname.startsWith('/api/public-responses/')
            ) {
                await handlePublicResponsesRequest(req, res, parsedUrl);
                return;
            }
            next();
        },
    });
    app.use('/api/public-responses', router);
};

export { registerPublicResponseRoutes };
