/**
 * @description: In-memory bounded vector store for project-context chunks.
 * Index identity (provider, model, chunker and index version) keys stored
 * vectors so cached embeddings never outlive their meaning.
 * @footnote-scope: core
 * @footnote-module: ProjectContextVectorStore
 * @footnote-risk: medium - Stale vectors or wrong identity can ground answers on outdated evidence.
 * @footnote-ethics: high - Retrieval facts feed provenance labels, so identity must stay honest.
 */
import type {
    ProjectContextCategory,
    ProjectContextMatch,
} from '@footnote/contracts/policy';

export type ProjectIndexIdentity = {
    provider: string;
    model: string;
    chunkerVersion: number;
    indexVersion: number;
    sourceRevision?: string | null;
};

export type StoredProjectChunk = {
    id: string;
    path: string;
    category: ProjectContextCategory;
    contentHash: string;
    text: string;
    embedding: number[];
    priority?: number;
};

type ProjectVectorStore = {
    identity: ProjectIndexIdentity;
    upsert: (chunks: StoredProjectChunk[]) => void;
    search: (
        queryEmbedding: number[],
        categories: ProjectContextCategory[],
        topK: number,
        queryIdentity?: ProjectIndexIdentity,
        minScore?: number,
        maxMatches?: number
    ) => ProjectContextMatch[];
    chunkCount: () => number;
};

const cosineSimilarity = (
    left: number[],
    right: number[]
): number | undefined => {
    if (left.length !== right.length || left.length === 0) return undefined;
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const leftValue = left[index] ?? 0;
        const rightValue = right[index] ?? 0;
        dot += leftValue * rightValue;
        leftNorm += leftValue * leftValue;
        rightNorm += rightValue * rightValue;
    }
    if (leftNorm === 0 || rightNorm === 0) return 0;
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};

export const createProjectVectorStore = (input: {
    identity: ProjectIndexIdentity;
    maxChunks: number;
}): ProjectVectorStore => {
    const chunks = new Map<string, StoredProjectChunk>();
    const maxChunks = Math.max(1, Math.floor(input.maxChunks));

    return {
        identity: input.identity,
        upsert(chunkList) {
            for (const chunk of chunkList) {
                if (!chunks.has(chunk.id) && chunks.size >= maxChunks) {
                    const oldestId = chunks.keys().next().value as
                        string | undefined;
                    if (oldestId !== undefined) chunks.delete(oldestId);
                }
                chunks.set(chunk.id, chunk);
            }
        },
        search(
            queryEmbedding,
            categories,
            topK,
            queryIdentity,
            minScore = 0,
            maxMatches = topK * Math.max(1, new Set(categories).size)
        ) {
            if (
                queryIdentity !== undefined &&
                (queryIdentity.provider !== input.identity.provider ||
                    queryIdentity.model !== input.identity.model ||
                    queryIdentity.chunkerVersion !==
                        input.identity.chunkerVersion ||
                    queryIdentity.indexVersion !== input.identity.indexVersion)
            ) {
                return [];
            }
            const limit = Math.max(1, topK);
            const categorySet = new Set(categories);
            const scored: Array<{
                chunk: StoredProjectChunk;
                score: number;
            }> = [];
            for (const chunk of chunks.values()) {
                if (!categorySet.has(chunk.category)) continue;
                const score = cosineSimilarity(queryEmbedding, chunk.embedding);
                if (score === undefined || score < minScore) continue;
                scored.push({ chunk, score });
            }
            scored.sort(
                (left, right) =>
                    right.score - left.score ||
                    (right.chunk.priority ?? 0) - (left.chunk.priority ?? 0) ||
                    (left.chunk.id < right.chunk.id ? -1 : 1)
            );
            const matches: ProjectContextMatch[] = [];
            const seenContent = new Set<string>();
            const categoryCounts = new Map<ProjectContextCategory, number>();
            for (const { chunk, score } of scored) {
                if (matches.length >= Math.max(1, maxMatches)) break;
                if (seenContent.has(chunk.contentHash)) continue;
                const categoryCount = categoryCounts.get(chunk.category) ?? 0;
                if (categoryCount >= limit) continue;
                seenContent.add(chunk.contentHash);
                categoryCounts.set(chunk.category, categoryCount + 1);
                matches.push({
                    category: chunk.category,
                    path: chunk.path,
                    contentHash: chunk.contentHash,
                    text: chunk.text,
                    score,
                    ...(input.identity.sourceRevision !== undefined && {
                        revisionLabel:
                            input.identity.sourceRevision ?? undefined,
                    }),
                });
            }
            return matches;
        },
        chunkCount() {
            return chunks.size;
        },
    };
};
