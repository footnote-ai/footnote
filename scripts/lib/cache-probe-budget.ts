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

/** Reserves every wire request, including SDK retries, using a conservative byte/token upper bound. */
export const reserveCacheProbeRequest = (
    budget: CacheProbeBudget,
    body: string,
    pricing: CacheProbePricing
): void => {
    if (Buffer.byteLength(body, 'utf8') > 100000)
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
        output > 1024 ||
        !Number.isFinite(pricing.inputPerToken) ||
        pricing.inputPerToken < 0 ||
        !Number.isFinite(pricing.outputPerToken) ||
        pricing.outputPerToken < 0
    )
        throw new Error('Probe requires known pricing and bounded output.');
    // One UTF-8 byte per token overestimates text input; 2.5x covers the longest supported write tier.
    const reserved =
        Buffer.byteLength(body, 'utf8') * pricing.inputPerToken * 2.5 +
        output * pricing.outputPerToken;
    if (budget.calls >= 60 || budget.reservedUsd + reserved > 2)
        throw new Error('Cache probe budget exhausted.');
    budget.calls += 1;
    budget.reservedUsd += reserved;
};
