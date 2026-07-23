/**
 * @description: Handles OIDC login, callback, account-session reads, and local logout.
 * @footnote-scope: interface
 * @footnote-module: AccountAuthHandlers
 * @footnote-risk: high - Cookie or callback mistakes could create unauthorized sessions.
 * @footnote-ethics: high - These handlers govern identity admission and privacy-sensitive logs.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GetAuthSessionResponse } from '@footnote/contracts/web';
import { sendJson } from './chatResponses.js';
import type { AccountAuthService } from '../services/accountAuth.js';

export const ACCOUNT_TRANSACTION_COOKIE_NAME = 'footnote_auth_transaction';
export const ACCOUNT_SESSION_COOKIE_NAME = 'footnote_account_session';
const AUTH_CSRF_HEADER_NAME = 'x-auth-csrf';

type AccountAuthLogger = {
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
};

type RequestHandler = (
    req: IncomingMessage,
    res: ServerResponse
) => Promise<void>;

type CreateAccountAuthHandlersDeps = {
    accountAuthService: AccountAuthService;
    secureCookies: boolean;
    logger: AccountAuthLogger;
    logRequest: (
        req: IncomingMessage,
        res: ServerResponse,
        extra?: string
    ) => void;
};

export type AccountAuthHandlers = {
    handleAuthLoginRequest: RequestHandler;
    handleAuthCallbackRequest: RequestHandler;
    handleAuthSessionRequest: RequestHandler;
    handleAuthLogoutRequest: RequestHandler;
};

const readSingleHeader = (
    value: string | string[] | undefined
): string | null => {
    if (!value) {
        return null;
    }
    const rawValue = Array.isArray(value) ? value[0] : value;
    const trimmed = rawValue.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const readCookie = (
    req: IncomingMessage,
    cookieName: string
): string | null => {
    const cookieHeader = readSingleHeader(req.headers.cookie);
    if (!cookieHeader) {
        return null;
    }
    for (const segment of cookieHeader.split(';')) {
        const [rawName, ...rawValue] = segment.split('=');
        if (rawName?.trim() !== cookieName) {
            continue;
        }
        const value = rawValue.join('=').trim();
        return value.length > 0 ? value : null;
    }
    return null;
};

const buildCookie = ({
    name,
    value,
    path,
    maxAgeMs,
    secure,
}: {
    name: string;
    value: string;
    path: string;
    maxAgeMs: number;
    secure: boolean;
}): string => {
    const parts = [
        `${name}=${value}`,
        `Path=${path}`,
        `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1_000))}`,
        'HttpOnly',
        'SameSite=Lax',
    ];
    if (secure) {
        parts.push('Secure');
    }
    return parts.join('; ');
};

const buildTransactionCookie = (
    transactionId: string,
    maxAgeMs: number,
    secure: boolean
): string =>
    buildCookie({
        name: ACCOUNT_TRANSACTION_COOKIE_NAME,
        value: transactionId,
        path: '/api/auth/callback',
        maxAgeMs,
        secure,
    });

const buildTransactionClearCookie = (secure: boolean): string =>
    buildTransactionCookie('', 0, secure);

const buildSessionCookie = (
    sessionId: string,
    maxAgeMs: number,
    secure: boolean
): string =>
    buildCookie({
        name: ACCOUNT_SESSION_COOKIE_NAME,
        value: sessionId,
        path: '/api/auth',
        maxAgeMs,
        secure,
    });

const buildSessionClearCookie = (secure: boolean): string =>
    buildSessionCookie('', 0, secure);

const setNoStore = (res: ServerResponse): void => {
    res.setHeader('Cache-Control', 'no-store');
};

const redirect = (
    res: ServerResponse,
    location: string,
    cookies?: string[]
): void => {
    res.statusCode = 302;
    res.setHeader('Location', location);
    if (cookies && cookies.length > 0) {
        res.setHeader('Set-Cookie', cookies);
    }
    res.end();
};

const constantTimeEquals = (left: string, right: string): boolean => {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
        leftBuffer.length === rightBuffer.length &&
        timingSafeEqual(leftBuffer, rightBuffer)
    );
};

const hashPrincipal = (issuer: string, subject: string): string =>
    createHash('sha256')
        .update(issuer)
        .update('\0')
        .update(subject)
        .digest('hex')
        .slice(0, 24);

/**
 * @api.operationId: getAuthLogin
 * @api.path: GET /api/auth/login
 * @api.operationId: getAuthCallback
 * @api.path: GET /api/auth/callback
 * @api.operationId: getAuthSession
 * @api.path: GET /api/auth/session
 * @api.operationId: postAuthLogout
 * @api.path: POST /api/auth/logout
 */
