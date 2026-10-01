/**
 * @description: Handles trusted Discord start/status/confirm operations and browser-bound consent writes.
 * @footnote-scope: interface
 * @footnote-module: DiscordAccountConnectionHandlers
 * @footnote-risk: high - Handler mistakes can link the wrong Discord user to an account.
 * @footnote-ethics: high - Capabilities, confirmation codes, and Discord IDs must not enter logs.
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
    AccountAuthService,
    DiscordAccountConnectionService,
} from '../services/accountAuth.js';
import { sendJson } from './chatResponses.js';
import {
    parseTrustedBodyWithSchema,
    parseTrustedServiceAuth,
    type TrustedRouteLogRequest,
} from './trustedServiceRequest.js';
import {
    readCookieValue,
    AUTH_CSRF_HEADER_NAME,
    ACCOUNT_SESSION_COOKIE_NAME,
} from '../http/authCookies.js';
import {
    DiscordAccountStartRequestSchema,
    DiscordAccountStatusRequestSchema,
    DiscordAccountConfirmRequestSchema,
    DiscordAccountExchangeRequestSchema,
    DiscordAccountConsentRequestSchema,
} from '@footnote/contracts/web';

const CONNECTION_COOKIE = 'footnote_discord_connection';
type Deps = {
    service: AccountAuthService & DiscordAccountConnectionService;
    traceApiToken: string | null;
    serviceToken: string | null;
    maxBodyBytes: number;
    secureCookies: boolean;
    publicOrigin: string;
    logRequest: TrustedRouteLogRequest;
};
const noStore = (res: ServerResponse): void => {
    res.setHeader('Cache-Control', 'no-store');
};
const cookie = (value: string, secure: boolean, maxAge = 600): string =>
    `${CONNECTION_COOKIE}=${value}; Path=/api/auth/discord-connection; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
const csrfMatches = (req: IncomingMessage, token: string): boolean => {
    const value = req.headers[AUTH_CSRF_HEADER_NAME];
    const supplied = Array.isArray(value) ? value[0] : value;
    if (!supplied) return false;
    const suppliedBytes = Buffer.from(supplied);
    const tokenBytes = Buffer.from(token);
    if (
        suppliedBytes.length === 0 ||
        suppliedBytes.length !== tokenBytes.length
    )
        return false;
    return timingSafeEqual(suppliedBytes, tokenBytes);
};

/**
 * Creates account-connection routes without granting browser requests access to
 * the trusted Discord identity input.
 */
