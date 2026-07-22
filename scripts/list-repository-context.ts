/**
 * @description: Prints the safe, tracked files selected by the repository context allowlist.
 * The preview contains paths and sizes only; it never loads contents or contacts TrustGraph.
 * @footnote-scope: utility
 * @footnote-module: ListRepositoryContext
 * @footnote-risk: low - This read-only command only previews repository file metadata.
 * @footnote-ethics: medium - A clear preview helps contributors catch unintended context selection.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveRepositoryContextFiles } from './lib/repository-context-files.js';

const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
);

const formatBytes = (bytes: number): string => {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.ceil(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const main = async (): Promise<void> => {
    const result = await resolveRepositoryContextFiles({ repositoryRoot });

    console.log('Repository context\n');
    console.log(`${result.files.length} files`);
    console.log(`Total size: ${formatBytes(result.totalBytes)}\n`);
    for (const repositoryFile of result.files) {
        console.log(repositoryFile.path);
    }

    if (result.skipped.length > 0) {
        console.log('\nSkipped:');
        for (const skippedFile of result.skipped) {
            console.log(`${skippedFile.path} — ${skippedFile.reason}`);
        }
    }
};

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Repository context preview failed: ${message}`);
    process.exitCode = 1;
});
