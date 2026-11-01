/**
 * @description: Handles /api/chat requests for the public web UI and trusted
 * internal callers, then returns an AI response plus provenance metadata.
 * @footnote-scope: interface
 * @footnote-module: ChatHandler
 * @footnote-risk: high - Failures block AI responses and provenance capture.
 * @footnote-ethics: high - Incorrect metadata harms transparency and user trust.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GenerationRuntime } from '@footnote/agent-runtime';
import type { ResponseMetadata } from '@footnote/contracts/policy';
import { SimpleRateLimiter } from '../services/rateLimiter.js';
import type {
    ResponseMetadataGenerationInput,
    ResponseMetadataRuntimeContext,
} from '../services/responseMetadata.js';
import type { CreateChatServiceOptions } from '../services/chatService.js';
import type { PostChatRequest } from '@footnote/contracts/web';
import { runtimeConfig } from '../config.js';
import { createChatOrchestrator } from '../services/chatOrchestrator.js';
import type { RealtimeWorkflowRunner } from '../services/realtimeConversationState.js';
import { ConversationContextAssemblyError } from '../services/conversationContextService.js';
import type { IncidentAlertRouter } from '../services/incidentAlerts.js';
import type { WeatherForecastTool } from '../services/contextIntegrations/weather/index.js';
import type { InternalImageDescriptionTaskService } from '../services/internalText.js';
import { logger } from '../utils/logger.js';
import {
    type ChatAuthContext,
    resolveChatAuth,
    verifyTurnstileCaptcha,
} from './chatAuth.js';
import { getRequestIdentity, parseChatRequest } from './chatRequest.js';
import { createChatRateLimitController } from './chatRateLimit.js';
import { buildProviderUnavailableError, sendJson } from './chatResponses.js';
import type {
    AccountAuthService,
    DiscordAccountConnectionService,
} from '../services/accountAuth.js';
import type { AccountStore } from '../storage/accounts/sqliteAccountStore.js';
import { readAccountSession } from './accountRequest.js';
import {
    resolveAdvisoryUserMemories,
    type AdvisoryUserMemoryContext,
} from '../services/accountMemoryContext.js';

type LogRequest = (
    req: IncomingMessage,
    res: ServerResponse,
    extra?: string
) => void;

type BuildResponseMetadata = (
    generationMetadata: ResponseMetadataGenerationInput,
    runtimeContext: ResponseMetadataRuntimeContext
) => ResponseMetadata;

type SuccessfulChatAuth = Extract<
    ReturnType<typeof resolveChatAuth>,
    { success: true }
>['data'];

type ChatHandlerDeps = {
    generationRuntime: GenerationRuntime | null;
    alertRouter?: IncidentAlertRouter;
    weatherForecastTool?: WeatherForecastTool;
    internalImageDescriptionTaskService?: InternalImageDescriptionTaskService | null;
    ipRateLimiter: SimpleRateLimiter | null;
    sessionRateLimiter: SimpleRateLimiter | null;
    serviceRateLimiter: SimpleRateLimiter | null;
    storeTrace: CreateChatServiceOptions['storeTrace'];
    logRequest: LogRequest;
    buildResponseMetadata: BuildResponseMetadata;
    maxChatBodyBytes: number;
    executionContractTrustGraph?: CreateChatServiceOptions['executionContractTrustGraph'];
    accountAuthService?:
        | (AccountAuthService &
              Pick<
                  DiscordAccountConnectionService,
                  'findAccountByDiscordUserId'
              >)
        | null;
    accountStore?: AccountStore | null;
};

export type ChatRequestHandler = {
    (req: IncomingMessage, res: ServerResponse): Promise<void>;
    runRealtimeConversation:
        RealtimeWorkflowRunner['runRealtimeConversation'] | null;
};

// The handler keeps transport concerns here and pushes business logic into helpers/services.
// That split is what lets future callers reuse the chat workflow without copying HTTP code.

/**
 * Applies credentialed CORS headers only for explicitly allowed browser origins.
 * Trusted service callers do not rely on CORS, but browsers do.
 */
