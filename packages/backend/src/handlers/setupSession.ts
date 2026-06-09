/**
 * @description: Setup bootstrap session exchange handlers for first-setup cookie issuance and revocation.
 * @footnote-scope: interface
 * @footnote-module: SetupSessionHandler
 * @footnote-risk: high - Mistakes can expose privileged first-setup access or allow session bypasses.
 * @footnote-ethics: high - Setup-session controls govern who can perform first-run configuration and should remain explicit and auditable.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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
    settingsPath: string;
    setupBaseUrl: string;
    logger: SetupSessionLogger;
    logRequest: LogRequest;
};

type SetupSessionHandlers = {
    handleSetupSessionPostRequest: RequestHandler;
    handleSetupSessionDeleteRequest: RequestHandler;
    handleSetupOperatorLinkPostRequest: RequestHandler;
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

type SetupOperatorLinkAction = 'settings' | 'reset';

const parseSetupOperatorLinkRequestBody = (
    rawBody: string
): { ok: true; action: SetupOperatorLinkAction } | { ok: false } => {
    try {
        const parsed = JSON.parse(rawBody) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { ok: false };
        }
        const action = (parsed as { action?: unknown }).action;
        if (action !== 'settings' && action !== 'reset') {
            return { ok: false };
        }
        return { ok: true, action };
    } catch {
        return { ok: false };
    }
};

export const isLoopbackAddress = (remoteAddress: string | undefined): boolean =>
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1';

const pathExists = async (filePath: string): Promise<boolean> => {
    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        return true;
    } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
};

const buildBackupPath = (settingsPath: string, now = new Date()): string => {
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    return `${settingsPath}.reset-backup-${timestamp}`;
};

const buildSetupLinkPayload = ({
    action,
    settingsState,
    setupBaseUrl,
    issued,
    backupPath,
}: {
    action: SetupOperatorLinkAction;
    settingsState: 'present' | 'missing' | 'reset';
    setupBaseUrl: string;
    issued: { code: string; mode: string; expiresAt: string };
    backupPath?: string;
}) => {
    const setupPath = `/setup#code=${encodeURIComponent(issued.code)}`;
    return {
        ok: true,
        action,
        mode: issued.mode,
        setupPath,
        setupUrl: `${setupBaseUrl}${setupPath}`,
        expiresAt: issued.expiresAt,
        settingsState,
        ...(backupPath ? { backupPath } : {}),
    };
};

export const createSetupSessionHandlers = ({
    setupBootstrapService,
    settingsPath,
    setupBaseUrl,
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

    /**
     * @api.operationId: postSetupOperatorLink
     * @api.path: POST /api/setup/operator-link
     */
    const handleSetupOperatorLinkPostRequest: RequestHandler = async (
        req,
        res
    ) => {
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed' });
            logRequest(req, res, 'setup.operator-link method-not-allowed');
            return;
        }

        const requestId = readRequestId(req);
        if (!isLoopbackAddress(req.socket.remoteAddress)) {
            sendJson(res, 403, {
                error: 'Operator link requires local access',
            });
            logger.warn('setup.operator_link.denied', {
                requestId,
                remoteAddress: req.socket.remoteAddress,
            });
            logRequest(req, res, 'setup.operator-link non-local');
            return;
        }

        try {
            const rawBody = await readRawBody(req);
            const parsedBody = parseSetupOperatorLinkRequestBody(rawBody);
            if (!parsedBody.ok) {
                sendJson(res, 400, { error: 'Invalid request payload' });
                logger.warn('setup.operator_link.failed', {
                    requestId,
                    code: 'invalid_payload',
                });
                logRequest(req, res, 'setup.operator-link invalid-payload');
                return;
            }

            const configExistsBefore = await pathExists(settingsPath);
            let backupPath: string | undefined;
            let settingsState: 'present' | 'missing' | 'reset';
            if (parsedBody.action === 'reset') {
                if (configExistsBefore) {
                    backupPath = buildBackupPath(settingsPath);
                    await fs.promises.mkdir(path.dirname(settingsPath), {
                        recursive: true,
                    });
                    await fs.promises.copyFile(settingsPath, backupPath);
                    await fs.promises.rm(settingsPath, { force: true });
                    settingsState = 'reset';
                } else {
                    settingsState = 'missing';
                }
            } else {
                settingsState = configExistsBefore ? 'present' : 'missing';
            }

            const mode =
                parsedBody.action === 'settings' && configExistsBefore
                    ? 'operator'
                    : 'first-run';
            const issued = await setupBootstrapService.issueOrGetActiveCode({
                mode,
            });
            if (!issued) {
                sendJson(res, 409, { error: 'Setup link is not available' });
                logger.warn('setup.operator_link.failed', {
                    requestId,
                    code: 'link_unavailable',
                    action: parsedBody.action,
                    mode,
                    settingsState,
                });
                logRequest(req, res, 'setup.operator-link unavailable');
                return;
            }

            sendJson(
                res,
                200,
                buildSetupLinkPayload({
                    action: parsedBody.action,
                    settingsState,
                    setupBaseUrl,
                    issued,
                    backupPath,
                }),
                {
                    'Cache-Control': 'no-store',
                }
            );
            logger.info('setup.operator_link.succeeded', {
                requestId,
                action: parsedBody.action,
                mode: issued.mode,
                settingsState,
                backupPath,
                expiresAt: issued.expiresAt,
            });
            logRequest(req, res, 'setup.operator-link ok');
        } catch (error) {
            if (error instanceof RequestBodyTooLargeError) {
                sendJson(res, 400, { error: 'Invalid request payload' });
                logger.warn('setup.operator_link.failed', {
                    requestId,
                    code: 'payload_too_large',
                });
                logRequest(req, res, 'setup.operator-link payload-too-large');
                return;
            }
            sendJson(res, 500, { error: 'Internal server error' });
            logger.error('setup.operator_link.failed', {
                requestId,
                code: 'internal_error',
                message:
                    error instanceof Error ? error.message : 'unknown error',
            });
            logRequest(req, res, 'setup.operator-link failed');
        }
    };

    return {
        handleSetupSessionPostRequest,
        handleSetupSessionDeleteRequest,
        handleSetupOperatorLinkPostRequest,
    };
};
