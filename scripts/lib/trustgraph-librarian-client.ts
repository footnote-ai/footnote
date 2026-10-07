/**
 * @description: Re-exports TrustGraph Librarian wire types and client from the shared loader package.
 * The CLI keeps its existing import path without owning a duplicate protocol client.
 * @footnote-scope: utility
 * @footnote-module: RepositoryContextLibrarianAdapter
 * @footnote-risk: low - Re-export drift could break existing setup commands.
 * @footnote-ethics: medium - The shared client preserves the same TrustGraph data boundary.
 */

export { TrustGraphLibrarianClient } from '@footnote/repository-context/trustgraph';
export type {
    TrustGraphDocumentMetadata,
    TrustGraphIriTerm,
    TrustGraphLiteralTerm,
    TrustGraphLibrarianClientOptions,
    TrustGraphProcessingMetadata,
    TrustGraphTerm,
    TrustGraphTriple,
} from '@footnote/repository-context/trustgraph';
