/**
 * @description: Connects the fixed NYC September 11 preview to Footnote's signed-in chat boundary.
 * @footnote-scope: core
 * @footnote-module: NycSept11Archive
 * @footnote-risk: high - Retrieval or citation validation errors can misstate historical evidence.
 * @footnote-ethics: high - A public archive demo must keep claims bounded by inspectable sources.
 */

import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
    GenerationRuntime,
    GenerationResult,
} from '@footnote/agent-runtime';
import type {
    ArchiveMetadata,
    ArchiveSourceMetadata,
    Citation,
    PostChatRequest,
    ResponseMetadata,
} from '@footnote/contracts';
import type { AccountAuthService } from './accountAuth.js';
import type {
    ResponseMetadataGenerationInput,
    ResponseMetadataRuntimeContext,
} from './responseMetadata.js';
import { buildResponseMetadata } from './responseMetadata.js';
import {
    ACCOUNT_SESSION_COOKIE_NAME,
    AUTH_CSRF_HEADER_NAME,
    readCookieValue,
} from '../http/authCookies.js';
import { sendJson } from '../handlers/chatResponses.js';
import { logger } from '../utils/logger.js';

const ARCHIVE_EXPERIENCE_ID = 'nyc-sept11' as const;
const ARCHIVE_MODEL = 'deepseek/deepseek-v4-flash-0731';
const ARCHIVE_VERSION = 'sept11-preview-rc1';
const MAX_QUERY_CHARS = 3072;
const ARCHIVE_TIMEOUT_MS = 35_000;

type ArchiveServiceSource = {
    chunkId: string;
    documentId: string;
    pageId: string;
    pageNumber: number;
    originalUrl: string;
    text: string;
    rank: number;
};

type ArchiveServiceResponse = {
    version: string;
    scope: { documentsIndexed: number; completeArchive: false };
    sources: ArchiveServiceSource[];
};

type ArchiveServiceClient = {
    retrieve: (
        query: string,
        signal: AbortSignal
    ) => Promise<ArchiveServiceResponse>;
};

type ArchiveChatDeps = {
    generationRuntime: GenerationRuntime | null;
    accountAuthService: AccountAuthService;
    archiveServiceClient: ArchiveServiceClient | null;
    storeTrace: (metadata: ResponseMetadata) => Promise<void>;
};

type ArchiveChatHandler = (
    req: IncomingMessage,
    res: ServerResponse,
    request: PostChatRequest
) => Promise<void>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isValidSource = (value: unknown): value is ArchiveServiceSource => {
    if (!isRecord(value)) return false;
    const url = typeof value.originalUrl === 'string' ? value.originalUrl : '';
    return (
        typeof value.chunkId === 'string' &&
        value.chunkId.length > 0 &&
        typeof value.documentId === 'string' &&
        value.documentId.length > 0 &&
        typeof value.pageId === 'string' &&
        value.pageId.length > 0 &&
        typeof value.pageNumber === 'number' &&
        Number.isInteger(value.pageNumber) &&
        value.pageNumber > 0 &&
        typeof value.text === 'string' &&
        value.text.length > 0 &&
        typeof value.rank === 'number' &&
        Number.isInteger(value.rank) &&
        value.rank > 0 &&
        url.startsWith('https://sept11documents.cityofnewyork.us/')
    );
};

const parseArchiveServiceResponse = (
    value: unknown
): ArchiveServiceResponse => {
    if (
        !isRecord(value) ||
        typeof value.version !== 'string' ||
        !isRecord(value.scope)
    ) {
        throw new Error('archive_service_invalid_response');
    }
    const sources = value.sources;
    if (
        value.version !== ARCHIVE_VERSION ||
        value.scope.documentsIndexed !== 49 ||
        value.scope.completeArchive !== false ||
        !Array.isArray(sources) ||
        sources.length > 5 ||
        !sources.every(isValidSource)
    ) {
        throw new Error('archive_service_invalid_scope');
    }
    return {
        version: value.version,
        scope: { documentsIndexed: 49, completeArchive: false },
        sources,
    };
};

