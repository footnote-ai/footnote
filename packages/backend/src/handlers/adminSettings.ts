/**
 * @description: Trusted admin settings handlers for schema discovery and canonical footnote.yaml read/validate/write.
 * @footnote-scope: interface
 * @footnote-module: AdminSettingsHandler
 * @footnote-risk: high - Mistakes can expose privileged config writes or break runtime settings integrity.
 * @footnote-ethics: high - Admin settings writes affect system governance and must remain auditable and explicit.
 */

import fs from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { renderSettingsTemplateYaml } from '@footnote/config-spec';
import type { SettingsSpecEntry } from '../config/settings-spec.js';
import {
    parseServerSettingsYaml,
    ServerSettingsValidationError,
} from '../config/settings.js';
import { sendJson } from './chatResponses.js';
import {
    readSetupSessionIdFromRequest,
    SETUP_MISSING_IF_MATCH_ETAG,
    type SetupBootstrapService,
} from '../services/setupBootstrap.js';

type LogRequest = (
    req: IncomingMessage,
    res: ServerResponse,
    extra?: string
) => void;

type AdminSettingsLogger = {
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
};

type AdminSettingsValidationErrorDetail = {
    message: string;
    pointer: string | null;
    category: string;
};

type CreateAdminSettingsHandlersDeps = {
    adminToken: string | null;
    maxBodyBytes: number;
    settingsPath: string;
    settingsSpecEntries: readonly SettingsSpecEntry[];
    setupBootstrapService: SetupBootstrapService;
    logger: AdminSettingsLogger;
    logRequest: LogRequest;
};

type RequestHandler = (
    req: IncomingMessage,
    res: ServerResponse
) => Promise<void>;

type AdminSettingsHandlers = {
    handleAdminSettingsSchemaRequest: RequestHandler;
    handleAdminSettingsTemplateRequest: RequestHandler;
    handleAdminSettingsYamlRequest: RequestHandler;
    handleAdminSettingsValidateRequest: RequestHandler;
    handleAdminSettingsYamlPutRequest: RequestHandler;
};

type AdminAuthContext = {
    actorSource: 'x-admin-token' | 'setup-session';
};

class RequestBodyTooLargeError extends Error {
    constructor() {
        super('Request payload too large');
        this.name = 'RequestBodyTooLargeError';
    }
}

const readHeaderValue = (
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
    readHeaderValue(req.headers['x-request-id']);

const readRawBody = async (
    req: IncomingMessage,
    maxBodyBytes: number
): Promise<string> => {
    const contentLengthHeader = req.headers['content-length'];
    if (contentLengthHeader) {
        const contentLength = Number(contentLengthHeader);
        if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
            throw new RequestBodyTooLargeError();
        }
    }

    const chunks: Buffer[] = [];
    let bodyBytes = 0;
    for await (const chunk of req) {
        const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bodyBytes += chunkBuffer.length;
        if (bodyBytes > maxBodyBytes) {
            throw new RequestBodyTooLargeError();
        }
        chunks.push(chunkBuffer);
    }

    return Buffer.concat(chunks, bodyBytes).toString('utf8');
};

export const computeSettingsEtag = (yamlText: string): string => {
    const digest = createHash('sha256').update(yamlText, 'utf8').digest('hex');
    return `"${digest}"`;
};

export const writeSettingsFileAtomically = async (
    filePath: string,
    yamlText: string
): Promise<void> => {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
    let preservedMode: number | undefined;
    try {
        const currentStat = await fs.promises.stat(filePath);
        preservedMode = currentStat.mode & 0o777;
    } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code !== 'ENOENT') {
            throw error;
        }
    }

    await fs.promises.writeFile(tempPath, yamlText, {
        encoding: 'utf8',
        ...(preservedMode !== undefined ? { mode: preservedMode } : {}),
    });
    try {
        await fs.promises.rename(tempPath, filePath);
    } catch (error) {
        await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
};

const toValidationDetail = (
    error: ServerSettingsValidationError
): AdminSettingsValidationErrorDetail => ({
    message: error.message,
    pointer: error.pointer,
    category: error.category,
});

