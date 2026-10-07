/**
 * @description: Launches asynchronous work from a void callback and reports failures locally.
 * @footnote-scope: utility
 * @footnote-module: RunAsyncCallback
 * @footnote-risk: low - This only governs rejection handling at event boundaries.
 * @footnote-ethics: low - Callers control the failure log and its data.
 */

/** Keeps promise-returning work from escaping callback interfaces that expect void. */
export const runAsyncCallback = (
    callback: () => Promise<void> | void,
    onError: (error: unknown) => void
): void => {
    try {
        void Promise.resolve(callback()).catch(onError);
    } catch (error) {
        onError(error);
    }
};
