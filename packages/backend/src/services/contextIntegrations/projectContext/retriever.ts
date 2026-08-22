/**
 * @description: Builds and queries a bounded, revision-aware project-document index.
 * Embeddings are batched, cached by content identity, deadline-bounded, and fail open.
 * @footnote-scope: core
 * @footnote-module: ProjectContextRetriever
 * @footnote-risk: high - Retrieval quality, timeout behavior, and index revision shape answer grounding.
 * @footnote-ethics: high - A stale or weak result must remain visibly qualified instead of becoming false certainty.
 */
import type {
    ProjectContextCategory,
    ProjectContextMatch,
} from '@footnote/contracts/policy';
import type { EmbeddingRuntimeResult } from '@footnote/agent-runtime';
import {
    chunkProjectDocument,
    defaultCategoryForPath,
    hashText,
    type ProjectDocumentSource,
} from './documentLoader.js';
import {
    createProjectVectorStore,
    type ProjectIndexIdentity,
} from './vectorStore.js';
import type { ProjectDocumentSet } from './documentSource.js';

const DEFAULT_EMBEDDING_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_MATCHES = 6;
const DEFAULT_MIN_SCORE = 0.35;
const EMBEDDING_BATCH_SIZE = 64;

export type ProjectContextRetrievalFailureCode =
    'index_unavailable' | 'query_embedding_failed' | 'embedding_timeout';

export type ProjectContextRetrieverOptions = {
    identity: ProjectIndexIdentity;
    resolveDocuments: () => Promise<
        ProjectDocumentSource[] | ProjectDocumentSet
    >;
    embedTexts: (
        texts: string[],
        signal: AbortSignal,
        purpose: 'index' | 'query'
    ) => Promise<EmbeddingRuntimeResult>;
    maxChunkBytes: number;
    maxChunks: number;
    topKPerCategory: number;
    maxMatches?: number;
    minScore?: number;
    embeddingTimeoutMs?: number;
    now?: () => number;
};

export type ProjectContextRetrievalOutcome =
    | {
          ok: true;
          status: 'current' | 'stale';
          indexedAt: string;
          indexedCommitSha?: string;
          matches: ProjectContextMatch[];
      }
    | {
          ok: false;
          code: ProjectContextRetrievalFailureCode;
          detail: string;
      };

export type ProjectContextRetriever = {
    retrieve: (
        query: string,
        categories: ProjectContextCategory[]
    ) => Promise<ProjectContextRetrievalOutcome>;
};

type PreparedProjectIndex = {
    fingerprint: string;
    revision: string | null;
    chunks: Array<{
        id: string;
        path: string;
        category: ProjectContextCategory;
        contentHash: string;
        text: string;
        priority?: number;
    }>;
};

type BuiltProjectIndex = {
    fingerprint: string;
    revision: string | null;
    indexedAt: string;
    store: ReturnType<typeof createProjectVectorStore>;
};

type BoundedEmbeddingResult = {
    result: EmbeddingRuntimeResult;
    timedOut: boolean;
};

type EmbeddingDeadlineBudget = {
    deadlineAt: number;
    timeoutMs: number;
};

class ProjectContextEmbeddingError extends Error {
    public readonly code: ProjectContextRetrievalFailureCode;

    public constructor(
        code: ProjectContextRetrievalFailureCode,
        message: string
    ) {
        super(message);
        this.name = 'ProjectContextEmbeddingError';
        this.code = code;
    }
}

const asDocumentSet = (
    value: ProjectDocumentSource[] | ProjectDocumentSet
): ProjectDocumentSet =>
    Array.isArray(value)
        ? { revision: null, documents: value, source: 'git' }
        : value;

