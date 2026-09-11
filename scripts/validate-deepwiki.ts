/**
 * @description: Validates the checked-in DeepWiki configuration against Footnote's bounded documentation policy.
 * @footnote-scope: utility
 * @footnote-module: DeepWikiValidator
 * @footnote-risk: medium - A weak validator can allow stale or invalid generated documentation guidance through review.
 * @footnote-ethics: medium - Accurate source boundaries reduce the chance that generated documentation misstates system authority.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type DeepWikiSeverity = 'error' | 'warning';

export interface DeepWikiNote {
    author: string;
    content: string;
}

export interface DeepWikiPage {
    title: string;
    purpose: string;
    parent?: string;
    entrypoints: string[];
    page_notes: DeepWikiNote[];
}

export interface DeepWikiDocument {
    repo_notes: DeepWikiNote[];
    pages: DeepWikiPage[];
}

export interface DeepWikiDiagnostic {
    file: string;
    line: number;
    message: string;
    severity: DeepWikiSeverity;
}

export interface DeepWikiValidationResult {
    diagnostics: DeepWikiDiagnostic[];
    errors: number;
    pageNotes: number;
    pages: number;
    repoNotes: number;
    totalNotes: number;
    warnings: number;
}

export interface DeepWikiValidationOptions {
    repoRoot?: string;
    wikiPath?: string;
}

interface UnknownRecord {
    [key: string]: unknown;
}

const HARD_PAGE_LIMIT = 30;
const HARD_NOTE_LIMIT = 100;
const HEADROOM_PAGE_LIMIT = 28;
const HEADROOM_NOTE_LIMIT = 90;
const WIKI_FILE = '.devin/wiki.json';
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDirectory, '..');

const isRecord = (value: unknown): value is UnknownRecord =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeText = (value: string): string =>
    value.trim().replace(/\s+/gu, ' ');

const createResult = (
    diagnostics: DeepWikiDiagnostic[],
    pages: number,
    repoNotes: number,
    pageNotes: number
): DeepWikiValidationResult => {
    const errors = diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'error'
    ).length;
    const warnings = diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'warning'
    ).length;

    return {
        diagnostics,
        errors,
        pageNotes,
        pages,
        repoNotes,
        totalNotes: repoNotes + pageNotes,
        warnings,
    };
};

const addDiagnostic = (
    diagnostics: DeepWikiDiagnostic[],
    message: string,
    severity: DeepWikiSeverity = 'error'
): void => {
    diagnostics.push({
        file: WIKI_FILE,
        line: 1,
        message,
        severity,
    });
};

const validateNotes = (
    value: unknown,
    label: string,
    diagnostics: DeepWikiDiagnostic[]
): number => {
    if (!Array.isArray(value)) {
        addDiagnostic(diagnostics, `${label} must be a list of note objects`);
        return 0;
    }

    const seenContent = new Set<string>();
    for (const [index, note] of value.entries()) {
        if (!isRecord(note)) {
            addDiagnostic(
                diagnostics,
                `${label}[${index}] must be an object with content and author`
            );
            continue;
        }

        const content = note.content;
        const author = note.author;
        if (
            typeof content !== 'string' ||
            normalizeText(content).length === 0
        ) {
            addDiagnostic(
                diagnostics,
                `${label}[${index}].content must be a nonblank string`
            );
            continue;
        }
        if (typeof author !== 'string' || normalizeText(author).length === 0) {
            addDiagnostic(
                diagnostics,
                `${label}[${index}].author must be a nonblank string`
            );
            continue;
        }

        const normalizedContent = normalizeText(content);
        if (seenContent.has(normalizedContent)) {
            addDiagnostic(
                diagnostics,
                `${label} contains a duplicate note with the same content`
            );
        } else {
            seenContent.add(normalizedContent);
        }
    }

    return value.length;
};

const isInsideRepository = (repoRoot: string, entrypoint: string): boolean => {
    const normalizedEntrypoint = entrypoint.replaceAll('\\', '/');
    if (
        path.isAbsolute(entrypoint) ||
        path.posix.isAbsolute(normalizedEntrypoint)
    ) {
        return false;
    }

    const resolvedPath = path.resolve(repoRoot, entrypoint);
    const relativePath = path.relative(repoRoot, resolvedPath);
    return (
        relativePath === '' ||
        (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
    );
};

const canonicalizeEntrypoint = (repoRoot: string, entrypoint: string): string =>
    path
        .relative(repoRoot, path.resolve(repoRoot, entrypoint))
        .replaceAll(path.sep, '/');

const validateEntrypoints = (
    value: unknown,
    pageLabel: string,
    repoRoot: string,
    diagnostics: DeepWikiDiagnostic[]
): void => {
    if (!Array.isArray(value) || value.length === 0) {
        addDiagnostic(
            diagnostics,
            `${pageLabel} entrypoints must be a non-empty list`
        );
        return;
    }

    const seenEntrypoints = new Set<string>();
    for (const [index, entrypoint] of value.entries()) {
        if (
            typeof entrypoint !== 'string' ||
            normalizeText(entrypoint).length === 0
        ) {
            addDiagnostic(
                diagnostics,
                `${pageLabel} entrypoints[${index}] must be a nonblank string`
            );
            continue;
        }

        const normalizedEntrypoint = entrypoint.replaceAll('\\', '/');
        const canonicalEntrypoint = canonicalizeEntrypoint(
            repoRoot,
            entrypoint
        );
        if (seenEntrypoints.has(canonicalEntrypoint)) {
            addDiagnostic(
                diagnostics,
                `${pageLabel} contains a duplicate entrypoint "${canonicalEntrypoint}"`
            );
        } else {
            seenEntrypoints.add(canonicalEntrypoint);
        }

        if (!isInsideRepository(repoRoot, entrypoint)) {
            addDiagnostic(
                diagnostics,
                `${pageLabel} entrypoint "${normalizedEntrypoint}" is outside the repository`
            );
            continue;
        }

        if (!fs.existsSync(path.resolve(repoRoot, entrypoint))) {
            addDiagnostic(
                diagnostics,
                `${pageLabel} references missing entrypoint "${normalizedEntrypoint}"`
            );
        }
    }
};

const validatePageGraph = (
    pages: Array<UnknownRecord>,
    titles: Map<string, number>,
    diagnostics: DeepWikiDiagnostic[]
): void => {
    const parentByTitle = new Map<string, string>();

    for (const [index, page] of pages.entries()) {
        const title = page.title;
        if (typeof title !== 'string' || normalizeText(title).length === 0) {
            continue;
        }

        const parent = page.parent;
        if (parent === undefined) {
            continue;
        }
        if (typeof parent !== 'string' || normalizeText(parent).length === 0) {
            addDiagnostic(
                diagnostics,
                `page ${index + 1} parent must be a nonblank title`
            );
            continue;
        }

        const normalizedParent = normalizeText(parent);
        if (!titles.has(normalizedParent)) {
            addDiagnostic(
                diagnostics,
                `page "${title}" references missing parent "${normalizedParent}"`
            );
            continue;
        }
        if (normalizedParent === normalizeText(title)) {
            addDiagnostic(
                diagnostics,
                `page "${title}" has a parent cycle through itself`
            );
            continue;
        }
        parentByTitle.set(normalizeText(title), normalizedParent);
    }

    const visited = new Set<string>();
    const active = new Set<string>();
    const visit = (title: string, trail: string[]): void => {
        if (active.has(title)) {
            const cycleStart = trail.indexOf(title);
            const cycle = [...trail.slice(cycleStart), title].join(' -> ');
            addDiagnostic(diagnostics, `parent cycle detected: ${cycle}`);
            return;
        }
        if (visited.has(title)) {
            return;
        }

        active.add(title);
        const parent = parentByTitle.get(title);
        if (parent !== undefined) {
            visit(parent, [...trail, title]);
        }
        active.delete(title);
        visited.add(title);
    };

    for (const title of titles.keys()) {
        visit(title, []);
    }
};

/**
 * Validate a parsed DeepWiki document without returning parser-specific objects.
 *
 * The validator is intentionally fail-open about unknown future fields: it checks the small
 * structure Footnote relies on and leaves unrelated vendor fields untouched.
 */
