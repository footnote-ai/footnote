/**
 * @description: Loads approved project documents, splits them into excerpts, and labels their content.
 * The backend reads file contents here; the helper script only previews allowed paths.
 * @footnote-scope: core
 * @footnote-module: ProjectContextDocumentLoader
 * @footnote-risk: medium - Chunking and labels decide which document text reaches the prompt.
 * @footnote-ethics: high - A document label must not claim that static text proves implementation.
 */
import { createHash } from 'node:crypto';
import type { ProjectContextCategory } from '@footnote/contracts/policy';

export type ProjectDocumentSource = {
    path: string;
    content: string;
    /** Explicit manifest classification; path heuristics are only a fallback. */
    category?: ProjectContextCategory;
    /** Higher-priority manifest entries are admitted before lower-priority entries. */
    priority?: number;
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
 * Assigns a default category when the manifest does not provide one.
 *
 * Status documents describe current state. Architecture and decision documents
 * describe behavior. Other documents describe intent. The labels describe the
 * document; they do not prove implementation.
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

const utf8ByteWidth = (character: string): number => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) return 1;
    if (codePoint <= 0x7ff) return 2;
    if (codePoint <= 0xffff) return 3;
    return 4;
};

/**
 * Splits one document into stable excerpts within the configured size limit.
 *
 * Prefers Markdown headings so an excerpt keeps its heading. Falls back to
 * byte splits when needed to stay within the configured limit.
 */
export const chunkProjectDocument = (
    source: ProjectDocumentSource,
    options: ChunkProjectDocumentOptions
): ProjectDocumentChunk[] => {
    const category = source.category ?? options.categoryForPath(source.path);
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
                const characterBytes = utf8ByteWidth(characters[end] ?? '');
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
