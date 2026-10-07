/**
 * @description: Re-exports the setup-time repository-context selection and TrustGraph loader core.
 * Source access stays with the CLI or backend caller that owns the approved files.
 * @footnote-scope: interface
 * @footnote-module: RepositoryContextIndex
 * @footnote-risk: low - Incorrect exports could prevent setup callers from using the shared core.
 * @footnote-ethics: medium - The package boundary keeps context access with its authorized source.
 */

export * from './files.js';
export * from './loader.js';
export * from './trustgraph-librarian-client.js';
