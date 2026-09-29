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
    GetAccountIncidentsResponseSchema,
    PostAccountIncidentClaimRequestSchema,
} from '@footnote/contracts/web/schemas';
import type { AccountAuthService } from '../services/accountAuth.js';
import type { IncidentService } from '../services/incidents.js';
import type { AccountStore } from '../storage/accounts/sqliteAccountStore.js';
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

/** Creates account-scoped handlers; administrator status grants no extra access. */
export const createAccountIncidentHandlers = ({
    accountAuthService,
    accountStore,
    incidentService,
    logRequest,
}: {
    accountAuthService: AccountAuthService;
    accountStore: AccountStore | null;
    incidentService: IncidentService | null;
    logRequest: TrustedRouteLogRequest;
}): {
    handleAccountIncidentsRequest: RequestHandler;
    handleAccountIncidentClaimRequest: RequestHandler;
    handleAccountExportRequest: RequestHandler;
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

    /** @api.operationId: getAccountExport @api.path: GET /api/account/export */
    const handleAccountExportRequest: RequestHandler = async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET') {
            sendJson(res, 405, { error: 'Method not allowed' });
            logRequest(req, res, 'account export method-not-allowed');
            return;
        }
        const session = readAccountSession(req);
        if (!session) {
            sendJson(res, 401, { error: 'Sign in required' });
            logRequest(req, res, 'account export signed-out');
            return;
        }
        if (!accountStore || !incidentService) {
            sendJson(res, 503, { error: 'Account export unavailable' });
            logRequest(req, res, 'account export unavailable');
            return;
        }
        const accountData = accountStore.getAccountExportData(
            session.accountId
        );
        if (!accountData) {
            sendJson(res, 503, { error: 'Account export unavailable' });
            logRequest(req, res, 'account export account unavailable');
            return;
        }
        const payload = {
            format: 'footnote-account-export',
            version: 1,
            generatedAt: new Date().toISOString(),
            retention: {
                identityProvider:
                    'This export includes only identity identifiers Footnote retains; it does not export or modify the provider account.',
                modelProviders:
                    'Provider-side model data retention is outside Footnote account data and is not represented here.',
                incidents:
                    'Incident reports remain separately governed operational records. Only this account’s association time and reporter-safe summary are included.',
                memories:
                    'Memories are text explicitly saved by the account holder and are not verified source evidence.',
            },
            data: {
                account: { category: 'account', ...accountData.account },
                externalIdentityMappings: {
                    category: 'external_identity_mappings',
                    records: accountData.externalIdentityMappings,
                },
                discordMappings: {
                    category: 'discord_mappings',
                    records: accountData.discordMappings,
                },
                memories: {
                    category: 'user_memories',
                    records: accountData.memories,
                },
                incidentAssociations: {
                    category: 'incident_associations',
                    records:
                        await incidentService.listAssociatedIncidentsForExport(
                            session.accountId
                        ),
                },
            },
        };
        sendJson(res, 200, payload, {
            'Content-Disposition':
                'attachment; filename="footnote-account-export.json"',
        });
        logRequest(req, res, 'account export success');
    };

    return {
        handleAccountIncidentsRequest,
        handleAccountIncidentClaimRequest,
        handleAccountExportRequest,
    };
};
