/**
 * @description: Publishes the isolated Starlight output beneath the existing Vite artifact.
 * @footnote-scope: web
 * @footnote-module: WikiDistPublisher
 * @footnote-risk: medium - Copy errors can ship an incomplete public site or erase the React artifact.
 * @footnote-ethics: medium - The published site must remain a truthful projection of canonical docs.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const astroOutput = path.join(packageRoot, 'wiki', '.astro-dist');
const webOutput = path.join(packageRoot, 'dist', 'wiki');

await fs.rm(webOutput, { recursive: true, force: true });
await fs.cp(astroOutput, webOutput, { recursive: true });