/** Keeps every category represented before spending the global chunk budget. */
export const selectProjectContextChunks = (
    sources: ProjectDocumentSource[],
    options: Pick<ProjectContextRetrieverOptions, 'maxChunkBytes' | 'maxChunks'>
): PreparedProjectIndex['chunks'] => {
    const byCategory = new Map<
        ProjectContextCategory,
        PreparedProjectIndex['chunks']
    >();
    for (const source of sources) {
        const documentChunks = chunkProjectDocument(source, {
            maxChunkBytes: options.maxChunkBytes,
            categoryForPath: defaultCategoryForPath,
        });
        const category = source.category ?? defaultCategoryForPath(source.path);
        const categoryChunks = byCategory.get(category) ?? [];
        categoryChunks.push(
            ...documentChunks.map((chunk) => ({
                id: chunk.id,
                path: chunk.path,
                category: chunk.category,
                contentHash: chunk.contentHash,
                text: chunk.text,
                priority: source.priority,
            }))
        );
        byCategory.set(category, categoryChunks);
    }
    for (const categoryChunks of byCategory.values()) {
        categoryChunks.sort(
            (left, right) =>
                (right.priority ?? 0) - (left.priority ?? 0) ||
                (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
        );
    }

    const categories: ProjectContextCategory[] = [
        'documented_intent',
        'documented_behavior',
        'current_state',
    ];
    const selected: PreparedProjectIndex['chunks'] = [];
    let cursor = 0;
    while (selected.length < options.maxChunks) {
        let added = false;
        for (const category of categories) {
            const candidate = byCategory.get(category)?.[cursor];
            if (candidate === undefined) continue;
            selected.push(candidate);
            added = true;
            if (selected.length >= options.maxChunks) break;
        }
        if (!added) break;
        cursor += 1;
    }
    return selected;
};

const prepareIndex = (
    documentSet: ProjectDocumentSet,
    options: ProjectContextRetrieverOptions
): PreparedProjectIndex | undefined => {
    const chunks = selectProjectContextChunks(documentSet.documents, options);
    if (chunks.length === 0) return undefined;
    const fingerprint = hashText(
        `${documentSet.revision ?? 'unversioned'}\n${chunks
            .map((chunk) =>
                [
                    chunk.path,
                    chunk.id,
                    chunk.category,
                    chunk.contentHash,
                    chunk.priority ?? 0,
                ].join('|')
            )
            .join('\n')}`
    );
    return { fingerprint, revision: documentSet.revision, chunks };
};

const withDeadline = async (
    options: ProjectContextRetrieverOptions,
    budget: EmbeddingDeadlineBudget,
    texts: string[],
    purpose: 'index' | 'query'
): Promise<BoundedEmbeddingResult> => {
    const controller = new AbortController();
    const now = (options.now ?? Date.now)();
    if (budget.deadlineAt <= now) {
        return {
            timedOut: true,
            result: {
                status: 'error',
                reason: `Project context ${purpose} embedding exceeded its ${budget.timeoutMs}ms deadline.`,
                model: options.identity.model,
                provider: options.identity.provider,
            },
        };
    }
    const remainingMs = Math.max(1, Math.floor(budget.deadlineAt - now));
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<BoundedEmbeddingResult>((resolve) => {
        timeoutHandle = setTimeout(() => {
            controller.abort();
            resolve({
                timedOut: true,
                result: {
                    status: 'error',
                    reason: `Project context ${purpose} embedding exceeded its ${budget.timeoutMs}ms deadline.`,
                    model: options.identity.model,
                    provider: options.identity.provider,
                },
            });
        }, remainingMs);
    });
    const embeddingPromise = options
        .embedTexts(texts, controller.signal, purpose)
        .then((result) => ({ result, timedOut: false }))
        .catch((error: unknown) => ({
            timedOut: false,
            result: {
                status: 'error' as const,
                reason: error instanceof Error ? error.message : String(error),
                model: options.identity.model,
                provider: options.identity.provider,
            },
        }));
    try {
        return await Promise.race([embeddingPromise, timeout]);
    } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
};

const buildIndex = async (
    options: ProjectContextRetrieverOptions,
    prepared: PreparedProjectIndex,
    embeddingCache: Map<string, number[]>,
    budget: EmbeddingDeadlineBudget
): Promise<BuiltProjectIndex> => {
    const cachePrefix = `${options.identity.provider}|${options.identity.model}|`;
    const missing = prepared.chunks.filter(
        (chunk) => !embeddingCache.has(`${cachePrefix}${chunk.contentHash}`)
    );
    for (
        let offset = 0;
        offset < missing.length;
        offset += EMBEDDING_BATCH_SIZE
    ) {
        const batch = missing.slice(offset, offset + EMBEDDING_BATCH_SIZE);
        const embeddingResult = await withDeadline(
            options,
            budget,
            batch.map((chunk) => chunk.text),
            'index'
        );
        const embeddingResultValue = embeddingResult.result;
        if (embeddingResultValue.status !== 'success') {
            throw new ProjectContextEmbeddingError(
                embeddingResult.timedOut
                    ? 'embedding_timeout'
                    : 'index_unavailable',
                embeddingResultValue.reason
            );
        }
        if (embeddingResultValue.embeddings.length !== batch.length) {
            throw new Error(
                `Embedding response returned ${embeddingResultValue.embeddings.length} vectors for ${batch.length} chunks.`
            );
        }
        batch.forEach((chunk, index) => {
            const embedding = embeddingResultValue.embeddings[index];
            if (embedding !== undefined) {
                embeddingCache.set(
                    `${cachePrefix}${chunk.contentHash}`,
                    embedding
                );
            }
        });
    }

    const retainedKeys = new Set(
        prepared.chunks.map((chunk) => `${cachePrefix}${chunk.contentHash}`)
    );
    for (const key of embeddingCache.keys()) {
        if (key.startsWith(cachePrefix) && !retainedKeys.has(key)) {
            embeddingCache.delete(key);
        }
    }

    const store = createProjectVectorStore({
        identity: { ...options.identity, sourceRevision: prepared.revision },
        maxChunks: options.maxChunks,
    });
    store.upsert(
        prepared.chunks.flatMap((chunk) => {
            const embedding = embeddingCache.get(
                `${cachePrefix}${chunk.contentHash}`
            );
            return embedding === undefined ? [] : [{ ...chunk, embedding }];
        })
    );
    if (store.chunkCount() === 0) {
        throw new Error('Project context index contains no usable embeddings.');
    }
    return {
        fingerprint: prepared.fingerprint,
        revision: prepared.revision,
        indexedAt: new Date((options.now ?? Date.now)()).toISOString(),
        store,
    };
};

const createIndexLoader = (options: ProjectContextRetrieverOptions) => {
    let current: BuiltProjectIndex | undefined;
    let inFlight:
        | { fingerprint: string; promise: Promise<BuiltProjectIndex> }
        | undefined;
    const embeddingCache = new Map<string, number[]>();

    return async (
        budget: EmbeddingDeadlineBudget
    ): Promise<
        | { ok: true; index: BuiltProjectIndex; status: 'current' | 'stale' }
        | {
              ok: false;
              code: ProjectContextRetrievalFailureCode;
              detail: string;
          }
    > => {
        try {
            const documentSet = asDocumentSet(await options.resolveDocuments());
            const prepared = prepareIndex(documentSet, options);
            if (prepared === undefined) {
                throw new Error('Project context index is empty.');
            }
            if (current?.fingerprint === prepared.fingerprint) {
                return { ok: true, index: current, status: 'current' };
            }
            const buildPromise =
                inFlight?.fingerprint === prepared.fingerprint
                    ? inFlight.promise
                    : buildIndex(options, prepared, embeddingCache, budget);
            inFlight = {
                fingerprint: prepared.fingerprint,
                promise: buildPromise,
            };
            try {
                const built = await buildPromise;
                current = built;
                return { ok: true, index: built, status: 'current' };
            } finally {
                if (inFlight?.promise === buildPromise) inFlight = undefined;
            }
        } catch (error) {
            const detail =
                error instanceof Error ? error.message : String(error);
            if (current !== undefined) {
                return { ok: true, index: current, status: 'stale' };
            }
            return {
                ok: false,
                code:
                    error instanceof ProjectContextEmbeddingError
                        ? error.code
                        : 'index_unavailable',
                detail,
            };
        }
    };
};

/** Creates a fail-open retriever with revision-correct stale-index behavior. */
export const createProjectContextRetriever = (
    options: ProjectContextRetrieverOptions
): ProjectContextRetriever => {
    const loadIndex = createIndexLoader(options);
    const maxMatches = Math.max(1, options.maxMatches ?? DEFAULT_MAX_MATCHES);
    const minScore = options.minScore ?? DEFAULT_MIN_SCORE;

    return {
        async retrieve(query, categories) {
            const timeoutMs = Math.max(
                1,
                Math.floor(
                    options.embeddingTimeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS
                )
            );
            const budget: EmbeddingDeadlineBudget = {
                timeoutMs,
                deadlineAt: (options.now ?? Date.now)() + timeoutMs,
            };
            const loaded = await loadIndex(budget);
            if (!loaded.ok) return loaded;
            const embeddingResult = await withDeadline(
                options,
                budget,
                [query],
                'query'
            );
            if (embeddingResult.result.status !== 'success') {
                return {
                    ok: false,
                    code: embeddingResult.timedOut
                        ? 'embedding_timeout'
                        : 'query_embedding_failed',
                    detail: `Project context query embedding failed: ${embeddingResult.result.reason}`,
                };
            }
            const queryEmbedding = embeddingResult.result.embeddings[0];
            if (queryEmbedding === undefined) {
                return {
                    ok: false,
                    code: 'query_embedding_failed',
                    detail: 'Project context query embedding returned no vector.',
                };
            }
            const matches = loaded.index.store.search(
                queryEmbedding,
                categories,
                options.topKPerCategory,
                options.identity,
                minScore,
                maxMatches
            );
            return {
                ok: true,
                status: loaded.status,
                indexedAt: loaded.index.indexedAt,
                ...(loaded.index.revision !== null && {
                    indexedCommitSha: loaded.index.revision,
                }),
                matches,
            };
        },
    };
};
