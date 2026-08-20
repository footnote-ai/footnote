/**
 * @description: Assembles the project-context executor from backend runtime config.
 * Keeps provider/api-key wiring outside the executor so the integration stays testable.
 * @footnote-scope: core
 * @footnote-module: ProjectContextRuntimeWiring
 * @footnote-risk: medium - Wiring mistakes can silently disable or overreach doc access.
 * @footnote-ethics: high - Independent embedding config must not implicitly inherit the chat provider.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
    createOpenAiEmbeddingRuntime,
    type EmbeddingRuntimeResult,
} from '@footnote/agent-runtime';
import type { RuntimeConfig } from '../../../config/types.js';
import {
    createProjectDocumentSource,
    listGitTrackedPaths,
    readProjectFile,
    resolveHeadCommitSha,
} from './documentSource.js';
import type { ProjectContextStepExecutorOptions } from './index.js';

const CONTEXT_FILES_RELATIVE_PATH = '.footnote/context-files';

export const buildProjectContextWiring = (input: {
    config: RuntimeConfig['chatWorkflow']['contextIntegrations']['projectDocs'];
    projectRoot: string;
    openaiApiKey: string | null;
    openrouterApiKey: string | null;
}): ProjectContextStepExecutorOptions | undefined => {
    if (!input.config.enabled) return undefined;

    const apiKey =
        input.config.embeddingProvider === 'openrouter'
            ? input.openrouterApiKey
            : input.openaiApiKey;
    const embeddingRuntime = createOpenAiEmbeddingRuntime({
        apiKey: apiKey ?? undefined,
        ...(input.config.embeddingProvider === 'openrouter' && {
            baseURL: 'https://openrouter.ai/api/v1',
        }),
    });

    const loadDocuments = async () => {
        let allowlistContents: string;
        try {
            allowlistContents = await fs.readFile(
                path.join(input.projectRoot, CONTEXT_FILES_RELATIVE_PATH),
                'utf8'
            );
        } catch {
            return [];
        }
        const trackedPaths = await listGitTrackedPaths(input.projectRoot);
        const source = createProjectDocumentSource({
            repositoryRoot: input.projectRoot,
            trackedPaths,
            readFile: (filePath) =>
                readProjectFile(input.projectRoot, filePath),
            allowlistContents,
        });
        return source.loadDocuments();
    };

    const embedTexts = async (
        texts: string[]
    ): Promise<EmbeddingRuntimeResult> =>
        embeddingRuntime.embed({
            texts,
            model: input.config.embeddingModel,
            provider: input.config.embeddingProvider,
        });

    return {
        enabled: input.config.enabled,
        repository: input.config.repository,
        identity: {
            provider: input.config.embeddingProvider,
            model: input.config.embeddingModel,
            chunkerVersion: 1,
            indexVersion: 1,
        },
        maxChunkBytes: input.config.maxChunkBytes,
        maxChunks: input.config.maxChunks,
        topKPerCategory: input.config.topKPerCategory,
        resolveDocuments: loadDocuments,
        embedTexts,
        resolveCommitSha: () => resolveHeadCommitSha(input.projectRoot),
    };
};

export { createProjectContextStepExecutor } from './index.js';
