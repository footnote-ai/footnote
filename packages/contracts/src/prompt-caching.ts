/**
 * @description: Defines serializable prompt-cache intent and text-free execution receipts.
 * @footnote-scope: interface
 * @footnote-module: PromptCachingContracts
 * @footnote-risk: medium - Incorrect receipts can misrepresent retention and support.
 * @footnote-ethics: high - Cache identities and prompt content stay out of public receipts.
 */
import { z } from 'zod';

/** Backend-owned intent for one model request; keys never contain caller data. */
export interface PromptCachePolicy {
    key: string;
    enabled?: boolean;
    promptVersion?: string;
    profileVersion?: string;
    stablePrefixMessages: number;
    ttlSeconds?: number;
    purpose:
        | 'planner'
        | 'generation'
        | 'assessment'
        | 'revision'
        | 'condensation'
        | 'presentation';
    surface: 'web' | 'discord' | 'unknown';
}

export const PromptCacheReceiptSchema = z
    .object({
        mode: z.enum(['automatic', 'explicit', 'unsupported', 'disabled']),
        promptVersion: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        profileVersion: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        purpose: z.enum([
            'planner',
            'generation',
            'assessment',
            'revision',
            'condensation',
            'presentation',
        ]),
        surface: z.enum(['web', 'discord', 'unknown']),
        requestedTtlSeconds: z.number().int().positive().max(86400).optional(),
        appliedTtlSeconds: z.number().int().positive().max(86400).optional(),
        omissionReason: z
            .enum([
                'unsupported_provider_or_model',
                'unsupported_retention',
                'no_stable_prefix',
            ])
            .optional(),
        /** Approximation, never a provider eligibility claim. */
        stablePrefixTokensEstimate: z.number().int().nonnegative(),
    })
    .strict();
export type PromptCacheReceipt = z.infer<typeof PromptCacheReceiptSchema>;

/** Derived from canonical model Attempts, never Step plus Attempt totals. */
export const PromptCacheSummarySchema = z
    .object({
        purpose: z.enum([
            'planner',
            'generation',
            'assessment',
            'revision',
            'condensation',
            'presentation',
            'unknown',
        ]),
        provider: z.string().max(128),
        model: z.string().max(256),
        surface: z.enum(['web', 'discord', 'unknown']),
        promptVersion: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        profileVersion: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        attempts: z.number().int().nonnegative(),
        inputReported: z.number().int().nonnegative(),
        readsReported: z.number().int().nonnegative(),
        writesReported: z.number().int().nonnegative(),
        inputTokens: z.number().int().nonnegative().optional(),
        cacheReadTokens: z.number().int().nonnegative().optional(),
        cacheWriteTokens: z.number().int().nonnegative().optional(),
        cacheReadShare: z.number().min(0).max(1).optional(),
        hitRate: z.number().min(0).max(1).optional(),
        cacheWriteReadRatio: z.number().nonnegative().optional(),
        cacheSavingsUsd: z.number().finite().optional(),
        costCompleteness: z.enum(['complete', 'partial', 'unknown']),
        durationMs: z.number().nonnegative().optional(),
    })
    .strict();
export type PromptCacheSummary = z.infer<typeof PromptCacheSummarySchema>;
