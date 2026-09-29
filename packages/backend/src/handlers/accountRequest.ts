/**
 * @description: Shares session and CSRF checks across account HTTP handlers.
 * @footnote-scope: utility
 * @footnote-module: AccountRequest
 * @footnote-risk: high - Shared account checks protect private data and mutations.
 * @footnote-ethics: high - These checks preserve account ownership and user control.
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
    AccountAuthService,
    AccountSession,
} from '../services/accountAuth.js';
import {
    ACCOUNT_SESSION_COOKIE_NAME,
    AUTH_CSRF_HEADER_NAME,
    readCookieValue,
} from '../http/authCookies.js';
import { sendJson } from './chatResponses.js';
import type { TrustedRouteLogRequest } from './trustedServiceRequest.js';

const readHeader = (value: string | string[] | undefined): string | null => {
    const header = Array.isArray(value) ? value[0] : value;
    return header?.trim() || null;
};

const constantTimeEquals = (left: string, right: string): boolean => {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
        leftBuffer.length === rightBuffer.length &&
        timingSafeEqual(leftBuffer, rightBuffer)
    );
};

export const readAccountSession = (
    req: IncomingMessage,
    accountAuthService: AccountAuthService
): AccountSession | null => {
    const sessionId = readCookieValue(req, ACCOUNT_SESSION_COOKIE_NAME);
    return sessionId ? accountAuthService.getSession(sessionId) : null;
};

export const requireAccountMutationSession = ({
    req,
    res,
    accountAuthService,
    logRequest,
    routeLabel,
}: {
    req: IncomingMessage;
    res: ServerResponse;
    accountAuthService: AccountAuthService;
    logRequest: TrustedRouteLogRequest;
    routeLabel: string;
}): AccountSession | null => {
    const session = readAccountSession(req, accountAuthService);
    if (!session) {
        sendJson(res, 401, { error: 'Sign in required' });
        logRequest(req, res, `${routeLabel} signed-out`);
        return null;
    }
    const csrfToken = readHeader(req.headers[AUTH_CSRF_HEADER_NAME]);
    if (!csrfToken || !constantTimeEquals(csrfToken, session.csrfToken)) {
        sendJson(res, 403, { error: 'Invalid CSRF token' });
        logRequest(req, res, `${routeLabel} invalid-csrf`);
        return null;
    }
    return session;
};
