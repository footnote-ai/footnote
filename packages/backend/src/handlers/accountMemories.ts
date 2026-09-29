/**
 * @description: Serves explicit, account-owned memory list, add, and forget operations.
 * @footnote-scope: interface
 * @footnote-module: AccountMemoryHandlers
 * @footnote-risk: high - Session and ownership checks protect durable private data.
 * @footnote-ethics: high - These handlers let users inspect and delete their saved memories.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
    GetAccountMemoriesResponseSchema,
    PostAccountMemoryRequestSchema,
    PostAccountMemoryResponseSchema,
} from '@footnote/contracts/web/schemas';
import type { AccountAuthService } from '../services/accountAuth.js';
import type { AccountStore } from '../storage/accounts/sqliteAccountStore.js';
import { sendJson } from './chatResponses.js';
import {
    readAccountSession,
    requireAccountMutationSession,
} from './accountRequest.js';
import {
    parseTrustedBodyWithSchema,
    type TrustedRouteLogRequest,
} from './trustedServiceRequest.js';

type RequestHandler = (
    req: IncomingMessage,
    res: ServerResponse
) => void | Promise<void>;

/** Creates memory handlers scoped only to the authenticated Footnote account. */
export const createAccountMemoryHandlers = ({
    accountAuthService,
    accountStore,
    logRequest,
}: {
    accountAuthService: AccountAuthService;
    accountStore: AccountStore | null;
    logRequest: TrustedRouteLogRequest;
}): {
    handleAccountMemoriesRequest: RequestHandler;
    handleAccountMemoryCreateRequest: RequestHandler;
    handleAccountMemoryDeleteRequest: RequestHandler;
} => {
    /** @api.operationId: getAccountMemories @api.path: GET /api/account/memories */
    const handleAccountMemoriesRequest: RequestHandler = (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const session = readAccountSession(req, accountAuthService);
        if (!session) {
            sendJson(res, 401, { error: 'Sign in required' });
            logRequest(req, res, 'account memories signed-out');
            return;
        }
        if (!accountStore) {
            sendJson(res, 503, { error: 'Account memories unavailable' });
            logRequest(req, res, 'account memories unavailable');
            return;
        }
        const parsed = GetAccountMemoriesResponseSchema.safeParse({
            memories: accountStore.listMemories(session.accountId),
        });
        if (!parsed.success) {
            sendJson(res, 500, { error: 'Failed to load account memories' });
            logRequest(req, res, 'account memories invalid response');
            return;
        }
        sendJson(res, 200, parsed.data);
        logRequest(req, res, 'account memories success');
    };

    /** @api.operationId: postAccountMemory @api.path: POST /api/account/memories */
    const handleAccountMemoryCreateRequest: RequestHandler = async (
        req,
        res
    ) => {
        res.setHeader('Cache-Control', 'no-store');
        const session = requireAccountMutationSession({
            req,
            res,
            accountAuthService,
            logRequest,
            routeLabel: 'account memory create',
        });
        if (!session) return;
        if (!accountStore) {
            sendJson(res, 503, { error: 'Account memories unavailable' });
            logRequest(req, res, 'account memory create unavailable');
            return;
        }
        const payload = await parseTrustedBodyWithSchema(req, res, {
            logRequest,
            routeLabel: 'account memory create',
            maxBodyBytes: 16_384,
            safeParse: (value) =>
                PostAccountMemoryRequestSchema.safeParse(value),
        });
        if (!payload) return;
        const memory = accountStore.addMemory(session.accountId, payload.text);
        if (!memory) {
            sendJson(res, 409, { error: 'Memory limit reached' });
            logRequest(req, res, 'account memory create limit-reached');
            return;
        }
        const parsed = PostAccountMemoryResponseSchema.safeParse({ memory });
        if (!parsed.success) {
            sendJson(res, 500, { error: 'Failed to save account memory' });
            logRequest(req, res, 'account memory create invalid response');
            return;
        }
        sendJson(res, 201, parsed.data);
        logRequest(req, res, 'account memory create success');
    };

    /** @api.operationId: deleteAccountMemory @api.path: DELETE /api/account/memories/{memoryId} */
    const handleAccountMemoryDeleteRequest: RequestHandler = (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const session = requireAccountMutationSession({
            req,
            res,
            accountAuthService,
            logRequest,
            routeLabel: 'account memory delete',
        });
        if (!session) return;
        if (!accountStore) {
            sendJson(res, 503, { error: 'Account memories unavailable' });
            logRequest(req, res, 'account memory delete unavailable');
            return;
        }
        const memoryId =
            new URL(req.url ?? '/', 'http://localhost').pathname
                .split('/')
                .at(-1) ?? '';
        if (!/^[0-9a-f-]{36}$/i.test(memoryId)) {
            sendJson(res, 400, { error: 'Invalid memory id' });
            logRequest(req, res, 'account memory delete invalid-id');
            return;
        }
        if (!accountStore.forgetMemory(session.accountId, memoryId)) {
            sendJson(res, 404, { error: 'Memory not found' });
            logRequest(req, res, 'account memory delete not-found');
            return;
        }
        sendJson(res, 200, { success: true });
        logRequest(req, res, 'account memory delete success');
    };

    return {
        handleAccountMemoriesRequest,
        handleAccountMemoryCreateRequest,
        handleAccountMemoryDeleteRequest,
    };
};
