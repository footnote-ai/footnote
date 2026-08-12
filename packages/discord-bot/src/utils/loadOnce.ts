/**
 * @description: Coalesces an asynchronous module load and retains only successful results.
 * Failed loads are deliberately not cached so fail-open callers can retry later.
 * @footnote-scope: utility
 * @footnote-module: LoadOnce
 * @footnote-risk: low - A load failure delays an optional capability but never blocks later retries.
 * @footnote-ethics: low - This helper only controls local resource use and does not make policy decisions.
 */

/**
 * Creates a retryable, concurrent-safe lazy loader.
 *
 * The in-flight promise is shared so simultaneous first uses import one module.
 * A rejected import clears that promise, preserving the bot's fail-open behavior.
 */
export const createLoadOnce = <T>(
    load: () => Promise<T>
): (() => Promise<T>) => {
    let value: T | undefined;
    let inFlight: Promise<T> | undefined;

    return async (): Promise<T> => {
        if (value !== undefined) {
            return value;
        }

        if (!inFlight) {
            inFlight = load()
                .then((loaded: T) => {
                    value = loaded;
                    return loaded;
                })
                .catch((error: unknown) => {
                    inFlight = undefined;
                    throw error;
                });
        }

        return inFlight;
    };
};