const validateYamlText = ({
    rawText,
    settingsPath,
}: {
    rawText: string;
    settingsPath: string;
}):
    | {
          ok: true;
          normalizedSummary: {
              version: number;
              settingsKeysCount: number;
              discordBotsCount: number;
          };
      }
    | {
          ok: false;
          detail: AdminSettingsValidationErrorDetail;
      } => {
    try {
        const { yamlSettings } = parseServerSettingsYaml({
            rawText,
            settingsPath,
        });
        return {
            ok: true,
            normalizedSummary: {
                version: yamlSettings.version,
                settingsKeysCount: Object.keys(yamlSettings.settingsEnv).length,
                discordBotsCount: yamlSettings['discord-bots'].length,
            },
        };
    } catch (error) {
        if (error instanceof ServerSettingsValidationError) {
            return {
                ok: false,
                detail: toValidationDetail(error),
            };
        }
        return {
            ok: false,
            detail: {
                message:
                    error instanceof Error ? error.message : 'Unknown error',
                pointer: null,
                category: 'yaml_parse_error',
            },
        };
    }
};

const buildSchemaFields = (entries: readonly SettingsSpecEntry[]) =>
    entries.map((entry) => ({
        envKey: entry.envKey,
        section: entry.section,
        path: entry.path,
        kind: entry.kind,
        description: entry.description,
        defaultValue: entry.defaultValue,
        allowedValues: entry.allowedValues,
    }));

/**
 * `createAdminSettingsHandlers` defines the trusted admin settings API auth boundary.
 *
 * Authentication contract:
 * - `authorize` first checks `x-admin-token` and requires exact match against
 *   configured `adminToken`.
 * - `x-admin-token` path:
 *   - `adminToken` unset + token provided => 503 (disabled).
 *   - token missing => flow can fall through to setup-session path when setup is required.
 *   - token present but invalid => 403.
 * - setup-session path is permitted only while `setupBootstrapService.isSetupRequiredNow()`
 *   is true, and requires a valid `footnote_setup_session` cookie.
 * - setup-session non-GET calls additionally require `x-setup-csrf` exact match
 *   against the issued session CSRF token; mismatch => 403.
 * - when setup is required and neither valid token nor valid setup-session auth
 *   is present, handlers return 401.
 * - when setup is not required and no token is provided:
 *   - unset `adminToken` => 503 (disabled)
 *   - set `adminToken` => 401 (missing token)
 *
 * Operational contract:
 * - `authorize` emits structured auth/disabled logs and request logging for each
 *   deny path before returning `null`.
 * - No fail-open auth path exists: both token and setup-session validation are
 *   fail-closed.
 * - Callers must provision and manage `adminToken` to enable this API surface.
 */