export const createAccountAuthHandlers = ({
    accountAuthService,
    secureCookies,
    logger,
    logRequest,
}: CreateAccountAuthHandlersDeps): AccountAuthHandlers => {
    const handleAuthLoginRequest: RequestHandler = async (req, res) => {
        setNoStore(res);
        const requestId = readSingleHeader(req.headers['x-request-id']);
        const result = await accountAuthService.startLogin();
        if (!result.ok) {
            const statusCode = result.reason === 'capacity' ? 429 : 503;
            sendJson(res, statusCode, {
                error:
                    statusCode === 429
                        ? 'Too many sign-in attempts'
                        : 'Account sign-in is unavailable',
            });
            logger.warn('account.auth.login.failed', {
                requestId,
                reason: result.reason,
                statusCode,
            });
            logRequest(req, res, `account.auth.login ${result.reason}`);
            return;
        }

        redirect(res, result.authorizationUrl, [
            buildTransactionCookie(
                result.transactionId,
                result.expiresAtMs - Date.now(),
                secureCookies
            ),
        ]);
        logger.info('account.auth.login.started', { requestId });
        logRequest(req, res, 'account.auth.login started');
    };

    const handleAuthCallbackRequest: RequestHandler = async (req, res) => {
        setNoStore(res);
        const requestId = readSingleHeader(req.headers['x-request-id']);
        const transactionId = readCookie(req, ACCOUNT_TRANSACTION_COOKIE_NAME);
        const callbackQuery = new URL(
            req.url ?? '/api/auth/callback',
            'http://localhost'
        ).search;
        const result = transactionId
            ? await accountAuthService.completeLogin(
                  transactionId,
                  callbackQuery
              )
            : { ok: false as const, reason: 'invalid_transaction' as const };

        if (!result.ok) {
            redirect(res, '/account?auth=failed', [
                buildTransactionClearCookie(secureCookies),
            ]);
            logger.warn('account.auth.callback.failed', {
                requestId,
                reason: result.reason,
            });
            logRequest(req, res, `account.auth.callback ${result.reason}`);
            return;
        }

        const expiresAtMs = Date.parse(result.session.expiresAt);
        redirect(res, '/account', [
            buildTransactionClearCookie(secureCookies),
            buildSessionCookie(
                result.session.sessionId,
                expiresAtMs - Date.now(),
                secureCookies
            ),
        ]);
        logger.info('account.auth.callback.succeeded', {
            requestId,
            actorHash: hashPrincipal(
                result.session.principal.issuer,
                result.session.principal.subject
            ),
            expiresAt: result.session.expiresAt,
        });
        logRequest(req, res, 'account.auth.callback succeeded');
    };

    const handleAuthSessionRequest: RequestHandler = async (req, res) => {
        setNoStore(res);
        if (!accountAuthService.enabled) {
            const payload: GetAuthSessionResponse = {
                enabled: false,
                authenticated: false,
            };
            sendJson(res, 200, payload);
            logRequest(req, res, 'account.auth.session disabled');
            return;
        }

        const sessionId = readCookie(req, ACCOUNT_SESSION_COOKIE_NAME);
        const session = sessionId
            ? accountAuthService.getSession(sessionId)
            : null;
        if (!session) {
            if (sessionId) {
                res.setHeader(
                    'Set-Cookie',
                    buildSessionClearCookie(secureCookies)
                );
            }
            const payload: GetAuthSessionResponse = {
                enabled: true,
                authenticated: false,
            };
            sendJson(res, 200, payload);
            logRequest(req, res, 'account.auth.session signed-out');
            return;
        }

        const payload: GetAuthSessionResponse = {
            enabled: true,
            authenticated: true,
            principal: session.principal,
            expiresAt: session.expiresAt,
            csrfToken: session.csrfToken,
        };
        sendJson(res, 200, payload);
        logRequest(req, res, 'account.auth.session authenticated');
    };

    const handleAuthLogoutRequest: RequestHandler = async (req, res) => {
        setNoStore(res);
        const requestId = readSingleHeader(req.headers['x-request-id']);
        const sessionId = readCookie(req, ACCOUNT_SESSION_COOKIE_NAME);
        const session = sessionId
            ? accountAuthService.getSession(sessionId)
            : null;

        if (session) {
            const csrfToken = readSingleHeader(
                req.headers[AUTH_CSRF_HEADER_NAME]
            );
            if (
                !csrfToken ||
                !constantTimeEquals(csrfToken, session.csrfToken)
            ) {
                sendJson(res, 403, { error: 'Invalid CSRF token' });
                logger.warn('account.auth.logout.failed', {
                    requestId,
                    reason: 'invalid_csrf',
                });
                logRequest(req, res, 'account.auth.logout invalid-csrf');
                return;
            }
            accountAuthService.clearSession(session.sessionId);
        }

        res.statusCode = 204;
        res.setHeader('Set-Cookie', buildSessionClearCookie(secureCookies));
        res.end();
        logger.info('account.auth.logout.succeeded', {
            requestId,
            hadSession: Boolean(session),
        });
        logRequest(req, res, 'account.auth.logout succeeded');
    };

    return {
        handleAuthLoginRequest,
        handleAuthCallbackRequest,
        handleAuthSessionRequest,
        handleAuthLogoutRequest,
    };
};
