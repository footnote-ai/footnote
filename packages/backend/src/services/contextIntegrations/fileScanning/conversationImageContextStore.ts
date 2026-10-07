/**
 * @description: Keeps bounded image-scan results in process for clear follow-up references.
 * Entries are scoped to a chat session and expire from their original scan time.
 * @footnote-scope: utility
 * @footnote-module: ConversationImageContextStore
 * @footnote-risk: medium - Incorrect expiry or scope could reuse stale or cross-conversation image facts.
 * @footnote-ethics: high - Retained image-derived facts can reveal sensitive user context.
 */
import type { ContextStepResult } from '../../workflowCore/reviewedChatWorkflow.js';
import { createHash } from 'node:crypto';

const IMAGE_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CONTEXTS_PER_CONVERSATION = 8;
const MAX_ACTIVE_CONVERSATIONS = 1_000;
const MAX_EVIDENCE_CHARS = 1_200;
const MAX_SOURCES = 4;
const MAX_SOURCE_URL_CHARS = 2_048;
const MAX_SOURCE_TEXT_CHARS = 500;
const IMAGE_REFERENCE =
    /\b(this|that|same|previous|earlier)\s+(image|photo|picture)\b|\b(image|photo|picture)\s+(above|earlier|before)\b/i;
const EXPLICIT_REFRESH =
    /\b(refresh|rescan|scan again|search again|look again)\b/i;

export type ImageContextScope = {
    surface: string;
    sessionId: string;
    userId?: string;
};

type StoredScan = {
    imageIdentity: string;
    toolName: string;
    expiresAt: number;
    result: ContextStepResult;
};

type ConversationScans = {
    scans: Map<string, StoredScan>;
};

export type ImageContextLookup =
    | { status: 'reused'; result: ContextStepResult }
    | { status: 'expired' | 'ambiguous' | 'unavailable' | 'ignored' };

const boundedResult = (
    result: ContextStepResult,
    imageUrl: string
): ContextStepResult => {
    if (result.outcome !== 'executed' || 'clarification' in result)
        return result;
    return {
        outcome: 'executed',
        executionContext: result.executionContext,
        ...(result.evidence && {
            evidence: {
                content: result.evidence.content.map((fact) =>
                    fact.slice(0, MAX_EVIDENCE_CHARS)
                ),
            },
        }),
        ...(result.sources && {
            sources: result.sources
                .filter(
                    (source) =>
                        source.url !== imageUrl &&
                        source.url.length <= MAX_SOURCE_URL_CHARS
                )
                .slice(0, MAX_SOURCES)
                .map((source) => ({
                    ...source,
                    title: source.title.slice(0, MAX_SOURCE_TEXT_CHARS),
                    ...(source.snippet !== undefined && {
                        snippet: source.snippet.slice(0, MAX_SOURCE_TEXT_CHARS),
                    }),
                })),
        }),
    };
};

/** Process-local, fixed-expiry cache; no image bytes or cross-session keys are retained. */
export class ConversationImageContextStore {
    private readonly conversations = new Map<string, ConversationScans>();

    constructor() {
        setInterval(() => this.prune(Date.now()), 60_000).unref();
    }

    private key(scope: ImageContextScope): string {
        return createHash('sha256')
            .update(
                JSON.stringify([
                    scope.surface,
                    scope.sessionId,
                    scope.userId ?? '',
                ])
            )
            .digest('hex');
    }

    record(input: {
        scope?: ImageContextScope;
        imageUrl: string;
        result: ContextStepResult;
        now?: number;
    }): void {
        if (!input.scope || input.result.outcome !== 'executed') return;
        const now = input.now ?? Date.now();
        this.prune(now);
        const key = this.key(input.scope);
        const conversation = this.conversations.get(key) ?? {
            scans: new Map<string, StoredScan>(),
        };
        const imageKey = this.imageKey(input.imageUrl);
        const scanKey = `${imageKey}:${input.result.executionContext.toolName}`;
        conversation.scans.delete(scanKey);
        conversation.scans.set(scanKey, {
            imageIdentity: imageKey,
            toolName: input.result.executionContext.toolName,
            expiresAt: now + IMAGE_CONTEXT_TTL_MS,
            result: boundedResult(input.result, input.imageUrl),
        });
        while (conversation.scans.size > MAX_CONTEXTS_PER_CONVERSATION) {
            const oldest = conversation.scans.keys().next().value;
            if (oldest === undefined) break;
            conversation.scans.delete(oldest);
        }
        this.conversations.set(key, conversation);
        while (this.conversations.size > MAX_ACTIVE_CONVERSATIONS) {
            const oldest = this.conversations.keys().next().value;
            if (oldest === undefined) break;
            this.conversations.delete(oldest);
        }
    }

    lookup(input: {
        scope?: ImageContextScope;
        imageUrl?: string;
        toolName: 'file_scan' | 'reverse_image_search';
        refersToImage: boolean;
        refresh: boolean;
        now?: number;
    }): ImageContextLookup {
        if (!input.scope) return { status: 'unavailable' };
        if (!input.refersToImage) return { status: 'ignored' };
        if (input.refresh) return { status: 'unavailable' };

        const now = input.now ?? Date.now();
        const key = this.key(input.scope);
        const conversation = this.conversations.get(key);
        if (!conversation) return { status: 'unavailable' };
        const scans = [...conversation.scans.values()];
        const imageKey = input.imageUrl
            ? this.imageKey(input.imageUrl)
            : undefined;
        const candidates = imageKey
            ? scans.filter(
                  (scan) =>
                      scan.imageIdentity === imageKey &&
                      scan.toolName === input.toolName
              )
            : scans.filter((scan) => scan.toolName === input.toolName);
        const selected = candidates.filter((scan) => now < scan.expiresAt);
        const result: ImageContextLookup =
            selected.length > 1
                ? { status: 'ambiguous' }
                : selected[0]
                  ? { status: 'reused', result: selected[0].result }
                  : candidates.length > 0
                    ? { status: 'expired' }
                    : { status: 'unavailable' };
        this.prune(now);
        return result;
    }

    private prune(now: number): void {
        for (const [key, conversation] of this.conversations) {
            for (const [imageUrl, scan] of conversation.scans) {
                if (now >= scan.expiresAt) conversation.scans.delete(imageUrl);
            }
            if (conversation.scans.size === 0) this.conversations.delete(key);
        }
    }

    private imageKey(imageUrl: string): string {
        return createHash('sha256').update(imageUrl).digest('hex');
    }
}

export const isImageContextReference = (text: string): boolean =>
    IMAGE_REFERENCE.test(text);

export const isImageContextRefresh = (text: string): boolean =>
    EXPLICIT_REFRESH.test(text);

export const imageContextIntegrationStatus = (
    kind: 'file_scan' | 'reverse_image_search',
    disposition:
        | ImageContextLookup['status']
        | 'scanned'
        | 'refreshed'
        | 'not_retained'
        | 'provider_unavailable'
        | 'provider_failed'
        | 'provider_partial'
): {
    kind: 'file_scan' | 'reverse_image_search';
    version: 'v1';
    payload: {
        metadata: { status: 'current' | 'partial' | 'unavailable' };
        disposition: string;
    };
} => ({
    kind,
    version: 'v1',
    payload: {
        metadata: {
            status:
                disposition === 'expired' ||
                disposition === 'ambiguous' ||
                disposition === 'unavailable' ||
                disposition === 'provider_unavailable' ||
                disposition === 'provider_failed'
                    ? 'unavailable'
                    : disposition === 'provider_partial'
                      ? 'partial'
                      : 'current',
        },
        disposition,
    },
});