export const createDiscordAccountConnectionHandlers = ({
    service,
    traceApiToken,
    serviceToken,
    maxBodyBytes,
    secureCookies,
    publicOrigin,
    logRequest,
}: Deps) => {
    const trustedAuth = (
        req: IncomingMessage,
        res: ServerResponse,
        route: string
    ): boolean => {
        const auth = parseTrustedServiceAuth(
            req,
            { traceApiToken, serviceToken },
            {
                missing: `${route} missing-auth`,
                invalid: `${route} invalid-auth`,
            }
        );
        if (auth.ok) return true;
        noStore(res);
        sendJson(res, auth.statusCode, auth.payload);
        logRequest(req, res, route);
        return false;
    };
    const parseBody = async <T>(
        req: IncomingMessage,
        res: ServerResponse,
        route: string,
        schema: {
            safeParse: (input: unknown) =>
                | { success: true; data: T }
                | {
                      success: false;
                      error: {
                          issues: Array<{
                              path: PropertyKey[];
                              message: string;
                          }>;
                      };
                  };
        }
    ): Promise<T | null> =>
        parseTrustedBodyWithSchema(req, res, {
            logRequest,
            routeLabel: route,
            maxBodyBytes,
            safeParse: schema.safeParse,
        });

    /** @api.operationId: postInternalDiscordAccountStart @api.path: POST /api/internal/discord/account/start */
    const handleTrustedStart = async (
        req: IncomingMessage,
        res: ServerResponse
    ): Promise<void> => {
        noStore(res);
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed' });
            return;
        }
        if (!trustedAuth(req, res, 'discord-account.start')) return;
        if (!service.discordConnectionsEnabled) {
            sendJson(res, 503, { error: 'Account connection unavailable' });
            return;
        }
        const body = await parseBody(
            req,
            res,
            'discord-account.start',
            DiscordAccountStartRequestSchema
        );
        if (!body) return;
        const started = service.startDiscordConnection(
            body.discordUserId,
            body.discordUsername
        );
        if (!started) {
            sendJson(res, 503, { error: 'Account connection unavailable' });
            return;
        }
        sendJson(res, 200, {
            connectionUrl: `${publicOrigin}/account#connect=${started.capability}`,
            expiresAt: started.expiresAt,
        });
    };
    /** @api.operationId: postInternalDiscordAccountStatus @api.path: POST /api/internal/discord/account/status */
    const handleTrustedStatus = async (
        req: IncomingMessage,
        res: ServerResponse
    ): Promise<void> => {
        noStore(res);
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed' });
            return;
        }
        if (!trustedAuth(req, res, 'discord-account.status')) return;
        if (!service.discordConnectionsEnabled) {
            sendJson(res, 503, { error: 'Account connection unavailable' });
            return;
        }
        const body = await parseBody(
            req,
            res,
            'discord-account.status',
            DiscordAccountStatusRequestSchema
        );
        if (!body) return;
        try {
            sendJson(res, 200, {
                connected:
                    service.findAccountByDiscordUserId(body.discordUserId) !==
                    null,
            });
        } catch {
            sendJson(res, 503, { error: 'Account connection unavailable' });
        }
    };
    /** @api.operationId: postInternalDiscordAccountConfirm @api.path: POST /api/internal/discord/account/confirm */
    const handleTrustedConfirm = async (
        req: IncomingMessage,
        res: ServerResponse
    ): Promise<void> => {
        noStore(res);
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed' });
            return;
        }
        if (!trustedAuth(req, res, 'discord-account.confirm')) return;
        if (!service.discordConnectionsEnabled) {
            sendJson(res, 503, { error: 'Account connection unavailable' });
            return;
        }
        const body = await parseBody(
            req,
            res,
            'discord-account.confirm',
            DiscordAccountConfirmRequestSchema
        );
        if (!body) return;
        const result = service.confirmDiscordConnection(
            body.discordUserId,
            body.code
        );
        if (result === 'unavailable') {
            sendJson(res, 503, { error: 'Account connection unavailable' });
            return;
        }
        sendJson(res, 200, { result });
    };

    /** @api.operationId: postDiscordConnectionExchange @api.path: POST /api/auth/discord-connection/exchange */
    const handleBrowserExchange = async (
        req: IncomingMessage,
        res: ServerResponse
    ): Promise<void> => {
        noStore(res);
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed' });
            return;
        }
        const body = await parseBody(
            req,
            res,
            'discord-account.exchange',
            DiscordAccountExchangeRequestSchema
        );
        if (!body) return;
        const connectionSessionId = service.exchangeDiscordCapability(
            body.capability
        );
        if (!connectionSessionId) {
            sendJson(res, 410, { error: 'Connection expired or unavailable' });
            return;
        }
        res.setHeader('Set-Cookie', cookie(connectionSessionId, secureCookies));
        sendJson(res, 200, {
            state:
                service.getDiscordConnectionState(connectionSessionId) ??
                'expired',
        });
    };
    /** @api.operationId: getDiscordConnectionState @api.path: GET /api/auth/discord-connection */
    const handleBrowserStatus = async (
        req: IncomingMessage,
        res: ServerResponse
    ): Promise<void> => {
        noStore(res);
        const connectionSessionId = readCookieValue(req, CONNECTION_COOKIE);
        const sessionId = readCookieValue(req, ACCOUNT_SESSION_COOKIE_NAME);
        const session = sessionId ? service.getSession(sessionId) : null;
        const state = connectionSessionId
            ? service.getDiscordConnectionState(
                  connectionSessionId,
                  session?.sessionId
              )
            : null;
        sendJson(res, 200, {
            state: state ?? (connectionSessionId ? 'expired' : 'none'),
            ...(state === 'waiting-for-discord-confirmation' &&
            connectionSessionId &&
            session
                ? {
                      code:
                          service.getDiscordConfirmationCode(
                              connectionSessionId,
                              session.sessionId
                          ) ?? undefined,
                  }
                : {}),
        });
    };
    /** @api.operationId: postDiscordConnectionConsent @api.path: POST /api/auth/discord-connection/consent */
    const handleBrowserConsent = async (
        req: IncomingMessage,
        res: ServerResponse
    ): Promise<void> => {
        noStore(res);
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed' });
            return;
        }
        const body = await parseBody(
            req,
            res,
            'discord-account.consent',
            DiscordAccountConsentRequestSchema
        );
        if (!body) return;
        const connectionSessionId = readCookieValue(req, CONNECTION_COOKIE);
        const sessionId = readCookieValue(req, ACCOUNT_SESSION_COOKIE_NAME);
        const session = sessionId ? service.getSession(sessionId) : null;
        if (
            !connectionSessionId ||
            !session ||
            !csrfMatches(req, session.csrfToken)
        ) {
            sendJson(res, 403, {
                error: 'Sign in and retry the connection request',
            });
            return;
        }
        const code = service.approveDiscordConnection(
            connectionSessionId,
            session.accountId,
            session.sessionId
        );
        if (!code) {
            sendJson(res, 409, {
                error: 'Connection expired or account changed',
            });
            return;
        }
        sendJson(res, 200, { code });
    };
    /** @api.operationId: postDiscordConnectionCancel @api.path: POST /api/auth/discord-connection/cancel */
    const handleBrowserCancel = async (
        req: IncomingMessage,
        res: ServerResponse
    ): Promise<void> => {
        noStore(res);
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed' });
            return;
        }
        const connectionSessionId = readCookieValue(req, CONNECTION_COOKIE);
        const sessionId = readCookieValue(req, ACCOUNT_SESSION_COOKIE_NAME);
        const session = sessionId ? service.getSession(sessionId) : null;
        if (
            !connectionSessionId ||
            !session ||
            !csrfMatches(req, session.csrfToken)
        ) {
            sendJson(res, 403, {
                error: 'Sign in and retry the connection request',
            });
            return;
        }
        service.cancelDiscordConnection(connectionSessionId);
        res.setHeader('Set-Cookie', cookie('', secureCookies, 0));
        sendJson(res, 200, { cancelled: true });
    };
    return {
        handleTrustedStart,
        handleTrustedStatus,
        handleTrustedConfirm,
        handleBrowserExchange,
        handleBrowserStatus,
        handleBrowserConsent,
        handleBrowserCancel,
    };
};
