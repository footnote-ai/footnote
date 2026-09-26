/**
 * @description: Canonicalizes provider issuer values for stable external identity keys.
 * @footnote-scope: core
 * @footnote-module: ExternalIdentityKey
 * @footnote-risk: high - Inconsistent issuer keys can split one person across accounts or authorization paths.
 * @footnote-ethics: high - Stable identity matching protects account ownership and administrator boundaries.
 */

/**
 * Uses the URL parser's canonical representation while preserving the issuer
 * path that distinguishes OIDC tenants.
 */
export const canonicalizeIdentityIssuer = (issuer: string): string => {
    const parsed = new URL(issuer);
    if (parsed.pathname !== '/') {
        parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }
    return parsed.href;
};

export const buildExternalIdentityKey = (
    issuer: string,
    subject: string
): string => `${canonicalizeIdentityIssuer(issuer)}|${subject}`;
