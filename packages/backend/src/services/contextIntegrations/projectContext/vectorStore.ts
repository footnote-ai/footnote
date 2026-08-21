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
};

export type StoredProjectChunk = {
    id: string;
    path: string;
    category: ProjectContextCategory;
    contentHash: string;
    text: string;
    embedding: number[];
};

type ProjectVectorStore = {
    identity: ProjectIndexIdentity;
    upsert: (chunks: StoredProjectChunk[]) => void;
    search: (
        queryEmbedding: number[],
        categories: ProjectContextCategory[],
        topK: number
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
        search(queryEmbedding, categories, topK) {
            const limit = Math.max(1, topK);
            const matches: ProjectContextMatch[] = [];
            for (const category of new Set(categories)) {
                const scored: Array<{
                    chunk: StoredProjectChunk;
                    score: number;
                }> = [];
                for (const chunk of chunks.values()) {
                    if (chunk.category !== category) continue;
                    const score = cosineSimilarity(
                        queryEmbedding,
                        chunk.embedding
                    );
                    if (score === undefined) continue;
                    scored.push({
                        chunk,
                        score,
                    });
                }
                scored.sort((left, right) => right.score - left.score);
                matches.push(
                    ...scored.slice(0, limit).map(({ chunk, score }) => ({
                        category: chunk.category,
                        path: chunk.path,
                        contentHash: chunk.contentHash,
                        text: chunk.text,
                        score,
                    }))
                );
            }
            return matches;
        },
        chunkCount() {
            return chunks.size;
        },
    };
};
