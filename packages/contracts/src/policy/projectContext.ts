/**
 * @description: Serializable project-context contract types for approved Footnote documentation.
 * Used by the backend project-context integration to keep retrieval facts and
 * index identity serializable across packages.
 * @footnote-scope: interface
 * @footnote-module: ProjectContextContracts
 * @footnote-risk: low - Type drift can misalign provenance surfaces between backend and web.
 * @footnote-ethics: high - Evidence categories label whether claims are documented intent, documented behavior, or current state.
 */

/**
 * Evidence categories for retrieved project documentation.
 *
 * `documented_intent` is what the project says it wants to be. `documented_behavior`
 * is what static docs say the project does. `current_state` is where the project
 * stands now. These label evidence; they do not by themselves prove implementation.
 */
export const PROJECT_CONTEXT_CATEGORIES = [
    'documented_intent',
    'documented_behavior',
    'current_state',
] as const;

/** Canonical repository owned by the Footnote-self project-context feature. */
export const PROJECT_CONTEXT_CANONICAL_REPOSITORY = 'footnote-ai/footnote';

export type ProjectContextCategory =
    (typeof PROJECT_CONTEXT_CATEGORIES)[number];

export type ProjectContextReasonCode =
    | 'disabled'
    | 'tool_not_requested'
    | 'invalid_query'
    | 'query_embedding_failed'
    | 'embedding_timeout'
    | 'index_unavailable'
    | 'no_relevant_matches'
    | 'execution_error';

/**
 * One retrieved project-document match.
 *
 * Retrieval returns facts only. Citation and prompt projection are owned by the
 * context-step executor, not the retriever.
 */
export type ProjectContextMatch = {
    category: ProjectContextCategory;
    /** Repository-relative document path. */
    path: string;
    /** Stable source revision/content hash. */
    contentHash: string;
    /** Chunk text used as retrieved evidence. */
    text: string;
    /** Retrieval score when available. */
    score?: number;
    /** Optional human label for the source revision when known. */
    revisionLabel?: string;
};

/**
 * Bounded index identity for the project-context integration.
 *
 * The index identity must change when content hashes, embedding provider/model,
 * or chunker/index versions change, so cached vectors never outlive their meaning.
 */
export type ProjectContextMetadata = {
    repository: string;
    provider: string;
    model: string;
    chunkerVersion: number;
    indexVersion: number;
    indexedCommitSha?: string;
    indexedAt?: string;
    requestedCategories: ProjectContextCategory[];
    returnedCounts: Partial<Record<ProjectContextCategory, number>>;
    maxChunks: number;
    topKPerCategory: number;
    /** Global maximum number of evidence excerpts returned for one query. */
    maxMatches?: number;
    /** Minimum cosine similarity required for an evidence excerpt. */
    minScore?: number;
    /** Maximum time allowed for one embedding request. */
    embeddingTimeoutMs?: number;
    status: 'current' | 'partial' | 'stale' | 'unavailable';
    reasonCodes: ProjectContextReasonCode[];
};
