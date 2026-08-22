/**
 * @description: Builds short provenance summaries for project documents and GitHub results.
 * Shows source status and limits without exposing provider or credential details.
 * @footnote-scope: utility
 * @footnote-module: ContextPresentation
 * @footnote-risk: low - A misleading summary could make a partial source look complete.
 * @footnote-ethics: high - People need to see when a source may be incomplete or out of date.
 */
import type { GitHubContextMetadata } from './types.js';
import type { ProjectContextMetadata } from './projectContext.js';

const STATUS_LABELS: Record<ProjectContextMetadata['status'], string> = {
    current: 'current',
    partial: 'partial',
    stale: 'stale',
    unavailable: 'unavailable',
};

const GITHUB_SECTION_LABELS: Record<string, string> = {
    repository: 'repository records',
    issues: 'issues',
    pulls: 'pull requests',
    releases: 'releases',
    commits: 'commits',
};

const GITHUB_SECTION_SINGULAR_LABELS: Record<string, string> = {
    repository: 'repository record',
    issues: 'issue',
    pulls: 'pull request',
    releases: 'release',
    commits: 'commit',
};

const totalProjectMatches = (metadata: ProjectContextMetadata): number =>
    Object.values(metadata.returnedCounts).reduce(
        (total, count) => total + (count ?? 0),
        0
    );

const formatTimestamp = (
    value: string | undefined,
    label: 'indexed at' | 'fetched at'
): string => (value ? ` ${label} ${value}` : '');

/** Formats project-document metadata for the provenance display. */
export const formatProjectContextSummary = (
    metadata: ProjectContextMetadata
): string => {
    const count = totalProjectMatches(metadata);
    const evidence = `${count} document excerpt${count === 1 ? '' : 's'} retrieved`;
    const coverage =
        ' Results include selected excerpts, not a count of all project documents.';
    return `Project documents: ${STATUS_LABELS[metadata.status]}; ${evidence}${formatTimestamp(metadata.indexedAt, 'indexed at')}.${coverage}`;
};

/** Formats GitHub metadata for the provenance display. */
export const formatGitHubContextSummary = (
    metadata: GitHubContextMetadata
): string => {
    const records = metadata.requestedSections.flatMap((section) => {
        const count = metadata.returnedCounts[section];
        return count === undefined
            ? []
            : [
                  `${count} ${count === 1 ? (GITHUB_SECTION_SINGULAR_LABELS[section] ?? section) : (GITHUB_SECTION_LABELS[section] ?? section)}`,
              ];
    });
    const coverage =
        metadata.maxRecordsPerSection !== undefined &&
        metadata.requestedSections.some(
            (section) =>
                (metadata.returnedCounts[section] ?? 0) >=
                metadata.maxRecordsPerSection!
        )
            ? ' Some results may not be shown; these counts are not repository totals.'
            : '';
    const recordSummary =
        records.length > 0 ? records.join(', ') : 'no records';
    return `GitHub: ${metadata.status}; ${recordSummary} retrieved${formatTimestamp(metadata.fetchTimestamp, 'fetched at')}.${coverage}`;
};

/** Returns the available project-document and GitHub provenance summaries. */
export const buildContextPresentationSummary = (input: {
    projectContext?: ProjectContextMetadata;
    githubContext?: GitHubContextMetadata;
}): string[] => [
    ...(input.projectContext
        ? [formatProjectContextSummary(input.projectContext)]
        : []),
    ...(input.githubContext
        ? [formatGitHubContextSummary(input.githubContext)]
        : []),
];
