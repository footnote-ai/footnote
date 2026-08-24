/**
 * @description: Canonical context-integration vocabulary shared across packages.
 * Defines stable integration identifiers used by planner, orchestration, and
 * execution metadata.
 * @footnote-scope: interface
 * @footnote-module: ContextIntegrationContracts
 * @footnote-risk: low - Identifier drift can break integration routing and telemetry matching.
 * @footnote-ethics: medium - Stable naming keeps provenance and governance interpretation consistent.
 */
export const CONTEXT_INTEGRATION_NAMES = [
    'weather_forecast',
    'web_search',
    'file_scan',
    'trustgraph',
    'reverse_image_search',
    'github_context',
    'project_context',
] as const;

export type ContextIntegrationName =
    (typeof CONTEXT_INTEGRATION_NAMES)[number] | (string & {});

/** Serializable GitHub object kinds accepted by bounded exact retrieval. */
export type GitHubObjectReference =
    | { kind: 'pull_request'; number: number }
    | { kind: 'issue'; number: number }
    | { kind: 'commit'; sha: string }
    | { kind: 'release'; tag: string };

/** Repository-qualified reference used across planner and context boundaries. */
export type GitHubContextReference = {
    repository: string;
    reference: GitHubObjectReference;
};
