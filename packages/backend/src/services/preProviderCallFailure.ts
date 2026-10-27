/**
 * @description: Detects failures raised before a request reaches its provider.
 * @footnote-scope: core
 * @footnote-module: PreProviderCallFailure
 * @footnote-risk: medium - Misclassification can exclude a real provider call from attempt accounting.
 * @footnote-ethics: medium - Call provenance must reflect whether a provider was contacted.
 */

/** Walks error causes safely because provider adapters may wrap setup failures. */
export const isPreProviderCallFailure = (error: unknown): boolean => {
    const seen = new Set<object>();
    let current = error;
    while (
        typeof current === 'object' &&
        current !== null &&
        !seen.has(current)
    ) {
        seen.add(current);
        const candidate = current as {
            preProviderCallFailure?: unknown;
            cause?: unknown;
        };
        if (candidate.preProviderCallFailure === true) return true;
        current = candidate.cause;
    }
    return false;
};
