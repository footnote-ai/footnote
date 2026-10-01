/**
 * @description: Serves the signed-in account's durable Discord link and disconnect action.
 * @footnote-scope: interface
 * @footnote-module: AccountDiscordConnectionHandlers
 * @footnote-risk: high - Account ownership checks protect persisted identity links.
 * @footnote-ethics: high - Users can inspect and remove their chosen Discord association.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DiscordAccountStatusResponseSchema } from '@footnote/contracts/web/schemas';
import type {
    AccountAuthService,
    DiscordAccountConnectionService,
} from '../services/accountAuth.js';
import type { AccountStore } from '../storage/accounts/sqliteAccountStore.js';
import { sendJson } from './chatResponses.js';
import {
    readAccountSession,
    requireAccountMutationSession,
} from './accountRequest.js';
import type { TrustedRouteLogRequest } from './trustedServiceRequest.js';

type RequestHandler = (
    req: IncomingMessage,
    res: ServerResponse
) => void | Promise<void>;

/** Creates the self-service endpoints for the durable account Discord mapping. */
export const createAccountDiscordConnectionHandlers = ({
    accountAuthService,
    accountStore,
    logRequest,
}: {
    accountAuthService: AccountAuthService &
        Pick<
            DiscordAccountConnectionService,
            'cancelDiscordConnectionsForAccount'
        >;
    accountStore: AccountStore | null;
    logRequest: TrustedRouteLogRequest;
}): {
    handleAccountDiscordStatusRequest: RequestHandler;
    handleAccountDiscordDisconnectRequest: RequestHandler;
} => {
    /** @api.operationId: getAccountDiscordConnection @api.path: GET /api/account/discord-connection */
    const handleAccountDiscordStatusRequest: RequestHandler = (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const session = readAccountSession(req, accountAuthService);
        if (!session) {
            sendJson(res, 401, { error: 'Sign in required' });
            logRequest(req, res, 'account Discord connection signed-out');
            return;
        }
        if (!accountStore) {
            sendJson(res, 503, { error: 'Discord connection unavailable' });
            logRequest(req, res, 'account Discord connection unavailable');
            return;
        }
        const parsed = DiscordAccountStatusResponseSchema.safeParse({
            connected: accountStore.hasDiscordLinkForAccount(session.accountId),
        });
        if (!parsed.success) {
            sendJson(res, 500, { error: 'Failed to load Discord connection' });
            logRequest(req, res, 'account Discord connection invalid response');
            return;
        }
        sendJson(res, 200, parsed.data);
        logRequest(req, res, 'account Discord connection success');
    };

    /** @api.operationId: deleteAccountDiscordConnection @api.path: DELETE /api/account/discord-connection */
    const handleAccountDiscordDisconnectRequest: RequestHandler = (
        req,
        res
    ) => {
        res.setHeader('Cache-Control', 'no-store');
        const session = requireAccountMutationSession({
            req,
            res,
            accountAuthService,
            logRequest,
            routeLabel: 'account Discord disconnect',
        });
        if (!session) return;
        if (!accountStore) {
            sendJson(res, 503, { error: 'Discord connection unavailable' });
            logRequest(req, res, 'account Discord disconnect unavailable');
            return;
        }
        try {
            accountStore.unlinkDiscordUserFromAccount(session.accountId);
        } catch {
            sendJson(res, 503, { error: 'Discord connection unavailable' });
            logRequest(req, res, 'account Discord disconnect storage-failed');
            return;
        }
        accountAuthService.cancelDiscordConnectionsForAccount(
            session.accountId
        );
        res.statusCode = 204;
        res.end();
        logRequest(req, res, 'account Discord disconnect success');
    };

    return {
        handleAccountDiscordStatusRequest,
        handleAccountDiscordDisconnectRequest,
    };
};