export const validateDeepWikiDocument = (
    document: unknown,
    repoRoot: string
): DeepWikiValidationResult => {
    const diagnostics: DeepWikiDiagnostic[] = [];
    if (!isRecord(document)) {
        addDiagnostic(
            diagnostics,
            'DeepWiki configuration must be a JSON object'
        );
        return createResult(diagnostics, 0, 0, 0);
    }

    const repoNotesValue = document.repo_notes;
    const pagesValue = document.pages;
    const repoNotes = validateNotes(repoNotesValue, 'repo_notes', diagnostics);
    if (!Array.isArray(pagesValue)) {
        addDiagnostic(diagnostics, 'pages must be a list of page objects');
        return createResult(diagnostics, 0, repoNotes, 0);
    }

    const pages = pagesValue.filter(isRecord);
    const pageCount = pagesValue.length;
    const pageTitles = new Map<string, number>();
    let pageNotes = 0;

    for (const [index, pageValue] of pagesValue.entries()) {
        if (!isRecord(pageValue)) {
            addDiagnostic(diagnostics, `pages[${index}] must be an object`);
            continue;
        }

        const pageLabel = `page ${index + 1}`;
        const title = pageValue.title;
        if (typeof title !== 'string' || normalizeText(title).length === 0) {
            addDiagnostic(
                diagnostics,
                `${pageLabel} title must be a nonblank string`
            );
        } else {
            const normalizedTitle = normalizeText(title);
            if (pageTitles.has(normalizedTitle)) {
                addDiagnostic(
                    diagnostics,
                    `duplicate page title "${normalizedTitle}"`
                );
            } else {
                pageTitles.set(normalizedTitle, index);
            }
        }

        if (
            typeof pageValue.purpose !== 'string' ||
            normalizeText(pageValue.purpose).length === 0
        ) {
            addDiagnostic(
                diagnostics,
                `${pageLabel} purpose must be a nonblank string`
            );
        }

        validateEntrypoints(
            pageValue.entrypoints,
            pageLabel,
            repoRoot,
            diagnostics
        );
        pageNotes += validateNotes(
            pageValue.page_notes,
            `${pageLabel} page_notes`,
            diagnostics
        );
    }

    validatePageGraph(pages, pageTitles, diagnostics);

    const totalNotes = repoNotes + pageNotes;
    if (pageCount > HARD_PAGE_LIMIT) {
        addDiagnostic(
            diagnostics,
            `configuration exceeds the hard page limit of ${HARD_PAGE_LIMIT}: ${pageCount} pages`
        );
    } else if (pageCount > HEADROOM_PAGE_LIMIT) {
        addDiagnostic(
            diagnostics,
            `configuration exceeds the ${HEADROOM_PAGE_LIMIT}-page headroom target: ${pageCount} pages`,
            'warning'
        );
    }

    if (totalNotes > HARD_NOTE_LIMIT) {
        addDiagnostic(
            diagnostics,
            `configuration exceeds the hard note limit of ${HARD_NOTE_LIMIT}: ${totalNotes} notes`
        );
    } else if (totalNotes > HEADROOM_NOTE_LIMIT) {
        addDiagnostic(
            diagnostics,
            `configuration exceeds the ${HEADROOM_NOTE_LIMIT}-note headroom target: ${totalNotes} notes`,
            'warning'
        );
    }

    return createResult(diagnostics, pageCount, repoNotes, pageNotes);
};

