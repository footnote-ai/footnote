/**
 * @description: Builds exact issuer-and-subject keys for validated external identities.
 * @footnote-scope: core
 * @footnote-module: ExternalIdentityKey
 * @footnote-risk: high - Altering an OIDC issuer can split ownership or weaken authorization matching.
 * @footnote-ethics: high - Stable identity matching protects account ownership and administrator boundaries.
 */

/** The caller must supply an issuer and subject already validated by its trust boundary. */
export const buildExternalIdentityKey = (
    issuer: string,
    subject: string
): string => `${issuer}|${subject}`;
