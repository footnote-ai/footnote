/**
 * @description: Translates backend cache intent into supported hosted-provider controls.
 * @footnote-scope: utility
 * @footnote-module: PromptCacheTranslation
 * @footnote-risk: medium - Unsupported hints must not prevent generation.
 * @footnote-ethics: high - Retention settings are not proof of provider deletion.
 */
import type { PromptCacheReceipt } from '@footnote/contracts';
import type { GenerationRequest } from './index.js';

/** Adapter translation shared with the structured OpenAI transport. */
export const translatePromptCache = (
    request: GenerationRequest
):
    | {
          receipt: PromptCacheReceipt;
          native: Record<string, unknown>;
          sdk: Record<string, unknown>;
          breakpoint?: { mode: 'explicit'; ttl: '30m' | '12h' };
          prefixMessages?: number;
      }
    | undefined => {
    const policy = request.promptCache;
    if (policy === undefined) return undefined;
    const prefix = request.messages.slice(0, policy.stablePrefixMessages);
    const validPrefix =
        Number.isSafeInteger(policy.stablePrefixMessages) &&
        policy.stablePrefixMessages > 0 &&
        prefix.length === policy.stablePrefixMessages &&
        prefix.every(
            (message) => message.role === 'system' && message.cacheable === true
        );
    const receipt: PromptCacheReceipt = {
        mode: 'unsupported',
        purpose: policy.purpose,
        surface: policy.surface,
        ...(policy.ttlSeconds === undefined
            ? {}
            : { requestedTtlSeconds: policy.ttlSeconds }),
        stablePrefixTokensEstimate: Math.ceil(
            prefix.reduce((sum, message) => sum + message.content.length, 0) / 4
        ),
    };
    const unsupported = (reason: PromptCacheReceipt['omissionReason']) => ({
        receipt: { ...receipt, omissionReason: reason },
        native: {},
        sdk: {},
    });
    if (!validPrefix || !/^footnote:cache:v1:[a-f0-9]{64}$/.test(policy.key))
        return unsupported('no_stable_prefix');
    const model = request.model?.replace(/^openrouter\//, '') ?? '';
    const openAiModel =
        request.provider === 'openai'
            ? model.replace(/^openai\//, '')
            : request.provider === 'openrouter' && model.startsWith('openai/')
              ? model.slice(7)
              : undefined;
    if (request.provider === 'openrouter' && model.startsWith('deepseek/')) {
        return {
            receipt: {
                ...receipt,
                mode: 'automatic',
                ...(policy.ttlSeconds === undefined
                    ? {}
                    : { omissionReason: 'unsupported_retention' as const }),
            },
            native: {},
            sdk: {},
        };
    }
    if (
        openAiModel === undefined ||
        !/^gpt-(?:4|5|6)(?:[.\-o]|$)/.test(openAiModel)
    )
        return unsupported('unsupported_provider_or_model');
    const version = /^gpt-(\d+)(?:\.(\d+))?/.exec(openAiModel);
    const modern =
        version !== null &&
        (Number(version[1]) >= 6 ||
            (Number(version[1]) === 5 && Number(version[2] ?? 0) >= 6));
    if (modern) {
        const ttl = policy.ttlSeconds === 43200 ? '12h' : '30m';
        const omission =
            policy.ttlSeconds !== undefined &&
            ![1800, 43200].includes(policy.ttlSeconds);
        return {
            receipt: {
                ...receipt,
                mode: 'explicit',
                appliedTtlSeconds: ttl === '12h' ? 43200 : 1800,
                ...(omission
                    ? { omissionReason: 'unsupported_retention' as const }
                    : {}),
            },
            native: {
                prompt_cache_key: policy.key,
                prompt_cache_options: { mode: 'explicit', ttl: '30m' },
            },
            sdk: {
                promptCacheKey: policy.key,
                promptCacheOptions: { mode: 'explicit', ttl: '30m' },
            },
            // The pinned SDK accepts 30m at request level; block TTL allows the native 12h override.
            breakpoint: { mode: 'explicit', ttl },
            prefixMessages: policy.stablePrefixMessages,
        };
    }
    const extended =
        policy.ttlSeconds === 86400 &&
        /^gpt-5(?:\.(?:1|2|4))?(?:-|$)/.test(openAiModel);
    const retention = extended ? '24h' : 'in_memory';
    return {
        receipt: {
            ...receipt,
            mode: 'automatic',
            ...(extended ? { appliedTtlSeconds: 86400 } : {}),
            ...(policy.ttlSeconds !== undefined && !extended
                ? { omissionReason: 'unsupported_retention' as const }
                : {}),
        },
        native: {
            prompt_cache_key: policy.key,
            prompt_cache_retention: retention,
        },
        sdk: { promptCacheKey: policy.key, promptCacheRetention: retention },
    };
};
