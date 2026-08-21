/**
 * @description: Retrieves approved project-document facts for a query using an embedded index.
 * Returns retrieval matches only; citation and prompt projection belong to the executor.
 * @footnote-scope: core
 * @footnote-module: ProjectContextRetriever
 * @footnote-risk: medium - Retrieval quality and staleness shape answer grounding.
 * @footnote-ethics: high - Failures must stay observable so the executor can decide fail-open continuation.
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
    type ProjectVectorStore,
} from './vectorStore.js';

export type ProjectContextRetrieverOptions = {
    identity: ProjectIndexIdentity;
    resolveDocuments: () => Promise<ProjectDocumentSource[]>;
    embedTexts: (texts: string[]) => Promise<EmbeddingRuntimeResult>;
    maxChunkBytes: number;
    maxChunks: number;
    topKPerCategory: number;
};

export type ProjectContextRetrievalOutcome =
    | {
          ok: true;
          status: 'current' | 'stale';
          matches: ProjectContextMatch[];
      }
    | {
          ok: false;
          reason: string;
      };

export type ProjectContextRetriever = {
    retrieve: (
        query: string,
        categories: ProjectContextCategory[]
    ) => Promise<ProjectContextRetrievalOutcome>;
};

type PreparedProjectIndex = {
    fingerprint: string;
    chunks: Array<{
        id: string;
        path: string;
        category: ProjectContextCategory;
        contentHash: string;
        text: string;
    }>;
};

type BuiltProjectIndex = {
    fingerprint: string;
    store: ProjectVectorStore;
};

const prepareIndex = (
    sources: ProjectDocumentSource[],
    options: ProjectContextRetrieverOptions
): PreparedProjectIndex | undefined => {
    const chunks: PreparedProjectIndex['chunks'] = [];
    for (const source of sources) {
        const documentChunks = chunkProjectDocument(source, {
            maxChunkBytes: options.maxChunkBytes,
            categoryForPath: defaultCategoryForPath,
        });
        const remaining = options.maxChunks - chunks.length;
        if (remaining <= 0) break;
        chunks.push(
            ...documentChunks.slice(0, remaining).map((chunk) => ({
                id: chunk.id,
                path: chunk.path,
                category: chunk.category,
                contentHash: chunk.contentHash,
                text: chunk.text,
            }))
        );
    }
    if (chunks.length === 0) return undefined;
    const fingerprint = hashText(
        chunks
            .map((chunk) => `${chunk.path}|${chunk.id}|${chunk.contentHash}`)
            .join('\n')
    );
    return { fingerprint, chunks };
};

const buildIndex = async (
    options: ProjectContextRetrieverOptions,
    prepared: PreparedProjectIndex
): Promise<BuiltProjectIndex> => {
    const store = createProjectVectorStore({ identity: options.identity });
    const embeddingResult = await options.embedTexts(
        prepared.chunks.map((chunk) => chunk.text)
    );
    if (embeddingResult.status !== 'success') {
        throw new Error(
            `Project context index build failed: ${embeddingResult.reason}`
        );
    }
    if (embeddingResult.embeddings.length !== prepared.chunks.length) {
        throw new Error(
            `Project context index build returned ${embeddingResult.embeddings.length} vectors for ${prepared.chunks.length} chunks.`
        );
    }
    store.upsert(
        prepared.chunks.map((chunk, index) => ({
            ...chunk,
            embedding: embeddingResult.embeddings[index] ?? [],
        }))
    );
    return {
        fingerprint: prepared.fingerprint,
        store,
    };
};

const staleOutcome = (
    current: BuiltProjectIndex
): { ok: true; store: ProjectVectorStore; status: 'stale' } => ({
    ok: true,
    store: current.store,
    status: 'stale',
});

const currentOutcome = (
    current: BuiltProjectIndex
): { ok: true; store: ProjectVectorStore; status: 'current' } => ({
    ok: true,
    store: current.store,
    status: 'current',
});

const noIndexReason = 'Project context index is empty.';

const asReason = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const createIndexLoader = (options: ProjectContextRetrieverOptions) => {
    let current: BuiltProjectIndex | undefined;
    let inFlight:
        | { fingerprint: string; promise: Promise<BuiltProjectIndex> }
        | undefined;

    return async (): Promise<
        | { ok: true; store: ProjectVectorStore; status: 'current' | 'stale' }
        | { ok: false; reason: string }
    > => {
        try {
            const sources = await options.resolveDocuments();
            const prepared = prepareIndex(sources, options);
            if (prepared === undefined) {
                throw new Error(noIndexReason);
            }
            if (current?.fingerprint === prepared.fingerprint) {
                return currentOutcome(current);
            }
            const buildPromise =
                inFlight?.fingerprint === prepared.fingerprint
                    ? inFlight.promise
                    : buildIndex(options, prepared);
            inFlight = {
                fingerprint: prepared.fingerprint,
                promise: buildPromise,
            };
            try {
                const built = await buildPromise;
                current = built;
                return currentOutcome(built);
            } finally {
                if (inFlight?.promise === buildPromise) inFlight = undefined;
            }
        } catch (error) {
            if (current !== undefined) return staleOutcome(current);
            return { ok: false, reason: asReason(error) };
        }
    };
};

export const createProjectContextRetriever = (
    options: ProjectContextRetrieverOptions
): ProjectContextRetriever => {
    const loadIndex = createIndexLoader(options);

    return {
        async retrieve(query, categories) {
            const fresh = await loadIndex();
            if (!fresh.ok) {
                return { ok: false, reason: fresh.reason };
            }
            const embeddingResult = await options.embedTexts([query]);
            if (embeddingResult.status !== 'success') {
                return {
                    ok: false,
                    reason: `Project context query embedding failed: ${embeddingResult.reason}`,
                };
            }
            const queryEmbedding = embeddingResult.embeddings[0];
            if (queryEmbedding === undefined) {
                return {
                    ok: false,
                    reason: 'Project context query embedding returned no vector.',
                };
            }
            const matches = fresh.store.search(
                queryEmbedding,
                categories,
                options.topKPerCategory
            );
            return {
                ok: true,
                status: fresh.status,
                matches,
            };
        },
    };
};
