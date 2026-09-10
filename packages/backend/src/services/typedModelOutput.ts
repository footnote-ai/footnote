/**
 * @description: Validates typed model-step output before a workflow Result is admitted.
 * The path selector uses the resolved capability facts while the validator keeps provider output untrusted.
 * @footnote-scope: core
 * @footnote-module: TypedModelOutput
 * @footnote-risk: high - Admitting an invalid typed result can trigger an unauthorized workflow transition.
 * @footnote-ethics: high - Explicit failures prevent opaque model output from becoming a policy decision.
 */
import type { GenerationResult } from '@footnote/agent-runtime';
import type {
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

/**
 * Chooses the strongest available typed-output transport without making absent
 * capability metadata a hard block. JSON mode is an explicit adapter fact;
 * callers without it retain the existing prompt/parser compatibility path.
 */
export const resolveTypedModelOutputPath = (input: {
    provider?: string;
    capabilities?: ModelProfileCapabilities;
    jsonModeSupport?: ModelCapabilitySupport;
}): TypedModelOutputPath => {
    const profileFacts = resolveModelProfileCapabilityFacts(
        input.capabilities ?? { canUseSearch: false }
    );
    const nativeProvider =
        input.provider === 'openai' || input.provider === 'openrouter';
    if (nativeProvider && profileFacts.structuredOutput !== 'unsupported') {
        return 'native_schema';
    }
    if (nativeProvider && profileFacts.structuredOutput === 'unsupported') {
        return 'json_compatibility';
    }
    if (input.jsonModeSupport === 'supported') {
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
    if (input.result.completion?.status === 'failed') {
        return { valid: false, failure: 'runtime_failed' };
    }
    if (input.result.completion?.status === 'incomplete') {
        return { valid: false, failure: 'incomplete' };
    }
    if (
        input.result.finishReason === 'length' ||
        input.result.finishReason === 'max_tokens'
    ) {
        return { valid: false, failure: 'incomplete' };
    }
    if (
        input.result.finishReason === 'refusal' ||
        input.result.finishReason === 'refused' ||
        input.result.finishReason === 'content-filter' ||
        input.result.finishReason === 'content_filter'
    ) {
        return { valid: false, failure: 'refusal' };
    }
    if (input.result.text.trim().length === 0) {
        return { valid: false, failure: 'empty' };
    }
    try {
        return input.parse(input.result.text);
    } catch {
        return { valid: false, failure: 'malformed' };
    }
};

/** Identifies adapter errors that mean native schema transport is unavailable. */
export const isTypedOutputTransportUnavailable = (error: unknown): boolean => {
    const message =
        error instanceof Error
            ? error.message.toLowerCase()
            : String(error).toLowerCase();
    return (
        message.includes('unsupported') ||
        message.includes('not support') ||
        message.includes('response_format') ||
        message.includes('structured output') ||
        message.includes('schema')
    );
};
