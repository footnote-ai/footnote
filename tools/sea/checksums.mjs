#!/usr/bin/env node
/**
 * @description: Computes SHA256 checksums for SEA artifacts in artifacts/sea.
 * @footnote-scope: utility
 * @footnote-module: SeaChecksums
 * @footnote-risk: low - Checksum script errors affect release integrity metadata, not runtime behavior.
 * @footnote-ethics: low - Integrity metadata improves operator trust in distributed binaries.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const seaRoot = join(repoRoot, 'artifacts', 'sea');

const walk = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((entry) => {
        const target = join(dir, entry.name);
        if (entry.isDirectory()) {
            return walk(target);
        }
        return [target];
    });
};

const files = walk(seaRoot).filter((target) => {
    const file = basename(target);
    return (
        statSync(target).isFile() &&
        !file.endsWith('.sha256') &&
        file !== 'checksums.txt' &&
        file !== 'sea-config.json' &&
        file !== 'footnote.blob'
    );
});

const lines = files
    .map((target) => {
        const digest = createHash('sha256')
            .update(readFileSync(target))
            .digest('hex');
        const relativePath = target
            .slice(seaRoot.length + 1)
            .replace(/\\/g, '/');
        return `${digest}  ${relativePath}`;
    })
    .sort((left, right) => left.localeCompare(right));

writeFileSync(join(seaRoot, 'checksums.txt'), `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${lines.length} checksum entries.`);
