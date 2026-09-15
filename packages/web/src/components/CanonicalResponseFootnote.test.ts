/**
 * @description: Verifies the canonical web footnote seam and its accessibility/responsive invariants.
 * @footnote-scope: test
 * @footnote-module: CanonicalResponseFootnoteTests
 * @footnote-risk: low - Static assertions protect the shared presentation seam without adding runtime authority.
 * @footnote-ethics: high - Tests prevent inaccessible or misleading artifact controls from reaching users.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const componentPath = path.join(
    process.cwd(),
    'packages',
    'web',
    'src',
    'components',
    'CanonicalResponseFootnote.tsx'
);
const stylePath = path.join(
    process.cwd(),
    'packages',
    'web',
    'src',
    'styles',
    'canonical-response-footnote.css'
);

test('canonical component accepts projection metadata and explicit artifact states', async () => {
    const source = await readFile(componentPath, 'utf8');

    assert.match(source, /metadata: ResponseFootnote \| null/);
    assert.match(source, /artifacts: ResponseFootnoteArtifactAvailability/);
    assert.match(
        source,
        /projectResponseFootnote\(\{ metadata, artifacts \}\)/
    );
    assert.match(source, /data-response-id=/);
});

test('canonical component uses final values for accessible wheel and bars', async () => {
    const source = await readFile(componentPath, 'utf8');

    assert.match(source, /const final = axis\.final/);
    assert.match(source, /filled\s+radial\s+level\s+is\s+the\s+recorded/);
    assert.match(
        source,
        /aria-labelledby=\{`\$\{titleId\} \$\{descriptionId\}`\}/
    );
    assert.match(source, /role="img"/);
    assert.match(source, /Final unavailable/);
});

test('canonical component preserves inspectable details and truthful disabled actions', async () => {
    const source = await readFile(componentPath, 'utf8');

    assert.match(source, /<summary>Sources<\/summary>/);
    assert.match(source, /<summary>Controls<\/summary>/);
    assert.match(source, /<summary>Details<\/summary>/);
    assert.match(source, /disabled/);
    assert.match(source, /projection\.actions\.trace\.reason/);
    assert.match(source, /encodeURIComponent/);
});

test('canonical styles include light/dark tokens and 320px-safe responsive rules', async () => {
    const styles = await readFile(stylePath, 'utf8');

    assert.match(styles, /--canonical-axis-tightness/);
    assert.match(styles, /\[data-theme='dark'\]/);
    assert.match(styles, /@media \(max-width: 480px\)/);
    assert.match(styles, /@media \(max-width: 700px\)/);
});
