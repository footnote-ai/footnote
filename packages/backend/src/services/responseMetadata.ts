/**
 * @description: Stable provider-neutral export surface for backend response
 * metadata assembly.
 * @footnote-scope: utility
 * @footnote-module: ResponseMetadataExports
 * @footnote-risk: medium - Export drift can break metadata wiring across backend surfaces.
 * @footnote-ethics: medium - Metadata export drift can indirectly impact transparency behavior.
 */

// Owns: stable import surface for backend-owned response metadata helpers.
// Does not own: runtime adapter execution or provider request implementation.

export type {
    GenerationMetadataUsage,
    ResponseMetadataGenerationInput,
    ResponseMetadataRetrievalContext,
    ResponseMetadataRuntimeContext,
} from './responseMetadata/types.js';

export { buildResponseMetadata } from './responseMetadata/metadata.js';