const createArchiveServiceClient = (): ArchiveServiceClient | null => {
    if (process.env.FOOTNOTE_ARCHIVE_PREVIEW_ENABLED !== 'true') return null;
    const serviceUrl = process.env.FOOTNOTE_ARCHIVE_SERVICE_URL;
    const serviceToken = process.env.FOOTNOTE_ARCHIVE_SERVICE_TOKEN;
    if (!serviceUrl || !serviceToken) return null;
    return {
        retrieve: async (query, signal) => {
            const response = await fetch(
                `${serviceUrl.replace(/\/$/, '')}/v1/retrieve`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${serviceToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ query }),
                    signal,
                }
            );
            if (!response.ok)
                throw new Error(`archive_service_http_${response.status}`);
            return parseArchiveServiceResponse(
                (await response.json()) as unknown
            );
        },
    };
};

const hasValidCsrf = (req: IncomingMessage, expected: string): boolean => {
    const raw = req.headers[AUTH_CSRF_HEADER_NAME];
    const supplied = Array.isArray(raw) ? raw[0] : raw;
    if (!supplied) return false;
    const left = Buffer.from(supplied);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
};

const buildArchivePrompt = (
    query: string,
    sources: readonly ArchiveServiceSource[]
): { system: string; user: string } => ({
    system: 'You are the NYC September 11 archive preview. Answer only from the indexed source excerpts in the user message. Do not use web search, general model knowledge, other Footnote context, or unstated assumptions. Cite every factual claim with one or more source labels such as [S1]. If the excerpts do not establish an answer, say exactly that the indexed records do not establish it and do not speculate. Keep the answer concise.',
    user: [
        `Question: ${query}`,
        'Indexed excerpts:',
        ...sources.map(
            (source, index) =>
                `[S${index + 1}] ${source.documentId}, page ${source.pageNumber}\n${source.text}`
        ),
    ].join('\n\n'),
});

const validateArchiveAnswer = (text: string, sourceCount: number): boolean => {
    if (!text.trim()) return false;
    const labels = [...text.matchAll(/\bS(\d+)\b/g)].map((match) =>
        Number(match[1])
    );
    if (labels.some((label) => label < 1 || label > sourceCount)) return false;
    const abstains =
        /indexed records? (do not|don't) establish|cannot establish|not establish/i.test(
            text
        );
    return labels.length > 0 || abstains;
};

const toArchiveMetadata = (
    response: ArchiveServiceResponse,
    sources: readonly ArchiveServiceSource[]
): ArchiveMetadata => ({
    experienceId: ARCHIVE_EXPERIENCE_ID,
    version: response.version,
    documentsIndexed: response.scope.documentsIndexed,
    completeArchive: false,
    sources: sources.map<ArchiveSourceMetadata>((source, index) => ({
        sourceLabel: `S${index + 1}`,
        chunkId: source.chunkId,
        documentId: source.documentId,
        pageId: source.pageId,
        pageNumber: source.pageNumber,
        originalUrl: source.originalUrl,
    })),
});

const toCitations = (
    text: string,
    sources: readonly ArchiveServiceSource[]
): Citation[] => {
    const labels = new Set(
        [...text.matchAll(/\bS(\d+)\b/g)].map((match) => Number(match[1]))
    );
    return sources.flatMap((source, index) =>
        labels.has(index + 1)
            ? [
                  {
                      title: `${source.documentId} · page ${source.pageNumber}`,
                      url: source.originalUrl,
                  },
              ]
            : []
    );
};

