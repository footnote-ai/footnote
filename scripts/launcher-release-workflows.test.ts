/**
 * @description: Verifies launcher release workflows use the reviewed immutable release-action revision.
 * @footnote-scope: test
 * @footnote-module: LauncherReleaseWorkflowTests
 * @footnote-risk: medium - An unreviewed workflow revision can change release behavior or execute untrusted code.
 * @footnote-ethics: low - The test protects the repository's software supply-chain controls without changing user data.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
);
const reviewedReleaseActionRevision =
    'efb35369e0ad2afab669f228072c1b0d510eae64';
const workflowPaths: readonly string[] = [
    '.github/workflows/launcher-release.yml',
    '.github/workflows/launcher-sea-spike.yml',
];

function readReleaseActionReferences(workflowPath: string): string[] {
    const workflow = fs.readFileSync(
        path.join(repositoryRoot, workflowPath),
        'utf8'
    );

    return [
        ...workflow.matchAll(
            /uses:\s*softprops\/action-gh-release@([0-9a-f]+)/g
        ),
    ].map((match: RegExpMatchArray) => match[1]);
}

test('pins every launcher release action to the reviewed immutable revision', () => {
    for (const workflowPath of workflowPaths) {
        assert.deepEqual(
            readReleaseActionReferences(workflowPath),
            [reviewedReleaseActionRevision],
            `${workflowPath} must contain exactly one reviewed release-action pin`
        );
    }
});
