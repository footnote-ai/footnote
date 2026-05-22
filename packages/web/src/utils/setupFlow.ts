/**
 * @description: Pure helpers for setup-route gating and setup-code parsing.
 * @footnote-scope: utility
 * @footnote-module: SetupFlowUtils
 * @footnote-risk: low - Helper mistakes can misroute setup traffic but stay isolated to web routing logic.
 * @footnote-ethics: medium - Correct setup gating helps operators reach first-run configuration safely.
 */

/**
 * `parseSetupCodeFromHash` parses a URL hash/query fragment and returns the
 * trimmed `code` value, or `null` when `code` is missing/empty.
 * Accepts input with or without a leading `#`.
 */
export const parseSetupCodeFromHash = (hash: string): string | null => {
    const rawHash = hash.startsWith('#') ? hash.slice(1) : hash;
    const params = new URLSearchParams(rawHash);
    const code = params.get('code');
    if (!code) {
        return null;
    }
    const trimmed = code.trim();
    return trimmed.length > 0 ? trimmed : null;
};

/**
 * `shouldRedirectToSetup` returns true only when `setupRequired` is true and
 * `currentPath` does not equal the configured setup `routePath` (`/setup`).
 */
export const shouldRedirectToSetup = ({
    setupRequired,
    routePath,
    currentPath,
}: {
    setupRequired: boolean;
    routePath: '/setup';
    currentPath: string;
}): boolean => setupRequired && currentPath !== routePath;
