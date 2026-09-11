/**
 * @description: Validates typed model-step output before a workflow Result is admitted.
 * The path selector uses the resolved capability facts while the validator keeps provider output untrusted.
 * @footnote-scope: core
 * @footnote-module: TypedModelOutput
 * @footnote-risk: high - Admitting an invalid typed result can trigger an unauthorized workflow transition.
 * @footnote-ethics: high - Explicit failures prevent opaque model output from becoming a policy decision.
 */
import {
    isGenerationRuntimeError,
    type GenerationResult,
} from '@footnote/agent-runtime';
import type {
    ModelCapabilityFacts,
    ModelProfileCapabilities,
    ModelCapabilitySupport,
} from '@footnote/contracts';
import { resolveModelProfileCapabilityFacts } from '@footnote/contracts';

/** Ordered transport paths for one typed model-backed Step. */
export type TypedModelOutputPath =
    'native_schema' | 'json_compatibility' | 'parser_compatibility';

/** Bounded classifications for rejected typed output. */
export type TypedModelOutputFailure =
    | 'empty'
    | 'malformed'
    | 'schema_invalid'
    | 'refusal'
    | 'incomplete'
    | 'runtime_failed';

export type TypedModelOutputValidation<T> =
    | { valid: true; value: T }
    | { valid: false; failure: TypedModelOutputFailure };

/** Classifies deterministic generation facts before a parser is invoked. */
export const classifyTypedModelOutputFailure = (
    result: GenerationResult
): TypedModelOutputFailure | undefined => {
    if (result.completion?.status === 'failed') {
        return 'runtime_failed';
    }
    if (
        result.completion?.status === 'incomplete' ||
        result.finishReason === 'length' ||
        result.finishReason === 'max_tokens' ||
        result.finishReason === 'max_output_tokens'
    ) {
        return 'incomplete';
    }
    if (
        result.finishReason === 'refusal' ||
        result.finishReason === 'refused' ||
        result.finishReason === 'content-filter' ||
        result.finishReason === 'content_filter'
    ) {
        return 'refusal';
    }
    if (result.text.trim().length === 0) {
        return 'empty';
    }
    return undefined;
};

/**
 * Chooses the strongest available typed-output transport without making absent
 * capability metadata a hard block. JSON mode is an explicit adapter fact;
 * callers without it retain the existing prompt/parser compatibility path.
 */
export const resolveTypedModelOutputPath = (input: {
    provider?: string;
    capabilities?: ModelProfileCapabilities;
    /** Effective adapter/model facts selected by the integration seam. */
    capabilityFacts?: Pick<
        ModelCapabilityFacts,
        'structuredOutput' | 'jsonMode'
    >;
    /** Legacy JSON-only override; callers should prefer capabilityFacts. */
    jsonModeSupport?: ModelCapabilitySupport;
}): TypedModelOutputPath => {
    const profileFacts = resolveModelProfileCapabilityFacts(
        input.capabilities ?? { canUseSearch: false }
    );
    const nativeProvider =
        input.provider === 'openai' || input.provider === 'openrouter';
    const structuredOutputSupport =
        input.capabilityFacts?.structuredOutput ??
        profileFacts.structuredOutput;
    const jsonModeSupport =
        input.capabilityFacts?.jsonMode ??
        input.jsonModeSupport ??
        profileFacts.jsonMode;
    if (nativeProvider && structuredOutputSupport !== 'unsupported') {
        return 'native_schema';
    }
    if (jsonModeSupport === 'supported') {
        return 'json_compatibility';
    }
    return 'parser_compatibility';
};

/**
 * Validates completion facts and parses the visible payload at the typed-step
 * seam. Parser failures stay bounded and never include provider output text.
 */
export const validateTypedModelOutput = <T>(input: {
    result: GenerationResult;
    parse: (text: string) => TypedModelOutputValidation<T>;
}): TypedModelOutputValidation<T> => {
    const deterministicFailure = classifyTypedModelOutputFailure(input.result);
    if (deterministicFailure !== undefined) {
        return { valid: false, failure: deterministicFailure };
    }
    try {
        return input.parse(input.result.text);
    } catch {
        return { valid: false, failure: 'malformed' };
    }
};

/** Identifies adapter errors that mean native schema transport is unavailable. */
export const isTypedOutputTransportUnavailable = (error: unknown): boolean => {
    return (
        isGenerationRuntimeError(error) &&
        error.details.classification === 'structured_output_unavailable'
    );
};
