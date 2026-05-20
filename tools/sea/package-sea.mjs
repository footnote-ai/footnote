#!/usr/bin/env node
/**
 * @description: Generates platform-local Node SEA blob and injects it into a standalone footnote binary.
 * @footnote-scope: utility
 * @footnote-module: SeaPackage
 * @footnote-risk: high - Incorrect SEA packaging can yield non-functional or misleading release binaries.
 * @footnote-ethics: low - Packaging script affects distribution mechanics, not runtime policy decisions.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const artifactsRoot = join(repoRoot, 'artifacts', 'sea');
const platformTarget = `${process.platform}-${process.arch}`;
const outputDir = join(artifactsRoot, platformTarget);
const ESBUILD_VERSION = '0.28.0';
const launcherEntry = join(
    repoRoot,
    'packages',
    'launcher-cli',
    'dist',
    'bin.js'
);
const bundledEntry = join(outputDir, 'sea-entry.cjs');
const blobPath = join(outputDir, 'footnote.blob');
const seaConfigPath = join(outputDir, 'sea-config.json');

mkdirSync(outputDir, { recursive: true });

const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
        ...options,
    });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
};

const nodeExec = process.execPath;
const nodeExt = extname(nodeExec);
const outputBinary = join(
    outputDir,
    `footnote-${platformTarget}${nodeExt === '.exe' ? '.exe' : ''}`
);

const seaConfig = {
    main: bundledEntry,
    output: blobPath,
    disableExperimentalSEAWarning: true,
};

run('pnpm', [
    'dlx',
    `esbuild@${ESBUILD_VERSION}`,
    launcherEntry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node22',
    `--outfile=${bundledEntry}`,
]);

writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));

run(process.execPath, ['--experimental-sea-config', seaConfigPath]);
copyFileSync(nodeExec, outputBinary);

const isMac = process.platform === 'darwin';
const postjectArgs = [
    'dlx',
    'postject',
    outputBinary,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
];
if (isMac) {
    postjectArgs.push('--macho-segment-name', 'NODE_SEA');
}

run('pnpm', postjectArgs);

const sha256 = createHash('sha256')
    .update(readFileSync(outputBinary))
    .digest('hex');

const fileName = basename(outputBinary);
writeFileSync(
    join(outputDir, `${fileName}.sha256`),
    `${sha256}  ${fileName}\n`
);

console.log(`SEA binary ready: ${outputBinary}`);
