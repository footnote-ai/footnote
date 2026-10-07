/**
 * @description: Publishes, reads, and revokes explicit allowlisted public response snapshots.
 * @footnote-scope: interface
 * @footnote-module: PublicResponseHandlers
 * @footnote-risk: high - This is an anonymous publication and revocation boundary.
 * @footnote-ethics: high - Incorrect projection or capability checks can expose user content without consent.
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
    CreatePublicResponseRequestSchema,
    RevokePublicResponseRequestSchema,
} from '@footnote/contracts/web/schemas';
import type { TraceStore } from '../storage/traces/traceStore.js';
import { logger } from '../utils/logger.js';
import { sendJson } from './chatResponses.js';
import {
    parseTrustedBodyWithSchema,
    type TrustedRouteLogRequest,
} from './trustedServiceRequest.js';
import { projectPublicResponse } from '../services/publicResponseProjection.js';

type HandlerDependencies = {
    traceStore: TraceStore | null;
    logRequest: TrustedRouteLogRequest;
    maxBodyBytes: number;
};

const PUBLIC_RESPONSE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PUBLIC_RESPONSE_PATH =
    /^\/api\/public-responses\/([A-Za-z0-9_-]{43})\/?$/u;
const UNAVAILABLE_MESSAGE = 'This published response is no longer available.';
const PRIVATE_HEADERS = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, noarchive',
} as const;

const sendPrivateJson = (
    res: ServerResponse,
    statusCode: number,
    payload: unknown
): void => sendJson(res, statusCode, payload, PRIVATE_HEADERS);

const isFreshResponse = (staleAfter: string, now: Date): boolean => {
    const staleAt = Date.parse(staleAfter);
    return Number.isFinite(staleAt) && staleAt > now.getTime();
};

/** Creates the HTTP boundary for a narrowly scoped public response artifact. */
export const createPublicResponsesHandler = ({
    traceStore,
    logRequest,
    maxBodyBytes,
}: HandlerDependencies) => {
    const requireStore = (
        req: IncomingMessage,
        res: ServerResponse
    ): TraceStore | null => {
        if (traceStore) return traceStore;
        sendPrivateJson(res, 503, { error: UNAVAILABLE_MESSAGE });
        logRequest(req, res, 'public response store-unavailable');
        return null;
    };

    /** @api.operationId: createPublicResponse @api.path: POST /api/public-responses */
    const createPublicResponse = async (
        req: IncomingMessage,
        res: ServerResponse,
        store: TraceStore
    ): Promise<void> => {
        const payload = await parseTrustedBodyWithSchema(req, res, {
            logRequest,
            routeLabel: 'public response create',
            maxBodyBytes,
            safeParse: (value) =>
                CreatePublicResponseRequestSchema.safeParse(value),
        });
        if (!payload) return;

        const now = new Date();
        const publishedAt = now.toISOString();
        const expiresAt = new Date(
            now.getTime() + PUBLIC_RESPONSE_TTL_MS
        ).toISOString();
        const currentTrace = await store.retrieveForDisplayWithRevision(
            payload.responseId
        );
        if (!currentTrace) {
            sendPrivateJson(res, 404, { error: UNAVAILABLE_MESSAGE });
            logRequest(req, res, 'public response create unavailable');
            return;
        }
        const metadata = currentTrace.metadata;
        if (!isFreshResponse(metadata.staleAfter, now)) {
            sendPrivateJson(res, 410, { error: UNAVAILABLE_MESSAGE });
            logRequest(req, res, 'public response create stale');
            return;
        }

        const publicId = randomBytes(32).toString('base64url');
        const projection = projectPublicResponse({
            answer: payload.answer,
            metadata,
            publishedAt,
            expiresAt,
        });
        const result = await store.publishPublicResponse({
            responseId: payload.responseId,
            answer: payload.answer,
            publicationToken: payload.publicationToken,
            expectedMetadataSha256: currentTrace.metadataSha256,
            publicId,
            projection,
            publishedAt,
            expiresAt,
        });
        if (result !== 'published') {
            const statusCode = result === 'expired' ? 410 : 404;
            sendPrivateJson(res, statusCode, { error: UNAVAILABLE_MESSAGE });
            logRequest(req, res, 'public response create unavailable');
            return;
        }

        sendPrivateJson(res, 201, { publicId, publishedAt, expiresAt });
        logRequest(req, res, 'public response created');
    };

    /** @api.operationId: getPublicResponse @api.path: GET /api/public-responses/{publicId} */
    const getPublicResponse = async (
        req: IncomingMessage,
        res: ServerResponse,
        publicId: string,
        store: TraceStore
    ): Promise<void> => {
        const result = await store.getPublicResponse(publicId);
        if (result.status !== 'published') {
            const statusCode = result.status === 'not_found' ? 404 : 410;
            sendPrivateJson(res, statusCode, { error: UNAVAILABLE_MESSAGE });
            logRequest(req, res, 'public response unavailable');
            return;
        }

        const metadata = await store.retrieveForDisplay(result.responseId);
        if (!metadata || !isFreshResponse(metadata.staleAfter, new Date())) {
            await store.invalidatePublicResponse(publicId);
            sendPrivateJson(res, 410, { error: UNAVAILABLE_MESSAGE });
            logRequest(req, res, 'public response invalidated');
            return;
        }

        sendPrivateJson(res, 200, result.projection);
        logRequest(req, res, 'public response success');
    };

    /** @api.operationId: revokePublicResponse @api.path: DELETE /api/public-responses/{publicId} */
    const revokePublicResponse = async (
        req: IncomingMessage,
        res: ServerResponse,
        publicId: string,
        store: TraceStore
    ): Promise<void> => {
        const payload = await parseTrustedBodyWithSchema(req, res, {
            logRequest,
            routeLabel: 'public response revoke',
            maxBodyBytes: 1024,
            safeParse: (value) =>
                RevokePublicResponseRequestSchema.safeParse(value),
        });
        if (!payload) return;

        const result = await store.revokePublicResponse(
            publicId,
            payload.publicationToken
        );
        if (result !== 'revoked') {
            const statusCode = result === 'expired' ? 410 : 404;
            sendPrivateJson(res, statusCode, { error: UNAVAILABLE_MESSAGE });
            logRequest(req, res, 'public response revoke unavailable');
            return;
        }
        sendPrivateJson(res, 200, { revoked: true });
        logRequest(req, res, 'public response revoked');
    };

    /** @api.operationId: createPublicResponse @api.path: POST /api/public-responses */
    const handlePublicResponsesRequest = async (
        req: IncomingMessage,
        res: ServerResponse,
        parsedUrl: URL
    ): Promise<void> => {
        for (const [header, value] of Object.entries(PRIVATE_HEADERS)) {
            res.setHeader(header, value);
        }
        try {
            const store = requireStore(req, res);
            if (!store) return;
            if (
                req.method === 'POST' &&
                parsedUrl.pathname === '/api/public-responses'
            ) {
                await createPublicResponse(req, res, store);
                return;
            }

            const pathMatch = parsedUrl.pathname.match(PUBLIC_RESPONSE_PATH);
            if (!pathMatch) {
                sendPrivateJson(res, 404, { error: UNAVAILABLE_MESSAGE });
                logRequest(req, res, 'public response route not-found');
                return;
            }
            const publicId = pathMatch[1];
            if (req.method === 'GET') {
                await getPublicResponse(req, res, publicId, store);
                return;
            }
            if (req.method === 'DELETE') {
                await revokePublicResponse(req, res, publicId, store);
                return;
            }
            res.setHeader('Allow', 'GET, DELETE');
            sendPrivateJson(res, 405, { error: 'Method not allowed' });
            logRequest(req, res, 'public response method-not-allowed');
        } catch {
            logger.error('Public response request failed.');
            sendPrivateJson(res, 500, { error: UNAVAILABLE_MESSAGE });
            logRequest(req, res, 'public response operation-failed');
        }
    };

    return { handlePublicResponsesRequest };
};
