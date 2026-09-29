/**
 * @description: Serves signed-in reporter incident association and status views.
 * @footnote-scope: interface
 * @footnote-module: AccountIncidentHandlers
 * @footnote-risk: high - Session and claim checks guard incident access.
 * @footnote-ethics: high - Reporter views must not expose operator-only incident data.
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
    GetAccountIncidentResponseSchema,
    GetAccountIncidentsResponseSchema,
    PostAccountIncidentClaimRequestSchema,
} from '@footnote/contracts/web/schemas';
import type { AccountAuthService } from '../services/accountAuth.js';
import type { IncidentService } from '../services/incidents.js';
import {
    ACCOUNT_SESSION_COOKIE_NAME,
    AUTH_CSRF_HEADER_NAME,
    readCookieValue,
} from '../http/authCookies.js';
import { sendJson } from './chatResponses.js';
import {
    parseTrustedBodyWithSchema,
    type TrustedRouteLogRequest,
} from './trustedServiceRequest.js';

type RequestHandler = (
    req: IncomingMessage,
    res: ServerResponse
) => Promise<void>;
type ParsedUrlHandler = (
    req: IncomingMessage,
    res: ServerResponse,
    parsedUrl: URL
) => Promise<void>;

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

/** Creates account-scoped reporter handlers; administrator status grants no extra access. */
export const createAccountIncidentHandlers = ({
    accountAuthService,
    incidentService,
    logRequest,
}: {
    accountAuthService: AccountAuthService;
    incidentService: IncidentService | null;
    logRequest: TrustedRouteLogRequest;
}): {
    handleAccountIncidentsRequest: RequestHandler;
    handleAccountIncidentRequest: ParsedUrlHandler;
    handleAccountIncidentClaimRequest: RequestHandler;
} => {
    const readAccountSession = (req: IncomingMessage) => {
        const sessionId = readCookieValue(req, ACCOUNT_SESSION_COOKIE_NAME);
        return sessionId ? accountAuthService.getSession(sessionId) : null;
    };

    /** @api.operationId: getAccountIncidents @api.path: GET /api/account/incidents */
    const handleAccountIncidentsRequest: RequestHandler = async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET') {
            sendJson(res, 405, { error: 'Method not allowed' });
            logRequest(req, res, 'account incidents method-not-allowed');
            return;
        }
        const session = readAccountSession(req);
        if (!session || !incidentService) {
            sendJson(res, session ? 503 : 401, {
                error: session
                    ? 'Incident account view unavailable'
                    : 'Sign in required',
            });
            logRequest(req, res, 'account incidents unavailable');
            return;
        }

        const payload = {
            incidents: await incidentService.listAssociatedIncidents(
                session.accountId
            ),
        };
        const parsed = GetAccountIncidentsResponseSchema.safeParse(payload);
        if (!parsed.success) {
            sendJson(res, 500, { error: 'Failed to load account incidents' });
            logRequest(
                req,
                res,
                'account incidents invalid reporter projection'
            );
            return;
        }
        sendJson(res, 200, parsed.data);
        logRequest(req, res, 'account incidents success');
    };

    /** @api.operationId: postAccountIncidentClaim @api.path: POST /api/account/incidents/claim */
    const handleAccountIncidentClaimRequest: RequestHandler = async (
        req,
        res
    ) => {
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed' });
            logRequest(req, res, 'account incident claim method-not-allowed');
            return;
        }
        const session = readAccountSession(req);
        if (!session) {
            sendJson(res, 401, { error: 'Sign in required' });
            logRequest(req, res, 'account incident claim signed-out');
            return;
        }
        const csrfToken = readHeader(req.headers[AUTH_CSRF_HEADER_NAME]);
        if (!csrfToken || !constantTimeEquals(csrfToken, session.csrfToken)) {
            sendJson(res, 403, { error: 'Invalid CSRF token' });
            logRequest(req, res, 'account incident claim invalid-csrf');
            return;
        }
        if (!incidentService) {
            sendJson(res, 503, { error: 'Incident account view unavailable' });
            logRequest(req, res, 'account incident claim unavailable');
            return;
        }

        const payload = await parseTrustedBodyWithSchema(req, res, {
            logRequest,
            routeLabel: 'account incident claim',
            maxBodyBytes: 256,
            safeParse: (value) =>
                PostAccountIncidentClaimRequestSchema.safeParse(value),
        });
        if (!payload) return;

        const result = await incidentService.associateIncident(
            payload.claimCode,
            session.accountId
        );
        if (result === 'unavailable') {
            sendJson(res, 404, { error: 'Claim code is invalid or expired' });
            logRequest(req, res, 'account incident claim unavailable');
            return;
        }
        sendJson(res, 200, { success: true });
        logRequest(req, res, 'account incident claim success');
    };

    /** @api.operationId: getAccountIncident @api.path: GET /api/account/incidents/{incidentId} */
    const handleAccountIncidentRequest: ParsedUrlHandler = async (
        req,
        res,
        parsedUrl
    ) => {
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET') {
            sendJson(res, 405, { error: 'Method not allowed' });
            logRequest(req, res, 'account incident method-not-allowed');
            return;
        }
        const session = readAccountSession(req);
        if (!session) {
            sendJson(res, 401, { error: 'Sign in required' });
            logRequest(req, res, 'account incident signed-out');
            return;
        }
        if (!incidentService) {
            sendJson(res, 503, { error: 'Incident account view unavailable' });
            logRequest(req, res, 'account incident unavailable');
            return;
        }
        const match = parsedUrl.pathname.match(
            /^\/api\/account\/incidents\/([^/]+)\/?$/
        );
        let incidentId: string;
        try {
            incidentId = match ? decodeURIComponent(match[1]).trim() : '';
        } catch {
            incidentId = '';
        }
        if (!incidentId) {
            sendJson(res, 404, { error: 'Report not found' });
            logRequest(req, res, 'account incident not-found');
            return;
        }
        const incident = await incidentService.getAssociatedIncident(
            session.accountId,
            incidentId
        );
        if (!incident) {
            sendJson(res, 404, { error: 'Report not found' });
            logRequest(req, res, 'account incident not-found');
            return;
        }
        const payload = GetAccountIncidentResponseSchema.safeParse({
            incident,
        });
        if (!payload.success) {
            sendJson(res, 500, { error: 'Failed to load report' });
            logRequest(
                req,
                res,
                'account incident invalid reporter projection'
            );
            return;
        }
        sendJson(res, 200, payload.data);
        logRequest(req, res, 'account incident success');
    };

    return {
        handleAccountIncidentsRequest,
        handleAccountIncidentRequest,
        handleAccountIncidentClaimRequest,
    };
};