const createAdminSettingsHandlers = ({
    adminToken,
    maxBodyBytes,
    settingsPath,
    settingsSpecEntries,
    setupBootstrapService,
    logger,
    logRequest,
}: CreateAdminSettingsHandlersDeps): AdminSettingsHandlers => {
    const settingsWriteLocks = new Map<string, Promise<void>>();

    const withSettingsWriteLock = async <T>(
        lockKey: string,
        task: () => Promise<T>
    ): Promise<T> => {
        const prior = settingsWriteLocks.get(lockKey);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        settingsWriteLocks.set(
            lockKey,
            prior
                ? prior.then(
                      () => gate,
                      () => gate
                  )
                : gate
        );
        if (prior) {
            await prior.catch(() => undefined);
        }
        try {
            return await task();
        } finally {
            release();
            if (settingsWriteLocks.get(lockKey) === gate) {
                settingsWriteLocks.delete(lockKey);
            }
        }
    };

    const authorize = async (
        req: IncomingMessage,
        res: ServerResponse,
        routeLabel: string
    ): Promise<AdminAuthContext | null> => {
        const requestId = readRequestId(req);
        const providedToken = readHeaderValue(req.headers['x-admin-token']);
        if (providedToken) {
            if (!adminToken) {
                sendJson(res, 503, { error: 'Admin settings API disabled' });
                logger.warn('admin.settings.disabled', {
                    requestId,
                    routeLabel,
                    settingsPath,
                });
                logRequest(req, res, `${routeLabel} disabled`);
                return null;
            }
            if (providedToken !== adminToken) {
                sendJson(res, 403, { error: 'Invalid admin token' });
                logger.warn('admin.settings.auth.failed', {
                    requestId,
                    routeLabel,
                    actorSource: 'x-admin-token',
                    result: 'invalid',
                });
                logRequest(req, res, `${routeLabel} invalid-admin-token`);
                return null;
            }
            return { actorSource: 'x-admin-token' };
        }

        const setupRequiredNow =
            await setupBootstrapService.isSetupRequiredNow();
        if (setupRequiredNow) {
            const setupSessionId = readSetupSessionIdFromRequest(req);
            if (setupSessionId) {
                const setupSession =
                    await setupBootstrapService.validateSetupSession(
                        setupSessionId
                    );
                if (setupSession) {
                    if (req.method !== 'GET') {
                        const csrfHeader = readHeaderValue(
                            req.headers['x-setup-csrf']
                        );
                        if (
                            !csrfHeader ||
                            csrfHeader !== setupSession.csrfToken
                        ) {
                            sendJson(res, 403, {
                                error: 'Missing or invalid setup CSRF token',
                            });
                            logger.warn('admin.settings.auth.failed', {
                                requestId,
                                routeLabel,
                                actorSource: 'setup-session',
                                result: 'csrf_invalid',
                            });
                            logRequest(
                                req,
                                res,
                                `${routeLabel} invalid-setup-csrf`
                            );
                            return null;
                        }
                    }
                    return { actorSource: 'setup-session' };
                }
            }

            sendJson(res, 401, { error: 'Missing admin token' });
            logger.warn('admin.settings.auth.failed', {
                requestId,
                routeLabel,
                actorSource: 'setup-session',
                result: 'missing',
            });
            logRequest(req, res, `${routeLabel} missing-admin-auth`);
            return null;
        }

        if (!adminToken) {
            sendJson(res, 503, { error: 'Admin settings API disabled' });
            logger.warn('admin.settings.disabled', {
                requestId,
                routeLabel,
                settingsPath,
            });
            logRequest(req, res, `${routeLabel} disabled`);
            return null;
        }

        sendJson(res, 401, { error: 'Missing admin token' });
        logger.warn('admin.settings.auth.failed', {
            requestId,
            routeLabel,
            actorSource: 'x-admin-token',
            result: 'missing',
        });
        logRequest(req, res, `${routeLabel} missing-admin-token`);
        return null;
    };

    /**
     * @api.operationId: getAdminSettingsSchema
     * @api.path: GET /api/admin/settings/schema
     */
    const handleAdminSettingsSchemaRequest: RequestHandler = async (
        req,
        res
    ) => {
        const authContext = await authorize(req, res, 'admin.settings.schema');
        if (!authContext) {
            return;
        }
        if (req.method !== 'GET') {
            sendJson(res, 405, { error: 'Method not allowed' });
            logRequest(req, res, 'admin.settings.schema method-not-allowed');
            return;
        }

        sendJson(res, 200, {
            ok: true,
            schemaVersion: 1,
            settingsDocumentVersion: 1,
            fields: buildSchemaFields(settingsSpecEntries),
        });
        logRequest(req, res, 'admin.settings.schema ok');
    };

    /**
     * @api.operationId: getAdminSettingsTemplate
     * @api.path: GET /api/admin/settings/template
     */
    const handleAdminSettingsTemplateRequest: RequestHandler = async (
        req,
        res
    ) => {
        const authContext = await authorize(
            req,
            res,
            'admin.settings.template'
        );
        if (!authContext) {
            return;
        }
        if (req.method !== 'GET') {
            sendJson(res, 405, { error: 'Method not allowed' });
            logRequest(req, res, 'admin.settings.template method-not-allowed');
            return;
        }

        const requestId = readRequestId(req);
        try {
            const yamlText = renderSettingsTemplateYaml({
                target: 'auto',
                env: process.env,
                lineEnding: '\n',
            });
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(yamlText);
            logger.info('admin.settings.template.succeeded', {
                requestId,
                actorSource: authContext.actorSource,
                settingsPath,
            });
            logRequest(req, res, 'admin.settings.template ok');
        } catch (error) {
            sendJson(res, 500, { error: 'Internal server error' });
            logger.error('admin.settings.template.failed', {
                requestId,
                actorSource: authContext.actorSource,
                settingsPath,
                message:
                    error instanceof Error ? error.message : 'unknown error',
            });
            logRequest(req, res, 'admin.settings.template failed');
        }
    };

    /**
     * @api.operationId: getAdminSettingsYaml
     * @api.path: GET /api/admin/settings.yaml
     */
    const handleAdminSettingsYamlRequest: RequestHandler = async (req, res) => {
        const authContext = await authorize(req, res, 'admin.settings.read');
        if (!authContext) {
            return;
        }
        if (req.method !== 'GET') {
            sendJson(res, 405, { error: 'Method not allowed' });
            logRequest(req, res, 'admin.settings.read method-not-allowed');
            return;
        }

        const requestId = readRequestId(req);
        try {
            const yamlText = await fs.promises.readFile(settingsPath, 'utf8');
            const etag = computeSettingsEtag(yamlText);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('ETag', etag);
            res.end(yamlText);
            logger.info('admin.settings.read.succeeded', {
                requestId,
                actorSource: authContext.actorSource,
                settingsPath,
                etag,
            });
            logRequest(req, res, 'admin.settings.read ok');
        } catch (error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code === 'ENOENT') {
                sendJson(res, 404, { error: 'Settings file not found' });
            } else {
                sendJson(res, 500, { error: 'Internal server error' });
            }
            logger.error('admin.settings.read.failed', {
                requestId,
                actorSource: authContext.actorSource,
                settingsPath,
                code: nodeError.code ?? 'unknown',
                message:
                    error instanceof Error ? error.message : 'unknown error',
            });
            logRequest(req, res, 'admin.settings.read failed');
        }
    };

    /**
     * @api.operationId: postAdminSettingsValidate
     * @api.path: POST /api/admin/settings/validate
     */
    const handleAdminSettingsValidateRequest: RequestHandler = async (
        req,
        res
    ) => {
        const authContext = await authorize(
            req,
            res,
            'admin.settings.validate'
        );
        if (!authContext) {
            return;
        }
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed' });
            logRequest(req, res, 'admin.settings.validate method-not-allowed');
            return;
        }

        const requestId = readRequestId(req);
        try {
            const rawBody = await readRawBody(req, maxBodyBytes);
            const result = validateYamlText({ rawText: rawBody, settingsPath });
            if (!result.ok) {
                sendJson(res, 400, {
                    error: 'Invalid settings YAML',
                    validationErrors: [result.detail],
                });
                logger.warn('admin.settings.validate.failed', {
                    requestId,
                    actorSource: authContext.actorSource,
                    settingsPath,
                    category: result.detail.category,
                    pointer: result.detail.pointer,
                    restartRequired: true,
                });
                logRequest(req, res, 'admin.settings.validate invalid');
                return;
            }

            sendJson(res, 200, {
                ok: true,
                valid: true,
                normalizedSummary: result.normalizedSummary,
                warnings: [],
                restartRequired: true,
            });
            logger.info('admin.settings.validate.succeeded', {
                requestId,
                actorSource: authContext.actorSource,
                settingsPath,
                restartRequired: true,
            });
            logRequest(req, res, 'admin.settings.validate ok');
        } catch (error) {
            if (error instanceof RequestBodyTooLargeError) {
                sendJson(res, 413, { error: 'Request payload too large' });
                logger.warn('admin.settings.validate.failed', {
                    requestId,
                    actorSource: authContext.actorSource,
                    settingsPath,
                    category: 'payload_too_large',
                });
                logRequest(
                    req,
                    res,
                    'admin.settings.validate payload-too-large'
                );
                return;
            }

            sendJson(res, 500, { error: 'Internal server error' });
            logger.error('admin.settings.validate.failed', {
                requestId,
                actorSource: authContext.actorSource,
                settingsPath,
                category: 'internal_error',
                message:
                    error instanceof Error ? error.message : 'unknown error',
            });
            logRequest(req, res, 'admin.settings.validate failed');
        }
    };

    /**
     * @api.operationId: putAdminSettingsYaml
     * @api.path: PUT /api/admin/settings.yaml
     */
    const handleAdminSettingsYamlPutRequest: RequestHandler = async (
        req,
        res
    ) => {
        const authContext = await authorize(req, res, 'admin.settings.write');
        if (!authContext) {
            return;
        }
        if (req.method !== 'PUT') {
            sendJson(res, 405, { error: 'Method not allowed' });
            logRequest(req, res, 'admin.settings.write method-not-allowed');
            return;
        }

        const requestId = readRequestId(req);
        const ifMatch = readHeaderValue(req.headers['if-match']);
        if (!ifMatch) {
            sendJson(res, 428, { error: 'Missing If-Match header' });
            logger.warn('admin.settings.write.failed', {
                requestId,
                actorSource: authContext.actorSource,
                settingsPath,
                code: 'if_match_missing',
            });
            logRequest(req, res, 'admin.settings.write missing-if-match');
            return;
        }

        await withSettingsWriteLock(settingsPath, async () => {
            let settingsFileExists = false;
            let currentEtag: string | null = null;
            try {
                const currentYaml = await fs.promises.readFile(
                    settingsPath,
                    'utf8'
                );
                settingsFileExists = true;
                currentEtag = computeSettingsEtag(currentYaml);
            } catch (error) {
                const nodeError = error as NodeJS.ErrnoException;
                if (nodeError.code === 'ENOENT') {
                    if (ifMatch !== SETUP_MISSING_IF_MATCH_ETAG) {
                        sendJson(res, 412, {
                            error: 'ETag mismatch',
                            details:
                                'Refresh settings.yaml and retry with the latest ETag.',
                        });
                        logger.warn('admin.settings.write.failed', {
                            requestId,
                            actorSource: authContext.actorSource,
                            settingsPath,
                            code: 'etag_mismatch_missing_sentinel_required',
                        });
                        logRequest(
                            req,
                            res,
                            'admin.settings.write etag-mismatch'
                        );
                        return;
                    }
                } else {
                    sendJson(res, 500, { error: 'Internal server error' });
                    logger.error('admin.settings.write.failed', {
                        requestId,
                        actorSource: authContext.actorSource,
                        settingsPath,
                        code: nodeError.code ?? 'unknown',
                    });
                    logRequest(req, res, 'admin.settings.write read-failed');
                    return;
                }
            }

            if (!settingsFileExists) {
                if (ifMatch !== SETUP_MISSING_IF_MATCH_ETAG) {
                    sendJson(res, 412, {
                        error: 'ETag mismatch',
                        details:
                            'Refresh settings.yaml and retry with the latest ETag.',
                    });
                    logger.warn('admin.settings.write.failed', {
                        requestId,
                        actorSource: authContext.actorSource,
                        settingsPath,
                        code: 'etag_mismatch',
                        priorEtag: null,
                    });
                    logRequest(req, res, 'admin.settings.write etag-mismatch');
                    return;
                }
            } else if (ifMatch !== currentEtag) {
                sendJson(res, 412, {
                    error: 'ETag mismatch',
                    details:
                        'Refresh settings.yaml and retry with the latest ETag.',
                });
                logger.warn('admin.settings.write.failed', {
                    requestId,
                    actorSource: authContext.actorSource,
                    settingsPath,
                    code: 'etag_mismatch',
                    priorEtag: currentEtag,
                });
                logRequest(req, res, 'admin.settings.write etag-mismatch');
                return;
            }

            try {
                const rawBody = await readRawBody(req, maxBodyBytes);
                const validationResult = validateYamlText({
                    rawText: rawBody,
                    settingsPath,
                });
                if (!validationResult.ok) {
                    sendJson(res, 400, {
                        error: 'Invalid settings YAML',
                        validationErrors: [validationResult.detail],
                    });
                    logger.warn('admin.settings.write.failed', {
                        requestId,
                        actorSource: authContext.actorSource,
                        settingsPath,
                        code: 'validation_failed',
                        category: validationResult.detail.category,
                        pointer: validationResult.detail.pointer,
                    });
                    logRequest(req, res, 'admin.settings.write invalid');
                    return;
                }

                await writeSettingsFileAtomically(settingsPath, rawBody);
                const newEtag = computeSettingsEtag(rawBody);
                sendJson(res, 200, {
                    ok: true,
                    etag: newEtag,
                    restartRequired: true,
                    applied: false,
                });
                logger.info('admin.settings.write.succeeded', {
                    requestId,
                    actorSource: authContext.actorSource,
                    settingsPath,
                    priorEtag:
                        currentEtag === null
                            ? SETUP_MISSING_IF_MATCH_ETAG
                            : currentEtag,
                    newEtag,
                    restartRequired: true,
                });
                logRequest(req, res, 'admin.settings.write ok');
            } catch (error) {
                if (error instanceof RequestBodyTooLargeError) {
                    sendJson(res, 413, { error: 'Request payload too large' });
                    logger.warn('admin.settings.write.failed', {
                        requestId,
                        actorSource: authContext.actorSource,
                        settingsPath,
                        code: 'payload_too_large',
                    });
                    logRequest(
                        req,
                        res,
                        'admin.settings.write payload-too-large'
                    );
                    return;
                }

                sendJson(res, 500, { error: 'Internal server error' });
                logger.error('admin.settings.write.failed', {
                    requestId,
                    actorSource: authContext.actorSource,
                    settingsPath,
                    code: 'internal_error',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'unknown error',
                });
                logRequest(req, res, 'admin.settings.write failed');
            }
        });
    };

    return {
        handleAdminSettingsSchemaRequest,
        handleAdminSettingsTemplateRequest,
        handleAdminSettingsYamlRequest,
        handleAdminSettingsValidateRequest,
        handleAdminSettingsYamlPutRequest,
    };
};

export { createAdminSettingsHandlers };
