/**
 * @description: Provides authenticated one-time TrustGraph setup over the prepared repository-context bundle.
 * Destinations and credentials come only from backend runtime configuration.
 * @footnote-scope: interface
 * @footnote-module: SetupRepositoryContextHandler
 * @footnote-risk: high - Incorrect setup authorization or bundle reads could expose repository files or TrustGraph credentials.
 * @footnote-ethics: high - Operators must control which project context is loaded and keep credentials private.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
    createRepositoryContextPreview,
    DEFAULT_REPOSITORY_CONTEXT_LIMITS,
    DEFAULT_TRUSTGRAPH_REQUEST_TIMEOUT_MS,
    loadRepositoryContext,
    normalizeRepositoryRelativePath,
    TrustGraphLibrarianClient,
    type RepositoryContextFile,
    type RepositoryContextFileReadResult,
    type RepositoryContextFileSource,
    type RepositoryContextLimits,
} from '@footnote/repository-context';
import {
    PostSetupRepositoryContextConnectionTestRequestSchema,
    PostSetupRepositoryContextLoadRequestSchema,
    type GetSetupRepositoryContextConnectionStateResponse,
    type GetSetupRepositoryContextPreviewResponse,
    type PostSetupRepositoryContextLoadResponse,
} from '@footnote/contracts/web';
import type { RuntimeConfig } from '../config/types.js';
import {
    readSetupSessionIdFromRequest,
    type SetupBootstrapService,
} from '../services/setupBootstrap.js';
import type { TrustGraphTargetConfig } from '../services/executionContractTrustGraph/trustGraphEvidenceTypes.js';
import { sendJson } from './chatResponses.js';

type LogRequest = (
    req: IncomingMessage,
    res: ServerResponse,
    extra?: string
) => void;

type SetupRepositoryContextLogger = {
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
};

type CreateSetupRepositoryContextHandlersDeps = {
    setupBootstrapService: SetupBootstrapService;
    trustGraphConfig: Pick<
        RuntimeConfig['executionContractTrustGraph'],
        'enabled' | 'killSwitchExternalRetrieval'
    > & {
        adapter: Pick<
            RuntimeConfig['executionContractTrustGraph']['adapter'],
            'mode' | 'baseUrl' | 'apiToken' | 'workspaceRef' | 'targets'
        >;
    };
    bundleRoot: string;
    logger: SetupRepositoryContextLogger;
    logRequest: LogRequest;
};

type RequestHandler = (
    req: IncomingMessage,
    res: ServerResponse
) => Promise<void>;

export type SetupRepositoryContextHandlers = {
    handleSetupRepositoryContextConnectionStateRequest: RequestHandler;
    handleSetupRepositoryContextConnectionTestRequest: RequestHandler;
    handleSetupRepositoryContextPreviewRequest: RequestHandler;
    handleSetupRepositoryContextLoadRequest: RequestHandler;
    clearSetupSession: (sessionId: string) => void;
};

const SETUP_CSRF_HEADER_NAME = 'x-setup-csrf';
const MAX_REQUEST_BODY_BYTES = 4_096;
const REPOSITORY_ID = 'https://github.com/footnote-ai/footnote';
const SAFE_CONNECTION_FAILURE = 'TrustGraph connection test failed';

type ApprovedTarget = {
    config: TrustGraphTargetConfig;
    workspace: string;
};

type ContextManifest = {
    revision: string;
    paths: string[];
};

type TestedConnection = {
    targetId: string;
    testedAt: string;
    expiresAtMs: number;
};

class RequestBodyTooLargeError extends Error {
    constructor() {
        super('Request payload too large');
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isMissingFile = (error: unknown): boolean =>
    isRecord(error) && error.code === 'ENOENT';

const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
    const contentLength = Number(req.headers['content-length'] ?? Number.NaN);
    if (
        Number.isFinite(contentLength) &&
        contentLength > MAX_REQUEST_BODY_BYTES
    ) {
        throw new RequestBodyTooLargeError();
    }
    const chunks: Buffer[] = [];
    let byteLength = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteLength += buffer.byteLength;
        if (byteLength > MAX_REQUEST_BODY_BYTES) {
            throw new RequestBodyTooLargeError();
        }
        chunks.push(buffer);
    }
    try {
        return JSON.parse(
            Buffer.concat(chunks, byteLength).toString('utf8')
        ) as unknown;
    } catch {
        return undefined;
    }
};

/** Creates the setup API for the fixed, deployment-prepared bundle. */
export const createSetupRepositoryContextHandlers = ({
    setupBootstrapService,
    trustGraphConfig,
    bundleRoot,
    logger,
    logRequest,
}: CreateSetupRepositoryContextHandlersDeps): SetupRepositoryContextHandlers => {
    const testedConnections = new Map<string, TestedConnection>();
    const configuredTargets =
        trustGraphConfig.enabled &&
        !trustGraphConfig.killSwitchExternalRetrieval &&
        trustGraphConfig.adapter.mode === 'http' &&
        trustGraphConfig.adapter.baseUrl &&
        trustGraphConfig.adapter.apiToken
            ? trustGraphConfig.adapter.targets.map(
                  (target): ApprovedTarget => ({
                      config: target,
                      workspace:
                          target.workspaceRef ??
                          trustGraphConfig.adapter.workspaceRef ??
                          'default',
                  })
              )
            : [];
    const targetById = new Map(
        configuredTargets.map((target) => [target.config.id, target])
    );
    let manifestPromise: Promise<ContextManifest> | undefined;

    const readManifest = (): Promise<ContextManifest> => {
        manifestPromise ??= (async () => {
            const revision = (
                await fs.readFile(path.join(bundleRoot, 'revision.txt'), 'utf8')
            ).trim();
            if (!/^[a-f0-9]{7,64}$/u.test(revision)) {
                throw new Error('Prepared context revision is invalid.');
            }
            const parsed = JSON.parse(
                await fs.readFile(
                    path.join(bundleRoot, 'context-manifest.json'),
                    'utf8'
                )
            ) as unknown;
            if (!Array.isArray(parsed) || parsed.length === 0) {
                throw new Error('Prepared context manifest is empty.');
            }
            const paths = new Set<string>();
            for (const candidate of parsed) {
                if (
                    !isRecord(candidate) ||
                    typeof candidate.path !== 'string'
                ) {
                    throw new Error('Prepared context manifest is invalid.');
                }
                const normalized = normalizeRepositoryRelativePath(
                    candidate.path
                );
                if (
                    normalized === undefined ||
                    normalized !== candidate.path.replaceAll('\\', '/') ||
                    paths.has(normalized)
                ) {
                    throw new Error('Prepared context manifest is invalid.');
                }
                paths.add(normalized);
            }
            return { revision, paths: [...paths] };
        })();
        return manifestPromise;
    };

    const resolveBundleFile = async (filePath: string): Promise<string> => {
        const normalized = normalizeRepositoryRelativePath(filePath);
        const manifest = await readManifest();
        if (normalized === undefined || !manifest.paths.includes(normalized)) {
            throw new Error('File is not in the approved context bundle.');
        }
        const bundleRealPath = await fs.realpath(bundleRoot);
        const candidateRealPath = await fs.realpath(
            path.resolve(bundleRealPath, ...normalized.split('/'))
        );
        const relative = path.relative(bundleRealPath, candidateRealPath);
        if (
            relative.length === 0 ||
            relative === '..' ||
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative)
        ) {
            throw new Error('File is outside the approved context bundle.');
        }
        return candidateRealPath;
    };

    const fileSource: RepositoryContextFileSource = {
        preview: async (limits: RepositoryContextLimits) => {
            const manifest = await readManifest();
            const files: RepositoryContextFile[] = [];
            const skipped: { path: string; reason: string }[] = [];
            for (const filePath of manifest.paths) {
                try {
                    const absolutePath = await resolveBundleFile(filePath);
                    const stat = await fs.stat(absolutePath);
                    if (!stat.isFile()) {
                        skipped.push({
                            path: filePath,
                            reason: 'not a regular file',
                        });
                    } else {
                        files.push({ path: filePath, sizeBytes: stat.size });
                    }
                } catch (error) {
                    skipped.push({
                        path: filePath,
                        reason: isMissingFile(error)
                            ? 'missing from prepared bundle'
                            : 'could not read prepared file',
                    });
                }
            }
            return createRepositoryContextPreview({ files, skipped, limits });
        },
        readFile: async (
            filePath: string,
            maxFileBytes: number
        ): Promise<RepositoryContextFileReadResult> => {
            try {
                const absolutePath = await resolveBundleFile(filePath);
                const stat = await fs.stat(absolutePath);
                if (!stat.isFile()) {
                    return { status: 'skipped', reason: 'not a regular file' };
                }
                if (stat.size > maxFileBytes) {
                    return {
                        status: 'skipped',
                        reason: `larger than ${maxFileBytes} bytes`,
                        sizeBytes: stat.size,
                    };
                }
                const bytes = await fs.readFile(absolutePath);
                if (bytes.byteLength > maxFileBytes) {
                    return {
                        status: 'skipped',
                        reason: `larger than ${maxFileBytes} bytes`,
                        sizeBytes: bytes.byteLength,
                    };
                }
                return { status: 'readable', bytes };
            } catch (error) {
                return {
                    status: 'failed',
                    reason: isMissingFile(error)
                        ? 'missing from prepared bundle'
                        : 'could not read prepared file',
                };
            }
        },
    };

    const authorize = async (
        req: IncomingMessage,
        res: ServerResponse,
        requireCsrf: boolean,
        routeLabel: string
    ): Promise<{ sessionId: string; expiresAtMs: number } | undefined> => {
        const sessionId = readSetupSessionIdFromRequest(req);
        const session = sessionId
            ? await setupBootstrapService.validateSetupSession(sessionId)
            : null;
        if (!sessionId || !session) {
            sendJson(res, 401, { error: 'Missing or invalid setup session' });
            logRequest(req, res, `${routeLabel} unauthorized`);
            return undefined;
        }
        if (
            requireCsrf &&
            (typeof req.headers[SETUP_CSRF_HEADER_NAME] !== 'string' ||
                req.headers[SETUP_CSRF_HEADER_NAME] !== session.csrfToken)
        ) {
            sendJson(res, 403, {
                error: 'Missing or invalid setup CSRF token',
            });
            logRequest(req, res, `${routeLabel} invalid-setup-csrf`);
            return undefined;
        }
        const expiresAtMs = Date.parse(session.expiresAt);
        const tested = testedConnections.get(sessionId);
        if (
            tested &&
            (!Number.isFinite(expiresAtMs) || tested.expiresAtMs <= Date.now())
        ) {
            testedConnections.delete(sessionId);
        }
        return { sessionId, expiresAtMs };
    };

    const connectionState =
        (): GetSetupRepositoryContextConnectionStateResponse => ({
            configured: configuredTargets.length > 0,
            targets: configuredTargets.map(({ config, workspace }) => ({
                id: config.id,
                flow: config.flow,
                collection: config.collection,
                workspace,
            })),
        });

    /** @api.operationId: getSetupRepositoryContextConnectionState @api.path: GET /api/setup/repository-context/connection */
    const handleSetupRepositoryContextConnectionStateRequest: RequestHandler =
        async (req, res) => {
            const auth = await authorize(
                req,
                res,
                false,
                'setup.repository-context.connection.state'
            );
            if (!auth) return;
            if (req.method !== 'GET') {
                sendJson(res, 405, { error: 'Method not allowed' });
                logRequest(
                    req,
                    res,
                    'setup.repository-context.connection.state method-not-allowed'
                );
                return;
            }
            sendJson(res, 200, connectionState());
            logRequest(
                req,
                res,
                'setup.repository-context.connection.state ok'
            );
        };

    /** @api.operationId: postSetupRepositoryContextConnectionTest @api.path: POST /api/setup/repository-context/connection/test */
    const handleSetupRepositoryContextConnectionTestRequest: RequestHandler =
        async (req, res) => {
            const auth = await authorize(
                req,
                res,
                true,
                'setup.repository-context.connection.test'
            );
            if (!auth) return;
            if (req.method !== 'POST') {
                sendJson(res, 405, { error: 'Method not allowed' });
                logRequest(
                    req,
                    res,
                    'setup.repository-context.connection.test method-not-allowed'
                );
                return;
            }
            try {
                const body = await readJsonBody(req);
                const parsed =
                    PostSetupRepositoryContextConnectionTestRequestSchema.safeParse(
                        body
                    );
                if (!parsed.success) {
                    sendJson(res, 400, { error: 'Invalid connection target' });
                    logRequest(
                        req,
                        res,
                        'setup.repository-context.connection.test invalid-payload'
                    );
                    return;
                }
                const target = targetById.get(parsed.data.targetId);
                const baseUrl = trustGraphConfig.adapter.baseUrl;
                const apiToken = trustGraphConfig.adapter.apiToken;
                if (!target || !baseUrl || !apiToken) {
                    sendJson(res, 409, {
                        error: 'No configured TrustGraph connection is available',
                    });
                    logRequest(
                        req,
                        res,
                        'setup.repository-context.connection.test not-configured'
                    );
                    return;
                }
                await new TrustGraphLibrarianClient({
                    baseUrl,
                    workspace: target.workspace,
                    apiToken,
                    requestTimeoutMs: DEFAULT_TRUSTGRAPH_REQUEST_TIMEOUT_MS,
                }).listDocuments();
                const testedAt = new Date().toISOString();
                testedConnections.set(auth.sessionId, {
                    targetId: target.config.id,
                    testedAt,
                    expiresAtMs: auth.expiresAtMs,
                });
                sendJson(res, 200, {
                    connected: true,
                    targetId: target.config.id,
                    testedAt,
                });
                logger.info(
                    'setup.repository_context.connection_test.succeeded',
                    {
                        targetId: target.config.id,
                    }
                );
                logRequest(
                    req,
                    res,
                    'setup.repository-context.connection.test ok'
                );
            } catch (error) {
                logger.warn('setup.repository_context.connection_test.failed', {
                    code:
                        error instanceof RequestBodyTooLargeError
                            ? 'payload_too_large'
                            : 'trustgraph_unavailable',
                });
                sendJson(
                    res,
                    error instanceof RequestBodyTooLargeError ? 413 : 502,
                    {
                        error:
                            error instanceof RequestBodyTooLargeError
                                ? 'Invalid connection target'
                                : SAFE_CONNECTION_FAILURE,
                    }
                );
                logRequest(
                    req,
                    res,
                    'setup.repository-context.connection.test failed'
                );
            }
        };

    /** @api.operationId: getSetupRepositoryContextPreview @api.path: GET /api/setup/repository-context/preview */
    const handleSetupRepositoryContextPreviewRequest: RequestHandler = async (
        req,
        res
    ) => {
        const auth = await authorize(
            req,
            res,
            false,
            'setup.repository-context.preview'
        );
        if (!auth) return;
        if (req.method !== 'GET') {
            sendJson(res, 405, { error: 'Method not allowed' });
            logRequest(
                req,
                res,
                'setup.repository-context.preview method-not-allowed'
            );
            return;
        }
        try {
            const manifest = await readManifest();
            const preview = await fileSource.preview(
                DEFAULT_REPOSITORY_CONTEXT_LIMITS
            );
            const response: GetSetupRepositoryContextPreviewResponse = {
                revision: manifest.revision,
                fileCount: preview.files.length,
                totalBytes: preview.totalBytes,
                files: preview.files,
                skipped: preview.skipped,
            };
            sendJson(res, 200, response);
            logRequest(req, res, 'setup.repository-context.preview ok');
        } catch {
            logger.warn('setup.repository_context.preview.failed', {
                code: 'approved_bundle_unavailable',
            });
            sendJson(res, 503, {
                error: 'Approved repository context bundle unavailable',
            });
            logRequest(
                req,
                res,
                'setup.repository-context.preview unavailable'
            );
        }
    };

    /** @api.operationId: postSetupRepositoryContextLoad @api.path: POST /api/setup/repository-context/load */
    const handleSetupRepositoryContextLoadRequest: RequestHandler = async (
        req,
        res
    ) => {
        const auth = await authorize(
            req,
            res,
            true,
            'setup.repository-context.load'
        );
        if (!auth) return;
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed' });
            logRequest(
                req,
                res,
                'setup.repository-context.load method-not-allowed'
            );
            return;
        }
        try {
            const parsed =
                PostSetupRepositoryContextLoadRequestSchema.safeParse(
                    await readJsonBody(req)
                );
            if (!parsed.success) {
                sendJson(res, 400, { error: 'Invalid load request' });
                logRequest(
                    req,
                    res,
                    'setup.repository-context.load invalid-payload'
                );
                return;
            }
            const tested = testedConnections.get(auth.sessionId);
            if (tested?.targetId !== parsed.data.targetId) {
                sendJson(res, 409, {
                    error: 'Test this TrustGraph target before loading context',
                });
                logRequest(
                    req,
                    res,
                    'setup.repository-context.load connection-not-tested'
                );
                return;
            }
            const target = targetById.get(parsed.data.targetId);
            const baseUrl = trustGraphConfig.adapter.baseUrl;
            const apiToken = trustGraphConfig.adapter.apiToken;
            if (!target || !baseUrl || !apiToken) {
                sendJson(res, 503, {
                    error: 'No configured TrustGraph connection is available',
                });
                logRequest(
                    req,
                    res,
                    'setup.repository-context.load not-configured'
                );
                return;
            }
            const result = await loadRepositoryContext({
                fileSource,
                trustGraphBaseUrl: baseUrl,
                apiToken,
                workspace: target.workspace,
                flowId: target.config.flow,
                collection: target.config.collection,
                repositoryId: REPOSITORY_ID,
                requestTimeoutMs: DEFAULT_TRUSTGRAPH_REQUEST_TIMEOUT_MS,
            });
            const response: PostSetupRepositoryContextLoadResponse = {
                repositoryId: result.repositoryId,
                startedAt: result.startedAt,
                completedAt: result.completedAt,
                selectedFileCount: result.selectedFileCount,
                selectedBytes: result.selectedBytes,
                counts: result.counts,
                items: result.items.map(
                    ({ path: filePath, status, sizeBytes }) => ({
                        path: filePath,
                        status,
                        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
                    })
                ),
            };
            sendJson(res, 200, response);
            logger.info('setup.repository_context.load.completed', {
                targetId: target.config.id,
                added: result.counts.added,
                changed: result.counts.changed,
                unchanged: result.counts.unchanged,
                skipped: result.counts.skipped,
                failed: result.counts.failed,
            });
            logRequest(req, res, 'setup.repository-context.load ok');
        } catch (error) {
            logger.warn('setup.repository_context.load.failed', {
                code:
                    error instanceof RequestBodyTooLargeError
                        ? 'payload_too_large'
                        : 'repository_context_load_failed',
            });
            sendJson(
                res,
                error instanceof RequestBodyTooLargeError ? 413 : 502,
                {
                    error:
                        error instanceof RequestBodyTooLargeError
                            ? 'Invalid load request'
                            : 'Repository context load failed',
                }
            );
            logRequest(req, res, 'setup.repository-context.load failed');
        }
    };

    return {
        handleSetupRepositoryContextConnectionStateRequest,
        handleSetupRepositoryContextConnectionTestRequest,
        handleSetupRepositoryContextPreviewRequest,
        handleSetupRepositoryContextLoadRequest,
        clearSetupSession: (sessionId) => {
            testedConnections.delete(sessionId);
        },
    };
};