const setCorsHeaders = (res: ServerResponse, req: IncomingMessage): void => {
    const allowedOrigins = runtimeConfig.cors.allowedOrigins;
    const origin = req.headers.origin;

    const sanitizedAllowedOrigins = Array.isArray(allowedOrigins)
        ? allowedOrigins.filter(
              (allowedOrigin) =>
                  typeof allowedOrigin === 'string' &&
                  allowedOrigin !== '*' &&
                  allowedOrigin.toLowerCase() !== 'null' &&
                  allowedOrigin.trim() !== ''
          )
        : [];

    const normalizedAllowedOrigins = sanitizedAllowedOrigins.map(
        (allowedOrigin) => allowedOrigin.trim().toLowerCase()
    );
    const normalizedOrigin =
        typeof origin === 'string' ? origin.trim().toLowerCase() : null;
    const allowedIndex =
        normalizedOrigin && normalizedOrigin !== 'null'
            ? normalizedAllowedOrigins.indexOf(normalizedOrigin)
            : -1;

    if (allowedIndex === -1 || !origin) {
        return;
    }

    const safeOrigin = sanitizedAllowedOrigins[allowedIndex];
    res.setHeader('Access-Control-Allow-Origin', safeOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, X-Turnstile-Token, X-Session-Id, X-Trace-Token, X-Service-Token, X-Agent-Token'
    );
    res.setHeader('Access-Control-Allow-Credentials', 'true');
};

/**
 * Logs the auth outcome that was actually used for this request.
 * We keep this separate from the auth helper so the route owns request logging.
 */
const logSuccessfulAuthStep = (
    req: IncomingMessage,
    res: ServerResponse,
    logRequest: LogRequest,
    authContext: ChatAuthContext
): void => {
    if (authContext.skipCaptcha && authContext.skipReason) {
        logger.info(
            `Skipping CAPTCHA verification (${authContext.skipReason})`
        );
        logRequest(req, res, `chat captcha-skipped-${authContext.skipReason}`);
        return;
    }

    logRequest(
        req,
        res,
        `chat captcha-verified source=${authContext.tokenSource}`
    );
};

/**
 * Thin HTTP adapter for the shared chat workflow.
 * High-level flow:
 * 1. CORS + method guard
 * 2. Request parsing
 * 3. Auth / CAPTCHA
 * 4. Rate limiting
 * 5. Shared chat workflow
 */