const buildArchiveMetadata = (
    result: GenerationResult,
    query: string,
    citations: Citation[]
): ResponseMetadata => {
    const generationMetadata: ResponseMetadataGenerationInput = {
        model: ARCHIVE_MODEL,
        usage: result.usage,
        finishReason: result.finishReason,
        completion: result.completion ?? {
            status: 'completed',
            visibleTextLength: result.text.length,
        },
        reasoningEffort: 'none',
        verbosity: 'low',
        provenance: 'Retrieved',
        citations,
    };
    const runtimeContext: ResponseMetadataRuntimeContext = {
        modelVersion: ARCHIVE_MODEL,
        conversationSnapshot: query,
        retrieval: {
            requested: true,
            used: true,
            contextUsed: true,
            intent: 'current_facts',
            contextSize: 'medium',
        },
        executionContext: {
            generation: {
                status: 'executed',
                profileId: ARCHIVE_EXPERIENCE_ID,
                provider: 'openrouter',
                model: ARCHIVE_MODEL,
                finishReason: result.finishReason,
                completion: generationMetadata.completion,
                usage: result.usage,
            },
        },
    };
    return buildResponseMetadata(generationMetadata, runtimeContext);
};

/** Creates the fixed archive branch used only when PostChatRequest selects nyc-sept11. */
export const createNycSept11ArchiveHandler =
    ({
        generationRuntime,
        accountAuthService,
        archiveServiceClient,
        storeTrace,
    }: ArchiveChatDeps): ArchiveChatHandler =>
    async (req, res, request) => {
        if (!archiveServiceClient || !generationRuntime) {
            sendJson(res, 503, { error: 'Archive preview is unavailable' });
            return;
        }
        const sessionId = readCookieValue(req, ACCOUNT_SESSION_COOKIE_NAME);
        const session = sessionId
            ? accountAuthService.getSession(sessionId)
            : null;
        if (!session) {
            sendJson(res, 401, {
                error: 'Sign-in is required for the archive preview',
            });
            return;
        }
        if (!hasValidCsrf(req, session.csrfToken)) {
            sendJson(res, 403, { error: 'Invalid CSRF token' });
            return;
        }
        if (request.latestUserInput.length > MAX_QUERY_CHARS) {
            sendJson(res, 413, { error: 'Archive question is too long' });
            return;
        }
        const startedAt = Date.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(
            () => controller.abort(),
            ARCHIVE_TIMEOUT_MS
        );
        try {
            const archiveResponse = await archiveServiceClient.retrieve(
                request.latestUserInput,
                controller.signal
            );
            if (archiveResponse.sources.length === 0) {
                sendJson(res, 502, {
                    error: 'Archive evidence was unavailable',
                });
                return;
            }
            const prompt = buildArchivePrompt(
                request.latestUserInput,
                archiveResponse.sources
            );
            const result = await generationRuntime.generate({
                messages: [
                    { role: 'system', content: prompt.system },
                    { role: 'user', content: prompt.user },
                ],
                model: ARCHIVE_MODEL,
                maxOutputTokens: 4096,
                temperature: 0,
                reasoningEffort: 'none',
                verbosity: 'low',
            });
            const citations = toCitations(result.text, archiveResponse.sources);
            if (
                !validateArchiveAnswer(
                    result.text,
                    archiveResponse.sources.length
                )
            ) {
                logger.warn('archive.preview.invalid_citations', {
                    sourceCount: archiveResponse.sources.length,
                });
                sendJson(res, 502, {
                    error: 'Archive answer failed citation validation',
                });
                return;
            }
            const metadata = buildArchiveMetadata(
                result,
                request.latestUserInput,
                citations
            );
            const archive = toArchiveMetadata(
                archiveResponse,
                archiveResponse.sources
            );
            const responseMetadata: ResponseMetadata = { ...metadata, archive };
            await storeTrace(responseMetadata);
            sendJson(res, 200, {
                action: 'message',
                message: result.text,
                modality: 'text',
                metadata: responseMetadata,
            });
            logger.info('archive.preview.completed', {
                experienceId: ARCHIVE_EXPERIENCE_ID,
                sourceCount: archiveResponse.sources.length,
                durationMs: Date.now() - startedAt,
            });
        } catch (error) {
            logger.warn('archive.preview.failed', {
                experienceId: ARCHIVE_EXPERIENCE_ID,
                reason: error instanceof Error ? error.message : 'unknown',
            });
            sendJson(res, 502, {
                error: 'Archive preview is temporarily unavailable',
            });
        } finally {
            clearTimeout(timeoutId);
        }
    };

export const getNycSept11ArchiveServiceClient = createArchiveServiceClient;
