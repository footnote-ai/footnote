/**
 * @description: Loads approved project documents, chunks them, and assigns conservative evidence categories.
 * The backend reads file contents here; the script-side resolver only previews the allowlist.
 * @footnote-scope: core
 * @footnote-module: ProjectContextDocumentLoader
 * @footnote-risk: medium - Chunking and category rules shape which evidence reaches the prompt.
 * @footnote-ethics: high - Categories must not claim implementation strength from static docs alone.
 */
import type { ProjectContextCategory } from '@footnote/contracts/policy';

export type ProjectDocumentSource = {
    path: string;
    content: string;
};

export type ProjectDocumentChunk = {
    id: string;
    path: string;
    category: ProjectContextCategory;
    contentHash: string;
    text: string;
};

export type ChunkProjectDocumentOptions = {
    maxChunkBytes: number;
    categoryForPath: (path: string) => ProjectContextCategory;
};

/**
 * Conservative default category mapping.
 *
 * Status docs are current state. Architecture/decisions docs are documented
 * behavior. Everything else stays documented intent. These labels describe
 * what the document claims; they never prove implementation.
 */
export const defaultCategoryForPath = (
    filePath: string
): ProjectContextCategory => {
    const normalized = filePath.replaceAll('\\', '/');
    if (
        normalized.startsWith('docs/status/') ||
        normalized.startsWith('docs/status.md')
    ) {
        return 'current_state';
    }
    if (
        normalized.startsWith('docs/architecture/') ||
        normalized.startsWith('docs/decisions/')
    ) {
        return 'documented_behavior';
    }
    return 'documented_intent';
};

export const hashText = (text: string): string => {
    // FNV-1a is deterministic, dependency-free, and stable across platforms.
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a:${(hash >>> 0).toString(16)}`;
};

/**
 * Splits one document into stable, bounded chunks.
 *
 * Prefers markdown heading boundaries so each chunk keeps its heading context;
 * falls back to hard byte splits so no chunk can exceed the configured cap.
 */
export const chunkProjectDocument = (
    source: ProjectDocumentSource,
    options: ChunkProjectDocumentOptions
): ProjectDocumentChunk[] => {
    const category = options.categoryForPath(source.path);
    const content = source.content.trim();
    const sections: string[] = [];

    let sectionStart = 0;
    for (let index = 1; index < content.length; index += 1) {
        if (content[index] === '#' && content[index - 1] === '\n') {
            sections.push(content.slice(sectionStart, index).trim());
            sectionStart = index;
        }
    }
    sections.push(content.slice(sectionStart).trim());

    const chunks: ProjectDocumentChunk[] = [];
    let chunkIndex = 0;
    for (const section of sections) {
        if (section.length === 0) continue;
        let offset = 0;
        while (offset < section.length) {
            let end = Math.min(offset + options.maxChunkBytes, section.length);
            if (end < section.length) {
                const hardBreak = section.lastIndexOf('\n', end);
                if (hardBreak > offset) end = hardBreak;
            }
            const text = section.slice(offset, end).trim();
            if (text.length > 0) {
                chunks.push({
                    id: `${source.path}#${chunkIndex}`,
                    path: source.path,
                    category,
                    contentHash: hashText(text),
                    text,
                });
                chunkIndex += 1;
            }
            offset = end;
        }
    }

    return chunks;
};