const createChatHandler = ({
    generationRuntime,
    alertRouter,
    weatherForecastTool,
    internalImageDescriptionTaskService,
    ipRateLimiter,
    sessionRateLimiter,
    serviceRateLimiter,
    storeTrace,
    logRequest,
    buildResponseMetadata,
    maxChatBodyBytes,
    executionContractTrustGraph,
    accountAuthService = null,
    accountStore = null,
}: ChatHandlerDeps): ChatRequestHandler => {
    const chatOrchestrator = generationRuntime
        ? createChatOrchestrator({
              generationRuntime,
              weatherForecastTool,
              internalImageDescriptionTaskService:
                  internalImageDescriptionTaskService ?? undefined,
              alertRouter,
              storeTrace,
              buildResponseMetadata,
              defaultModel: runtimeConfig.modelProfiles.defaultProfileId,
              executionContractTrustGraph,
          })
        : null;

    // If the generation runtime is unavailable, we keep the handler alive and return 503 later instead of failing startup.
    // The controller keeps public and trusted-service limiter buckets separate.
    const rateLimitController = createChatRateLimitController({
        ipRateLimiter,
        sessionRateLimiter,
        serviceRateLimiter,
    });

    const handleRequestMethod = (
        req: IncomingMessage,
        res: ServerResponse
    ): boolean => {
        // Apply CORS before any early return so browser failures retain the allowed origin.
        setCorsHeaders(res, req);
        if (req.method === 'OPTIONS') {
            // Only answer preflight when the browser supplied the required fields.
            const hasOrigin =
                typeof req.headers.origin === 'string' &&
                req.headers.origin.trim().length > 0;
            const requestedMethod =
                req.headers['access-control-request-method'];
            const hasRequestedMethod =
                typeof requestedMethod === 'string' &&
                requestedMethod.trim().length > 0;
            if (!hasOrigin || !hasRequestedMethod) {
                sendJson(res, 400, { error: 'Invalid CORS preflight' });
                logRequest(req, res, 'chat preflight-invalid');
                return false;
            }
            res.statusCode = 204;
            res.end();
            logRequest(req, res, 'chat options-preflight');
            return false;
        }
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed' });
            logRequest(req, res, 'chat method-not-allowed');
            return false;
        }
        return true;
    };

    const authenticateRequest = async (
        req: IncomingMessage,
        res: ServerResponse,
        identity: ReturnType<typeof getRequestIdentity>
    ): Promise<SuccessfulChatAuth | null> => {
        const authResult = resolveChatAuth(req);
        if (!authResult.success) {
            sendJson(
                res,
                authResult.error.statusCode,
                authResult.error.payload,
                authResult.error.extraHeaders
            );
            logRequest(req, res, authResult.error.logLabel);
            return null;
        }

        // Trusted services and public callers use separate rate-limit buckets.
        const rateLimitResult = rateLimitController.checkRateLimit(
            authResult.data.serviceAuth,
            identity
        );
        if (!rateLimitResult.success) {
            sendJson(
                res,
                rateLimitResult.error.statusCode,
                rateLimitResult.error.payload,
                rateLimitResult.error.extraHeaders
            );
            logRequest(req, res, rateLimitResult.error.logLabel);
            return null;
        }

        if (!authResult.data.skipCaptcha) {
            // Trusted services skip CAPTCHA; public callers must satisfy Turnstile.
            logger.debug(
                `Turnstile token extraction: source=${authResult.data.tokenSource}, length=${authResult.data.turnstileToken?.length || 0}`
            );
            const captchaResult = await verifyTurnstileCaptcha({
                clientIp: identity.clientIp,
                requestHost:
                    typeof req.headers.host === 'string'
                        ? req.headers.host
                        : undefined,
                requestOrigin:
                    typeof req.headers.origin === 'string'
                        ? req.headers.origin
                        : undefined,
                turnstileToken: authResult.data.turnstileToken,
                tokenSource: authResult.data.tokenSource,
            });
            if (!captchaResult.success) {
                sendJson(
                    res,
                    captchaResult.error.statusCode,
                    captchaResult.error.payload,
                    captchaResult.error.extraHeaders
                );
                logRequest(req, res, captchaResult.error.logLabel);
                return null;
            }
        }

        logSuccessfulAuthStep(req, res, logRequest, authResult.data);
        return authResult.data;
    };

    const resolveMemoryContext = (
        req: IncomingMessage,
        chatRequest: PostChatRequest,
        authContext: SuccessfulChatAuth
    ): AdvisoryUserMemoryContext => {
        let memoryContext: AdvisoryUserMemoryContext;
        try {
            memoryContext = resolveAdvisoryUserMemories({
                surface: chatRequest.surface,
                session:
                    chatRequest.surface === 'web' && accountAuthService !== null
                        ? readAccountSession(req, accountAuthService)
                        : null,
                trustedDiscordUserId:
                    chatRequest.surface === 'discord' &&
                    authContext.serviceAuth.isTrustedService
                        ? chatRequest.surfaceContext?.userId
                        : undefined,
                accountAuthService,
                accountStore,
            });
        } catch {
            // User memory is advisory and cannot block ordinary chat.
            memoryContext = { memories: [], status: 'failed' };
        }
        if (memoryContext.status === 'unavailable') {
            logger.warn('Chat user memory retrieval unavailable.');
        } else if (memoryContext.status === 'failed') {
            logger.error('Chat user memory resolution failed.');
        } else if (memoryContext.status === 'corrupt') {
            logger.warn('Chat user memory retrieval skipped corrupt records.');
        }
        return memoryContext;
    };

    const handleGenerationError = (
        generationError: unknown,
        req: IncomingMessage,
        res: ServerResponse
    ): void => {
        const errorMessage =
            generationError instanceof Error
                ? generationError.message
                : String(generationError);
        if (generationError instanceof ConversationContextAssemblyError) {
            sendJson(res, 400, {
                error: 'Invalid conversation context',
                details: generationError.reasonCode,
            });
            logRequest(
                req,
                res,
                `chat context-assembly-error ${generationError.reasonCode}`
            );
            return;
        }
        sendJson(res, 502, { error: 'AI generation failed' });
        logRequest(req, res, `chat generation-error ${errorMessage}`);
    };

    /**
     * @api.operationId: postChat
     * @api.path: POST /api/chat
     * @api.operationId: optionsChat
     * @api.path: OPTIONS /api/chat
     */
    const handleChatRequest = async (
        req: IncomingMessage,
        res: ServerResponse
    ): Promise<void> => {
        const requestAbortController = new AbortController();
        if (req.aborted) {
            requestAbortController.abort();
        } else {
            req.once('aborted', () => requestAbortController.abort());
        }
        res.once('close', () => {
            if (!res.writableFinished) {
                requestAbortController.abort();
            }
        });
        try {
            requestAbortController.signal.throwIfAborted();
            if (!handleRequestMethod(req, res)) return;

            // Parse and validate the body before we do any expensive auth or model work.
            const parsedRequestResult = await parseChatRequest(
                req,
                maxChatBodyBytes
            );
            if (!parsedRequestResult.success) {
                if (
                    parsedRequestResult.error.logLabel === 'chat invalid-json'
                ) {
                    logger.warn('Chat handler received invalid JSON body.');
                }

                sendJson(
                    res,
                    parsedRequestResult.error.statusCode,
                    parsedRequestResult.error.payload,
                    parsedRequestResult.error.extraHeaders
                );
                logRequest(req, res, parsedRequestResult.error.logLabel);
                return;
            }

            // Identity is only for abuse controls. It does not grant access by itself.
            const identity = getRequestIdentity(
                req,
                runtimeConfig.server.trustProxy
            );

            const authContext = await authenticateRequest(req, res, identity);
            if (!authContext) return;

            if (!chatOrchestrator) {
                sendJson(
                    res,
                    503,
                    buildProviderUnavailableError(
                        'Generation provider unavailable'
                    )
                );
                logRequest(req, res, 'chat service-unavailable');
                return;
            }

            // Only authenticated service adapters may supply identity facts for
            // the formatting boundary. They never select persona or policy.
            const chatRequest: PostChatRequest =
                parsedRequestResult.data.surface === 'discord' &&
                authContext.serviceAuth.isTrustedService
                    ? parsedRequestResult.data
                    : {
                          ...parsedRequestResult.data,
                          assistantIdentity: undefined,
                      };

            const memoryContext = resolveMemoryContext(
                req,
                chatRequest,
                authContext
            );

            // From here on, the request is fully normalized and can delegate to the shared workflow.
            const chatResponse = await chatOrchestrator.runChat(chatRequest, {
                advisoryUserMemories: memoryContext.memories,
                signal: requestAbortController.signal,
            });
            // A disconnected client suppresses delivery; work that could not stop keeps its observed outcome.
            requestAbortController.signal.throwIfAborted();
            if (res.destroyed || requestAbortController.signal.aborted) {
                return;
            }
            sendJson(res, 200, chatResponse);
            logRequest(
                req,
                res,
                `chat success surface=${parsedRequestResult.data.surface} latestUserInputLength=${parsedRequestResult.data.latestUserInput.length}`
            );
        } catch (generationError) {
            if (res.destroyed || requestAbortController.signal.aborted) {
                return;
            }
            handleGenerationError(generationError, req, res);
        }
    };

    return Object.assign(handleChatRequest, {
        runRealtimeConversation:
            chatOrchestrator?.runRealtimeConversation ?? null,
    }) as ChatRequestHandler;
};

export { createChatHandler };
