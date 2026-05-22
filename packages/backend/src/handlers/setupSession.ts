/**
 * @description: Setup bootstrap session exchange handlers for first-setup cookie issuance and revocation.
 * @footnote-scope: interface
 * @footnote-module: SetupSessionHandler
 * @footnote-risk: high - Mistakes can expose privileged first-setup access or allow session bypasses.
 * @footnote-ethics: high - Setup-session controls govern who can perform first-run configuration and should remain explicit and auditable.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './chatResponses.js';
import {
    buildSetupSessionClearCookie,
    buildSetupSessionCookie,
    readSetupSessionIdFromRequest,
    requestUsesSecureTransport,
    type SetupBootstrapService,
} from '../services/setupBootstrap.js';

type LogRequest = (
    req: IncomingMessage,
    res: ServerResponse,
    extra?: string
) => void;

type SetupSessionLogger = {
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
};

type RequestHandler = (
    req: IncomingMessage,
    res: ServerResponse
) => Promise<void>;

type CreateSetupSessionHandlersDeps = {
    setupBootstrapService: SetupBootstrapService;
    logger: SetupSessionLogger;
    logRequest: LogRequest;
};

type SetupSessionHandlers = {
    handleSetupSessionPostRequest: RequestHandler;
    handleSetupSessionDeleteRequest: RequestHandler;
};

const MAX_SETUP_SESSION_BODY_BYTES = 4_096;

class RequestBodyTooLargeError extends Error {
    constructor() {
        super('Request payload too large');
        this.name = 'RequestBodyTooLargeError';
    }
}

const readSingleHeaderValue = (
    value: string | string[] | undefined
): string | null => {
    if (!value) {
        return null;
    }
    const rawValue = Array.isArray(value) ? value[0] : value;
    const trimmed = rawValue.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const readRequestId = (req: IncomingMessage): string | null =>
    readSingleHeaderValue(req.headers['x-request-id']);

const readRawBody = async (req: IncomingMessage): Promise<string> => {
    const contentLengthHeader = req.headers['content-length'];
    if (contentLengthHeader) {
        const contentLength = Number(contentLengthHeader);
        if (
            Number.isFinite(contentLength) &&
            contentLength > MAX_SETUP_SESSION_BODY_BYTES
        ) {
            throw new RequestBodyTooLargeError();
        }
    }

    const chunks: Buffer[] = [];
    let bodyBytes = 0;
    for await (const chunk of req) {
        const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bodyBytes += chunkBuffer.length;
        if (bodyBytes > MAX_SETUP_SESSION_BODY_BYTES) {
            throw new RequestBodyTooLargeError();
        }
        chunks.push(chunkBuffer);
    }
    return Buffer.concat(chunks, bodyBytes).toString('utf8');
};

const parseSetupSessionRequestBody = (
    rawBody: string
): { ok: true; code: string } | { ok: false } => {
    try {
        const parsed = JSON.parse(rawBody) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { ok: false };
        }
        const code = (parsed as { code?: unknown }).code;
        if (typeof code !== 'string' || code.trim().length === 0) {
            return { ok: false };
        }
        return { ok: true, code: code.trim() };
    } catch {
        return { ok: false };
    }
};

export const createSetupSessionHandlers = ({
    setupBootstrapService,
    logger,
    logRequest,
}: CreateSetupSessionHandlersDeps): SetupSessionHandlers => {
    /**
     * @api.operationId: postSetupSession
     * @api.path: POST /api/setup/session
     */
    const handleSetupSessionPostRequest: RequestHandler = async (req, res) => {
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed' });
            logRequest(req, res, 'setup.session.post method-not-allowed');
            return;
        }

        const requestId = readRequestId(req);
        try {
            const rawBody = await readRawBody(req);
            const parsedBody = parseSetupSessionRequestBody(rawBody);
            if (!parsedBody.ok) {
                sendJson(res, 400, { error: 'Invalid request payload' });
                logger.warn('setup.session.exchange.failed', {
                    requestId,
                    code: 'invalid_payload',
                });
                logRequest(req, res, 'setup.session.post invalid-payload');
                return;
            }

            const exchangeResult =
                await setupBootstrapService.exchangeCodeForSession(
                    parsedBody.code
                );
            if (!exchangeResult.ok) {
                if (exchangeResult.reason === 'setup_not_required') {
                    sendJson(res, 409, { error: 'Setup is not required' });
                    logger.warn('setup.session.exchange.failed', {
                        requestId,
                        code: 'setup_not_required',
                    });
                    logRequest(
                        req,
                        res,
                        'setup.session.post setup-not-required'
                    );
                    return;
                }
                sendJson(res, 401, { error: 'Invalid setup code' });
                logger.warn('setup.session.exchange.failed', {
                    requestId,
                    code: 'invalid_code',
                });
                logRequest(req, res, 'setup.session.post invalid-code');
                return;
            }

            const secure = requestUsesSecureTransport(req);
            const expiresAtMs = Date.parse(exchangeResult.session.expiresAt);
            const maxAgeMs = Number.isFinite(expiresAtMs)
                ? Math.max(0, expiresAtMs - Date.now())
                : 0;
            const sessionCookie = buildSetupSessionCookie({
                sessionId: exchangeResult.session.sessionId,
                maxAgeMs,
                secure,
            });

            sendJson(
                res,
                200,
                {
                    ok: true,
                    expiresAt: exchangeResult.session.expiresAt,
                    csrfToken: exchangeResult.session.csrfToken,
                },
                {
                    'Cache-Control': 'no-store',
                    'Set-Cookie': sessionCookie,
                }
            );
            logger.info('setup.session.exchange.succeeded', {
                requestId,
                secureCookie: secure,
                expiresAt: exchangeResult.session.expiresAt,
            });
            logRequest(req, res, 'setup.session.post ok');
        } catch (error) {
            if (error instanceof RequestBodyTooLargeError) {
                sendJson(res, 400, { error: 'Invalid request payload' });
                logger.warn('setup.session.exchange.failed', {
                    requestId,
                    code: 'payload_too_large',
                });
                logRequest(req, res, 'setup.session.post payload-too-large');
                return;
            }
            sendJson(res, 500, { error: 'Internal server error' });
            logger.error('setup.session.exchange.failed', {
                requestId,
                code: 'internal_error',
                message:
                    error instanceof Error ? error.message : 'unknown error',
            });
            logRequest(req, res, 'setup.session.post failed');
        }
    };

    /**
     * @api.operationId: deleteSetupSession
     * @api.path: DELETE /api/setup/session
     */
    const handleSetupSessionDeleteRequest: RequestHandler = async (
        req,
        res
    ) => {
        if (req.method !== 'DELETE') {
            sendJson(res, 405, { error: 'Method not allowed' });
            logRequest(req, res, 'setup.session.delete method-not-allowed');
            return;
        }

        const requestId = readRequestId(req);
        const sessionId = readSetupSessionIdFromRequest(req);
        if (sessionId) {
            setupBootstrapService.clearSetupSession(sessionId);
        }
        const secure = requestUsesSecureTransport(req);
        res.statusCode = 204;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Set-Cookie', buildSetupSessionClearCookie(secure));
        res.end();
        logger.info('setup.session.clear.succeeded', {
            requestId,
            hadSessionCookie: Boolean(sessionId),
            secureCookie: secure,
        });
        logRequest(req, res, 'setup.session.delete ok');
    };

    return {
        handleSetupSessionPostRequest,
        handleSetupSessionDeleteRequest,
    };
};
