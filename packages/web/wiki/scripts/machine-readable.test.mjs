/**
 * @description: Verifies the machine-readable documentation projection keeps discovery and source metadata intact.
 * @footnote-scope: test
 * @footnote-module: MachineReadableDocumentationTests
 * @footnote-risk: medium - A projection regression can hide or misattribute canonical documentation.
 * @footnote-ethics: high - Machine clients must receive the same bounded, source-owned documentation as human readers.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    renderMachineReadableIndex,
    renderMachineReadableFull,
} from './machine-readable.mjs';

const documents = [
    {
        title: 'Getting Started',
        slug: 'getting-started',
        lifecycle: 'current',
        lastUpdated: '2026-09-14T14:00:00Z',
        publicUrl: '/wiki/getting-started/',
        sourceUrl:
            'https://github.com/footnote-ai/footnote/blob/main/README.md',
        historyUrl:
            'https://github.com/footnote-ai/footnote/commits/main/README.md',
        content: 'Run the documented setup steps.\n',
    },
];

test('renders a discovery index with canonical links and build revision', () => {
    const output = renderMachineReadableIndex({
        documents,
        sourceRevision: '0123456789abcdef',
    });

    assert.match(output, /^# Footnote Documentation\n/mu);
    assert.match(output, /\/wiki\/getting-started\//u);
    assert.match(output, /lifecycle: current/u);
    assert.match(output, /last updated: 2026-09-14T14:00:00Z/u);
    assert.match(output, /source revision: `0123456789abcdef`/u);
});

test('renders full Markdown with explicit unavailable revision semantics', () => {
    const output = renderMachineReadableFull({
        documents,
        sourceRevision: undefined,
    });

    assert.match(output, /source revision: unavailable for this build/u);
    assert.match(output, /canonical source: .*README\.md/u);
    assert.match(output, /Run the documented setup steps\./u);
});
