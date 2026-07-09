/**
 * @description: Loads the checked-in TrustGraph repo snapshot into an operator-provided seed endpoint.
 * This is a manual smoke-test utility; runtime chat requests keep using the configured TrustGraph HTTP adapter.
 * @footnote-scope: utility
 * @footnote-module: LoadTrustGraphRepoSnapshot
 * @footnote-risk: medium - Bad loader behavior can seed misleading advisory evidence for live TrustGraph testing.
 * @footnote-ethics: high - External evidence setup affects provenance visibility and reviewer trust.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../packages/discord-bot/src/utils/logger';
import {
    buildTrustGraphRepoSnapshotSeedPayload,
    readTrustGraphRepoSnapshotFile,
} from './lib/trustgraph-repo-snapshot.js';
import type { ScopeTuple } from '../packages/backend/src/services/executionContractTrustGraph/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const snapshotPath = path.join(
    repoRoot,
    'docs/trustgraph/repo-snapshot.v1.json'
);

const getEnv = (name: string): string | undefined => {
    const value = process.env[name]?.trim();
    return value && value.length > 0 ? value : undefined;
};

const readRequiredEnv = (name: string): string => {
    const value = getEnv(name);
    if (value === undefined) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
};

const resolveSeedScopeTuple = (): ScopeTuple => {
    const userId =
        getEnv('TRUSTGRAPH_SEED_USER_ID') ?? 'repo_snapshot_seed_user';
    const explicitProjectId = getEnv('TRUSTGRAPH_SEED_PROJECT_ID');
    const collectionId = getEnv('TRUSTGRAPH_SEED_COLLECTION_ID');
    const projectId =
        explicitProjectId ??
        (collectionId === undefined ? 'footnote_repo_snapshot' : undefined);

    if (explicitProjectId !== undefined && collectionId !== undefined) {
        throw new Error(
            'Set only one of TRUSTGRAPH_SEED_PROJECT_ID or TRUSTGRAPH_SEED_COLLECTION_ID.'
        );
    }

    return {
        userId,
        ...(projectId !== undefined && { projectId }),
        ...(collectionId !== undefined && { collectionId }),
    };
};

const postSeedPayload = async (input: {
    endpointUrl: string;
    apiToken?: string;
    payload: unknown;
}): Promise<void> => {
    const response = await fetch(input.endpointUrl, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(input.apiToken !== undefined && {
                authorization: `Bearer ${input.apiToken}`,
            }),
        },
        body: JSON.stringify(input.payload),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
            `TrustGraph repo snapshot load failed: ${response.status} ${response.statusText}${
                errorText.trim().length > 0 ? ` - ${errorText.trim()}` : ''
            }`
        );
    }
};

const main = async (): Promise<void> => {
    const endpointUrl = readRequiredEnv('TRUSTGRAPH_SEED_ENDPOINT_URL');
    const apiToken = getEnv('TRUSTGRAPH_SEED_API_TOKEN');
    const scopeTuple = resolveSeedScopeTuple();
    const snapshot = await readTrustGraphRepoSnapshotFile(snapshotPath);
    const payload = buildTrustGraphRepoSnapshotSeedPayload(
        snapshot,
        scopeTuple
    );

    await postSeedPayload({
        endpointUrl,
        apiToken,
        payload,
    });

    logger.info('Loaded TrustGraph repo snapshot seed payload.', {
        endpointUrl,
        sourceCommit: snapshot.sourceCommit,
        itemCount: snapshot.items.length,
        scopeKind:
            scopeTuple.projectId !== undefined
                ? 'project'
                : scopeTuple.collectionId !== undefined
                  ? 'collection'
                  : 'user',
    });
};

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message, { error });
    process.exitCode = 1;
});
