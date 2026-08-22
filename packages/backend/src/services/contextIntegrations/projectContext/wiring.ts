/**
 * @description: Assembles the project-context executor from backend runtime config.
 * Keeps provider/api-key wiring outside the executor so the integration stays testable.
 * @footnote-scope: core
 * @footnote-module: ProjectContextRuntimeWiring
 * @footnote-risk: medium - Wiring mistakes can silently disable or overreach doc access.
 * @footnote-ethics: high - Independent embedding config must not implicitly inherit the chat provider.
 */
import {
    createOpenAiEmbeddingRuntime,
    type EmbeddingRuntimeResult,
} from '@footnote/agent-runtime';
import type { RuntimeConfig } from '../../../config/types.js';
import {
    estimateBackendTextCost,
    recordBackendLLMUsage,
} from '../../llmCostRecorder.js';
import { logger } from '../../../utils/logger.js';
import {
    loadGitProjectDocumentSet,
    loadPackagedProjectDocumentSet,
} from './documentSource.js';
import type { ProjectContextStepExecutorOptions } from './index.js';

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
    const embeddingRuntime = apiKey
        ? createOpenAiEmbeddingRuntime({
              apiKey,
              logger: {
                  warn: (message, data) => {
                      logger.warn(message, data);
                  },
                  error: (message, data) => {
                      logger.error(message, data);
                  },
              },
              ...(input.config.embeddingProvider === 'openrouter' && {
                  baseURL: 'https://openrouter.ai/api/v1',
              }),
          })
        : undefined;

    const loadDocuments = async () =>
        (await loadPackagedProjectDocumentSet(input.projectRoot, {
            onSkip: (filePath, reason) =>
                logger.debug('project_context_document_skipped', {
                    filePath,
                    reason,
                }),
        })) ??
        loadGitProjectDocumentSet(input.projectRoot, {
            onSkip: (filePath, reason) =>
                logger.debug('project_context_document_skipped', {
                    filePath,
                    reason,
                }),
        });

    const recordEmbeddingUsage = (
        result: EmbeddingRuntimeResult,
        purpose: 'index' | 'query'
    ): void => {
        if (result.status !== 'success') return;
        const promptTokens = result.promptTokens ?? 0;
        const cost = estimateBackendTextCost(result.model, promptTokens, 0, {
            providerUsageAvailable: result.promptTokens !== undefined,
        });
        recordBackendLLMUsage({
            feature: 'chat_project_context_embedding',
            model: result.model,
            provider: result.provider,
            purpose,
            promptTokens,
            completionTokens: 0,
            totalTokens: result.totalTokens ?? promptTokens,
            ...cost,
            timestamp: Date.now(),
        });
    };

    const embedTexts = async (
        texts: string[],
        signal: AbortSignal,
        purpose: 'index' | 'query'
    ): Promise<EmbeddingRuntimeResult> => {
        if (embeddingRuntime === undefined) {
            return {
                status: 'error',
                reason: `Embedding provider key is not configured for ${input.config.embeddingProvider}.`,
                model: input.config.embeddingModel,
                provider: input.config.embeddingProvider,
            };
        }
        const result = await embeddingRuntime.embed({
            texts,
            model: input.config.embeddingModel,
            provider: input.config.embeddingProvider,
            signal,
        });
        recordEmbeddingUsage(result, purpose);
        return result;
    };

    return {
        enabled: input.config.enabled,
        identity: {
            provider: input.config.embeddingProvider,
            model: input.config.embeddingModel,
            chunkerVersion: 1,
            indexVersion: 1,
        },
        maxChunkBytes: input.config.maxChunkBytes,
        maxChunks: input.config.maxChunks,
        topKPerCategory: input.config.topKPerCategory,
        maxMatches: input.config.maxMatches,
        minScore: input.config.minScore,
        embeddingTimeoutMs: input.config.embeddingTimeoutMs,
        resolveDocuments: loadDocuments,
        embedTexts,
    };
};

export { createProjectContextStepExecutor } from './index.js';