/**
 * Read and validate the checked-in DeepWiki configuration.
 *
 * A missing or malformed generated configuration is an error for repository validation, while
 * unknown vendor fields remain valid so DeepWiki can evolve without a local schema framework.
 */
export const validateDeepWiki = ({
    repoRoot = defaultRepoRoot,
    wikiPath = WIKI_FILE,
}: DeepWikiValidationOptions = {}): DeepWikiValidationResult => {
    const resolvedWikiPath = path.resolve(repoRoot, wikiPath);
    let document: unknown;

    try {
        document = JSON.parse(
            fs.readFileSync(resolvedWikiPath, 'utf8')
        ) as unknown;
    } catch (error) {
        const diagnostics: DeepWikiDiagnostic[] = [];
        addDiagnostic(
            diagnostics,
            `could not read or parse ${wikiPath}: ${String(error)}`
        );
        return createResult(diagnostics, 0, 0, 0);
    }

    return validateDeepWikiDocument(document, repoRoot);
};

const main = (): void => {
    const result = validateDeepWiki();
    for (const diagnostic of result.diagnostics) {
        process.stdout.write(`${JSON.stringify(diagnostic)}\n`);
    }
    process.stdout.write(
        `[validate-deepwiki] pages=${result.pages} repo_notes=${result.repoNotes} page_notes=${result.pageNotes} total_notes=${result.totalNotes} errors=${result.errors} warnings=${result.warnings}\n`
    );
    process.exitCode = result.errors > 0 ? 1 : 0;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
