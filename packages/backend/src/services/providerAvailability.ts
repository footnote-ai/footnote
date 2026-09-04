/**
 * @description: Maintains bounded process-local temporary provider availability state for automatic routing.
 * @footnote-scope: core
 * @footnote-module: ProviderAvailability
 * @footnote-risk: medium - Over-broad or unbounded state could suppress valid provider routes.
 * @footnote-ethics: medium - Availability claims affect whether users receive a provider response and must remain conservative.
 */

import type { ProviderTemporaryUnavailableReason } from '@footnote/agent-runtime';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 16;

export type TemporaryProviderUnavailableState = {
    provider: string;
    reason: ProviderTemporaryUnavailableReason;
    expiresAtMs: number;
};

export interface ProviderAvailabilityStore {
    get(provider: string): TemporaryProviderUnavailableState | undefined;
    mark(provider: string, reason: ProviderTemporaryUnavailableReason): void;
    clear(provider: string): void;
    size(): number;
}

const normalizeProviderKey = (provider: string): string =>
    provider.trim().toLowerCase();

/** Creates a deterministic, lazy-expiring, bounded availability store. */
export const createProviderAvailabilityStore = (input?: {
    now?: () => number;
    ttlMs?: number;
    maxEntries?: number;
}): ProviderAvailabilityStore => {
    const options = input ?? {};
    const now = options.now ?? Date.now;
    const ttlMs =
        Number.isFinite(options.ttlMs) && (options.ttlMs ?? 0) > 0
            ? Math.floor(options.ttlMs ?? DEFAULT_TTL_MS)
            : DEFAULT_TTL_MS;
    const maxEntries =
        Number.isInteger(options.maxEntries) && (options.maxEntries ?? 0) > 0
            ? (options.maxEntries ?? DEFAULT_MAX_ENTRIES)
            : DEFAULT_MAX_ENTRIES;
    const entries = new Map<string, TemporaryProviderUnavailableState>();

    const pruneExpired = (nowMs: number): void => {
        for (const [key, entry] of entries) {
            if (entry.expiresAtMs <= nowMs) {
                entries.delete(key);
            }
        }
    };

    const enforceBound = (): void => {
        while (entries.size > maxEntries) {
            const oldestKey = entries.keys().next().value;
            if (oldestKey === undefined) {
                return;
            }
            entries.delete(oldestKey);
        }
    };

    return {
        get(provider) {
            const key = normalizeProviderKey(provider);
            const nowMs = now();
            pruneExpired(nowMs);
            if (key.length === 0) {
                return undefined;
            }
            return entries.get(key);
        },
        mark(provider, reason) {
            const key = normalizeProviderKey(provider);
            const nowMs = now();
            pruneExpired(nowMs);
            if (key.length === 0) {
                return;
            }
            entries.delete(key);
            entries.set(key, {
                provider: key,
                reason,
                expiresAtMs: nowMs + ttlMs,
            });
            enforceBound();
        },
        clear(provider) {
            const nowMs = now();
            pruneExpired(nowMs);
            entries.delete(normalizeProviderKey(provider));
        },
        size() {
            pruneExpired(now());
            return entries.size;
        },
    };
};

/** Shared per-process state; no persistence or cross-instance claim is made. */
export const defaultProviderAvailabilityStore =
    createProviderAvailabilityStore();
