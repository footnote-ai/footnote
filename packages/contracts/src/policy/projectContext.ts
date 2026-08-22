/**
 * @description: Serializable types for approved Footnote project documents.
 * They let the backend share retrieval details and index identity across packages.
 * @footnote-scope: interface
 * @footnote-module: ProjectContextContracts
 * @footnote-risk: low - Type drift can make backend and web provenance disagree.
 * @footnote-ethics: high - Document labels must distinguish intent, behavior, and current state.
 */

/**
 * Labels for retrieved project documents.
 *
 * `documented_intent` is what the project says it wants to be.
 * `documented_behavior` is what static documents say it does. `current_state`
 * is where the project stands now. None of these labels proves implementation.
 */
export const PROJECT_CONTEXT_CATEGORIES = [
    'documented_intent',
    'documented_behavior',
    'current_state',
] as const;

/** Fixed repository used by Footnote's project-context feature. */
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
 * Retrieval returns matching document data. The context-step executor creates
 * citations and prompt messages.
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
 * Details that identify a project-context index.
 *
 * Changes to content hashes, embedding provider or model, chunker version, or
 * index version create a different identity so cached vectors are not reused.
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
    /** Total time allowed for one project-context retrieval step. */
    embeddingTimeoutMs?: number;
    status: 'current' | 'partial' | 'stale' | 'unavailable';
    reasonCodes: ProjectContextReasonCode[];
};
