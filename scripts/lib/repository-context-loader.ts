/**
 * @description: Keeps the root CLI load API stable while adapting local Git files to shared loader logic.
 * CLI parsing and local checkout authority stay outside the repository-context package.
 * @footnote-scope: utility
 * @footnote-module: RepositoryContextCliLoader
 * @footnote-risk: medium - Incorrect adaptation could load an unintended local file set into TrustGraph.
 * @footnote-ethics: high - The CLI adapter controls which local repository files leave the checkout.
 */

import {
    loadRepositoryContext as loadFromSource,
    type RepositoryContextLoadInput,
} from '@footnote/repository-context/loader';
import { createGitRepositoryContextFileSource } from './repository-context-files.js';

export {
    DEFAULT_REPOSITORY_CONTEXT_REPOSITORY_ID,
    DEFAULT_TRUSTGRAPH_REQUEST_TIMEOUT_MS,
    REPOSITORY_CONTEXT_PATH_PREDICATE,
    REPOSITORY_CONTEXT_REPOSITORY_PREDICATE,
    REPOSITORY_CONTEXT_SHA256_PREDICATE,
} from '@footnote/repository-context/loader';
export type {
    RepositoryContextLoadCounts,
    RepositoryContextLoadItemResult,
    RepositoryContextLoadResult,
    RepositoryContextLoadStatus,
} from '@footnote/repository-context/loader';

export type CliRepositoryContextLoadInput = Omit<
    RepositoryContextLoadInput,
    'fileSource'
> & { repositoryRoot: string };

/** Loads the local CLI selection through the shared backend-neutral reconciliation core. */
export const loadRepositoryContext = async (
    input: CliRepositoryContextLoadInput
): Promise<Awaited<ReturnType<typeof loadFromSource>>> => {
    const { repositoryRoot, ...loadInput } = input;
    return loadFromSource({
        ...loadInput,
        fileSource: createGitRepositoryContextFileSource(repositoryRoot),
    });
};
