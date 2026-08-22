/**
 * @description: Builds the deployment context bundle from one Git revision.
 * The bundle never reads document bytes from the working tree.
 * @footnote-scope: utility
 * @footnote-module: PrepareProjectContextBundle
 * @footnote-risk: high - Packaging the wrong revision would create false provenance.
 * @footnote-ethics: high - Users must distinguish committed evidence from local edits.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const revisionPattern = /^[0-9a-f]{7,64}$/u;
const categories = new Set([
    'documented_intent',
    'documented_behavior',
    'current_state',
]);
const repositoryRoot = process.cwd();
const bundleRoot = path.join(repositoryRoot, '.footnote', 'context-bundle');

const gitShow = async (revision, filePath) => {
    const { stdout } = await execFileAsync(
        'git',
        ['-C', repositoryRoot, 'show', `${revision}:${filePath}`],
        { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
    );
    return stdout;
};

const isSafeRelativePath = (filePath) => {
    const normalized = filePath.replaceAll('\\', '/');
    return (
        normalized.length > 0 &&
        !path.posix.isAbsolute(normalized) &&
        !normalized.split('/').includes('..')
    );
};

const { stdout: revisionOutput } = await execFileAsync(
    'git',
    ['-C', repositoryRoot, 'rev-parse', '--verify', 'HEAD^{commit}'],
    { encoding: 'utf8' }
);
const revision = revisionOutput.trim();
if (!revisionPattern.test(revision)) {
    throw new Error(`Unable to resolve a valid context revision: ${revision}`);
}

const allowlistContents = await gitShow(revision, '.footnote/context-files');
const manifestContents = await gitShow(
    revision,
    '.footnote/context-manifest.json'
);
const manifest = JSON.parse(manifestContents);
if (!Array.isArray(manifest) || manifest.length === 0) {
    throw new Error('The project-context manifest must contain entries.');
}

const manifestPaths = new Set();
for (const entry of manifest) {
    if (
        entry === null ||
        typeof entry !== 'object' ||
        typeof entry.path !== 'string' ||
        !isSafeRelativePath(entry.path) ||
        !categories.has(entry.category) ||
        typeof entry.priority !== 'number' ||
        !Number.isFinite(entry.priority)
    ) {
        throw new Error(
            'The project-context manifest contains an invalid entry.'
        );
    }
    const normalizedPath = entry.path.replaceAll('\\', '/');
    if (manifestPaths.has(normalizedPath)) {
        throw new Error(
            `The project-context manifest repeats ${normalizedPath}.`
        );
    }
    manifestPaths.add(normalizedPath);
}

await fs.rm(bundleRoot, { recursive: true, force: true });
await fs.mkdir(bundleRoot, { recursive: true });
await fs.writeFile(
    path.join(bundleRoot, 'revision.txt'),
    `${revision}\n`,
    'utf8'
);
await fs.writeFile(
    path.join(bundleRoot, 'context-files'),
    allowlistContents,
    'utf8'
);
await fs.writeFile(
    path.join(bundleRoot, 'context-manifest.json'),
    manifestContents,
    'utf8'
);

for (const filePath of manifestPaths) {
    const content = await gitShow(revision, filePath);
    const destination = path.join(bundleRoot, filePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content, 'utf8');
}

console.log(
    `Prepared ${manifestPaths.size} project-context files from ${revision}.`
);
