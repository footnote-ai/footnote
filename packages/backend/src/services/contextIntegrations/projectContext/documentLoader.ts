/**
 * @description: Loads approved project documents, chunks them, and assigns conservative evidence categories.
 * The backend reads file contents here; the script-side resolver only previews the allowlist.
 * @footnote-scope: core
 * @footnote-module: ProjectContextDocumentLoader
 * @footnote-risk: medium - Chunking and category rules shape which evidence reaches the prompt.
 * @footnote-ethics: high - Categories must not claim implementation strength from static docs alone.
 */
import { createHash } from 'node:crypto';
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
        normalized === 'docs/status.md'
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
    return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
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

    let currentSection: string[] = [];
    let inFence = false;
    for (const line of content.split('\n')) {
        const trimmedLine = line.trimStart();
        const isFence = /^(?:```|~~~)/u.test(trimmedLine);
        const isHeading = !inFence && /^#{1,6}(?:\s|$)/u.test(trimmedLine);
        if (isHeading && currentSection.length > 0) {
            sections.push(currentSection.join('\n').trim());
            currentSection = [];
        }
        currentSection.push(line);
        if (isFence) inFence = !inFence;
    }
    sections.push(currentSection.join('\n').trim());

    const chunks: ProjectDocumentChunk[] = [];
    let chunkIndex = 0;
    const chunkSize = Math.max(1, Math.floor(options.maxChunkBytes));
    for (const section of sections) {
        if (section.length === 0) continue;
        const characters = Array.from(section);
        let offset = 0;
        while (offset < characters.length) {
            let end = offset;
            let bytes = 0;
            while (end < characters.length) {
                const characterBytes = Buffer.byteLength(
                    characters[end] ?? '',
                    'utf8'
                );
                if (end > offset && bytes + characterBytes > chunkSize) {
                    break;
                }
                bytes += characterBytes;
                end += 1;
                if (bytes >= chunkSize) break;
            }
            if (end < characters.length) {
                const candidate = characters.slice(offset, end).join('');
                const hardBreak = candidate.lastIndexOf('\n');
                if (hardBreak > 0) {
                    end =
                        offset +
                        Array.from(candidate.slice(0, hardBreak)).length;
                }
            }
            if (end <= offset) end = offset + 1;
            const text = characters.slice(offset, end).join('').trim();
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
