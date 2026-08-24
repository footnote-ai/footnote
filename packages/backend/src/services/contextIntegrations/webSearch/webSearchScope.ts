/**
 * @description: Classifies web-search candidates against an explicit repository scope.
 * @footnote-scope: utility
 * @footnote-module: WebSearchScope
 * @footnote-risk: high - Scope admission controls which provider records become evidence.
 * @footnote-ethics: high - Unrelated project material must not be presented as equivalent evidence.
 */
import type { WebSearchRecord } from './webSearchTypes.js';

export type WebSearchScopeAdmission = 'in_scope' | 'out_of_scope' | 'uncertain';

export type WebSearchScopeDecision = {
    url: string;
    admission: WebSearchScopeAdmission;
    reason:
        | 'canonical_github_repository'
        | 'canonical_project_surface'
        | 'different_github_repository'
        | 'repository_mentioned_without_structural_identity'
        | 'no_repository_scope_signal';
};

const repositoryPattern =
    /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,98}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/;

const normalizedRepository = (value: string): string | undefined => {
    const candidate = value.trim().toLowerCase();
    return repositoryPattern.test(candidate) ? candidate : undefined;
};

const hasRepositoryPath = (pathname: string, repository: string): boolean => {
    const normalizedPath = pathname.replace(/\/+$/u, '').toLowerCase();
    return (
        normalizedPath === `/${repository}` ||
        normalizedPath.startsWith(`/${repository}/`)
    );
};

/**
 * Applies structural admission before a record can become repository evidence.
 * Unknown surfaces remain auditable but are never admitted on text similarity alone.
 */
export const classifyWebSearchRecordScope = (
    record: WebSearchRecord,
    repository: string
): WebSearchScopeDecision => {
    const normalized = normalizedRepository(repository);
    if (normalized === undefined) {
        return {
            url: record.url,
            admission: 'uncertain',
            reason: 'no_repository_scope_signal',
        };
    }

    let parsed: URL;
    try {
        parsed = new URL(record.url);
    } catch {
        return {
            url: record.url,
            admission: 'out_of_scope',
            reason: 'no_repository_scope_signal',
        };
    }

    if (parsed.hostname.toLowerCase() === 'github.com') {
        return hasRepositoryPath(parsed.pathname, normalized)
            ? {
                  url: record.url,
                  admission: 'in_scope',
                  reason: 'canonical_github_repository',
              }
            : {
                  url: record.url,
                  admission: 'out_of_scope',
                  reason: 'different_github_repository',
              };
    }

    if (
        parsed.hostname.toLowerCase() === 'deepwiki.com' &&
        hasRepositoryPath(parsed.pathname, normalized)
    ) {
        return {
            url: record.url,
            admission: 'in_scope',
            reason: 'canonical_project_surface',
        };
    }

    const searchableText =
        `${record.title} ${record.snippet ?? ''}`.toLowerCase();
    return searchableText.includes(normalized)
        ? {
              url: record.url,
              admission: 'uncertain',
              reason: 'repository_mentioned_without_structural_identity',
          }
        : {
              url: record.url,
              admission: 'out_of_scope',
              reason: 'no_repository_scope_signal',
          };
};
