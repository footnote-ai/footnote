/**
 * @description: Enforces the approved request and estimated-spend ceilings before provider I/O.
 * @footnote-scope: test
 * @footnote-module: CacheProbeBudget
 * @footnote-risk: high - An unbounded probe could spend operator funds.
 * @footnote-ethics: high - Retries count toward the same explicit experiment allowance.
 */
export type CacheProbeBudget = { calls: number; reservedUsd: number };
export type CacheProbePricing = {
    inputPerToken: number;
    outputPerToken: number;
};
export const cacheProbeLimits = {
    maxCalls: 16,
    maxEstimatedUsd: 0.15,
    maxRequestBytes: 12000,
    maxOutputTokens: 64,
} as const;

/** Reserves every wire request, including SDK retries, using a conservative byte/token upper bound. */
export const reserveCacheProbeRequest = (
    budget: CacheProbeBudget,
    body: string,
    pricing: CacheProbePricing
): void => {
    if (Buffer.byteLength(body, 'utf8') > cacheProbeLimits.maxRequestBytes)
        throw new Error('Probe input exceeds its short-context bound.');
    const request = JSON.parse(body) as Record<string, unknown>;
    const output =
        request.max_output_tokens ??
        request.max_completion_tokens ??
        request.max_tokens;
    if (
        typeof output !== 'number' ||
        !Number.isSafeInteger(output) ||
        output < 1 ||
        output > cacheProbeLimits.maxOutputTokens ||
        !Number.isFinite(pricing.inputPerToken) ||
        pricing.inputPerToken <= 0 ||
        !Number.isFinite(pricing.outputPerToken) ||
        pricing.outputPerToken <= 0
    )
        throw new Error('Probe requires known pricing and bounded output.');
    // One UTF-8 byte per token overestimates text input; 2.5x covers the longest supported write tier.
    const reserved =
        Buffer.byteLength(body, 'utf8') * pricing.inputPerToken * 2.5 +
        output * pricing.outputPerToken;
    if (
        !Number.isSafeInteger(budget.calls) ||
        budget.calls < 0 ||
        !Number.isFinite(budget.reservedUsd) ||
        budget.reservedUsd < 0 ||
        budget.calls >= cacheProbeLimits.maxCalls ||
        budget.reservedUsd + reserved > cacheProbeLimits.maxEstimatedUsd
    )
        throw new Error('Cache probe budget exhausted.');
    budget.calls += 1;
    budget.reservedUsd += reserved;
};

/** Persists every reservation before dispatch; failed persistence can never send a request. */
export const dispatchCacheProbeRequest = async (
    budget: CacheProbeBudget,
    body: string,
    pricing: CacheProbePricing,
    persist: () => void,
    send: () => Promise<Response>
): Promise<Response> => {
    reserveCacheProbeRequest(budget, body, pricing);
    persist();
    return send();
};
