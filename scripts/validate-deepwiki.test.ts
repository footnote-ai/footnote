/**
 * @description: Exercises the DeepWiki configuration validator at its serializable document boundary.
 * @footnote-scope: test
 * @footnote-module: DeepWikiValidatorTests
 * @footnote-risk: low - These tests only validate documentation configuration tooling.
 * @footnote-ethics: low - Fixtures contain synthetic paths and notes without user or provider payloads.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    type DeepWikiDocument,
    validateDeepWiki,
    validateDeepWikiDocument,
} from './validate-deepwiki';

function createNote(content: string): { author: string; content: string } {
    return { author: 'Test', content };
}

function createDocument(pageCount = 1): DeepWikiDocument {
    return {
        repo_notes: [createNote('Keep canonical docs authoritative.')],
        pages: Array.from({ length: pageCount }, (_, index) => ({
            title: index === 0 ? 'Root' : `Page ${index}`,
            purpose: 'Explain one durable concept.',
            entrypoints: ['README.md'],
            page_notes: [createNote('Use durable repository sources.')],
        })),
    };
}

function withTempRepo<T>(
    files: Record<string, string>,
    callback: (repoRoot: string) => T
): T {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwiki-'));
    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = path.join(repoRoot, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
    }

    try {
        return callback(repoRoot);
    } finally {
        fs.rmSync(repoRoot, { force: true, recursive: true });
    }
}

test('accepts a valid document and reports serializable counts', () => {
    const result = validateDeepWikiDocument(createDocument(), process.cwd());

    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(
        JSON.parse(JSON.stringify(result)),
        result,
        'validator results should remain JSON-serializable'
    );
    assert.equal(result.pages, 1);
    assert.equal(result.totalNotes, 2);
});

test('warns when project headroom is exceeded but stays below vendor limits', () => {
    const document = createDocument(29);
    document.repo_notes = Array.from({ length: 62 }, (_, index) =>
        createNote(`Repository note ${index}`)
    );
    document.pages.forEach((page) => {
        page.page_notes = [createNote('Page guidance')];
    });

    const result = validateDeepWikiDocument(document, process.cwd());

    assert.equal(result.errors, 0);
    assert.equal(result.warnings, 2);
    assert.equal(result.pages, 29);
    assert.equal(result.totalNotes, 91);
    assert.ok(
        result.diagnostics.some((diagnostic) =>
            diagnostic.message.includes('page headroom target')
        )
    );
    assert.ok(
        result.diagnostics.some((diagnostic) =>
            diagnostic.message.includes('note headroom target')
        )
    );
});

test('fails hard limits, duplicate entries, and malformed page structure', () => {
    const document = createDocument(31);
    document.pages[0] = {
        title: 'Root',
        purpose: 'Explain one durable concept.',
        entrypoints: ['README.md', 'README.md'],
        page_notes: [createNote('Same note'), createNote('Same note')],
    };
    document.pages[1].title = 'Root';
    document.pages[2].parent = 'Missing';
    document.pages[3].entrypoints = [];
    document.repo_notes = Array.from({ length: 70 }, (_, index) =>
        createNote(`Repository note ${index}`)
    );

    const result = validateDeepWikiDocument(document, process.cwd());
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message);

    assert.ok(messages.some((message) => message.includes('hard page limit')));
    assert.ok(messages.some((message) => message.includes('hard note limit')));
    assert.ok(
        messages.some((message) => message.includes('duplicate page title'))
    );
    assert.ok(
        messages.some((message) => message.includes('duplicate entrypoint'))
    );
    assert.ok(messages.some((message) => message.includes('duplicate note')));
    assert.ok(messages.some((message) => message.includes('missing parent')));
    assert.ok(messages.some((message) => message.includes('entrypoints must')));
});

test('rejects missing parents and parent cycles', () => {
    const document = createDocument(3);
    document.pages[1].parent = 'Page 2';
    document.pages[2].parent = 'Page 1';

    const result = validateDeepWikiDocument(document, process.cwd());

    assert.ok(
        result.diagnostics.some((diagnostic) =>
            diagnostic.message.includes('parent cycle')
        )
    );
});

test('rejects missing and out-of-repository entrypoints', () => {
    const document = createDocument();
    document.pages[0].entrypoints = [
        'missing.md',
        '../outside.md',
        path.join(process.cwd(), 'absolute.md'),
    ];

    const result = withTempRepo({ 'README.md': '# fixture' }, (repoRoot) =>
        validateDeepWikiDocument(document, repoRoot)
    );
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message);

    assert.ok(
        messages.some((message) => message.includes('missing entrypoint'))
    );
    assert.ok(
        messages.some((message) => message.includes('outside the repository'))
    );
});

test('rejects path aliases that reference the same entrypoint', () => {
    const document = createDocument();
    document.pages[0].entrypoints = ['README.md', './README.md'];

    const result = validateDeepWikiDocument(document, process.cwd());

    assert.ok(
        result.diagnostics.some((diagnostic) =>
            diagnostic.message.includes('duplicate entrypoint')
        )
    );
});

test('reads the checked-in configuration through the CLI-facing validator', () => {
    const result = withTempRepo(
        {
            '.devin/wiki.json': JSON.stringify(createDocument(), null, 2),
            'README.md': '# fixture',
        },
        (repoRoot) => validateDeepWiki({ repoRoot })
    );

    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.pages, 1);
});
