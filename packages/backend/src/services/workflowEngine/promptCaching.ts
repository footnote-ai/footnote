/**
 * @description: Builds cache identity from explicitly trusted stable prompt material.
 * @footnote-scope: core
 * @footnote-module: PromptCaching
 * @footnote-risk: high - Incorrect boundaries can deliberately cache volatile material.
 * @footnote-ethics: high - Identities exclude caller identity, evidence, and user text.
 */
import { createHash } from 'node:crypto';
import type { GenerationRequest } from '@footnote/agent-runtime';
import type { ModelProfile, PromptCachePolicy } from '@footnote/contracts';

/** Finalizes cache intent after selecting the actual route and settings. */
export const applyPromptCaching = <T extends GenerationRequest>(
    request: T,
    profile: ModelProfile | undefined,
    purpose: PromptCachePolicy['purpose'],
    surface: PromptCachePolicy['surface'] = 'unknown'
): T & Pick<GenerationRequest, 'promptCache'> => {
    const result = { ...request };
    delete result.promptCache;
    if (profile?.promptCaching?.enabled !== true) return result;
    const boundary = request.messages.findIndex(
        (message) => message.role !== 'system' || message.cacheable !== true
    );
    const stablePrefixMessages =
        boundary < 0 ? request.messages.length : boundary;
    const digest = createHash('sha256')
        .update(
            JSON.stringify({
                version: 1,
                provider: profile.provider,
                model: profile.providerModel,
                profile: profile.id,
                purpose,
                surface,
                prefix: request.messages
                    .slice(0, stablePrefixMessages)
                    .map((message) => message.content),
                schema: request.structuredOutput,
                search: request.search !== undefined,
            })
        )
        .digest('hex');
    return {
        ...result,
        promptCache: {
            key: `footnote:cache:v1:${digest}`,
            stablePrefixMessages,
            purpose,
            surface,
            ...(profile.promptCaching.ttlSeconds === undefined
                ? {}
                : { ttlSeconds: profile.promptCaching.ttlSeconds }),
        },
    };
};
