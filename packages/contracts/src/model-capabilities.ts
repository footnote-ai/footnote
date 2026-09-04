/**
 * @description: Represents model and runtime control support without treating absent metadata as unsupported.
 * These facts are serializable inputs for backend-owned request resolution and adapter forwarding.
 * @footnote-scope: core
 * @footnote-module: ModelCapabilityFacts
 * @footnote-risk: medium - Incorrect intersections can forward unsupported controls or hide usable ones.
 * @footnote-ethics: medium - Truthful support states prevent Footnote from claiming controls were available when they were not.
 */
import type {
    ModelProfileCapabilities,
    PresentationSamplingControl,
} from './model-profiles.js';
import {
    supportedReasoningEfforts,
    supportedVerbosityLevels,
    type SupportedReasoningEffort,
    type SupportedVerbosity,
} from './providers.js';

/** A capability is explicitly available, explicitly unavailable, or not yet described. */
export const modelCapabilitySupportStates = [
    'supported',
    'unsupported',
    'unknown',
] as const;
export type ModelCapabilitySupport =
    (typeof modelCapabilitySupportStates)[number];

/** Serializable control support facts supplied by either a selected model or an active runtime. */
export interface ModelCapabilityFacts {
    reasoningEfforts: Record<SupportedReasoningEffort, ModelCapabilitySupport>;
    verbosity: Record<SupportedVerbosity, ModelCapabilitySupport>;
    temperature: ModelCapabilitySupport;
    topP: ModelCapabilitySupport;
    outputLimit: ModelCapabilitySupport;
    structuredOutput: ModelCapabilitySupport;
    nativeSearch: ModelCapabilitySupport;
}

const resolveListedSupport = <T extends string>(
    supported: readonly T[] | undefined,
    value: T
): ModelCapabilitySupport =>
    supported === undefined
        ? 'unknown'
        : supported.includes(value)
          ? 'supported'
          : 'unsupported';

const resolveSamplingSupport = (
    supported: readonly PresentationSamplingControl[] | undefined,
    value: PresentationSamplingControl
): ModelCapabilitySupport => resolveListedSupport(supported, value);

const intersectSupport = (
    model: ModelCapabilitySupport,
    runtime: ModelCapabilitySupport
): ModelCapabilitySupport => {
    if (model === 'unsupported' || runtime === 'unsupported') {
        return 'unsupported';
    }
    return model === 'supported' && runtime === 'supported'
        ? 'supported'
        : 'unknown';
};

/**
 * Projects legacy profile capability metadata into explicit support states.
 * A declared list is authoritative for its controls; omitted metadata remains
 * unknown so routing and request resolution can continue fail-open.
 */
export const resolveModelProfileCapabilityFacts = (
    capabilities: ModelProfileCapabilities
): ModelCapabilityFacts => {
    const structuredOutput =
        capabilities.toolCapabilities?.['generation.structured_output'];
    return {
        reasoningEfforts: Object.fromEntries(
            supportedReasoningEfforts.map((effort) => [
                effort,
                resolveListedSupport(
                    capabilities.supportedReasoningEfforts,
                    effort
                ),
            ])
        ) as ModelCapabilityFacts['reasoningEfforts'],
        verbosity: Object.fromEntries(
            supportedVerbosityLevels.map((level) => [
                level,
                resolveListedSupport(capabilities.supportedVerbosity, level),
            ])
        ) as ModelCapabilityFacts['verbosity'],
        temperature: resolveSamplingSupport(
            capabilities.supportedSamplingControls,
            'temperature'
        ),
        topP: resolveSamplingSupport(
            capabilities.supportedSamplingControls,
            'topP'
        ),
        outputLimit: 'unknown',
        structuredOutput:
            structuredOutput === undefined
                ? 'unknown'
                : structuredOutput
                  ? 'supported'
                  : 'unsupported',
        nativeSearch: capabilities.canUseSearch ? 'supported' : 'unsupported',
    };
};

/**
 * Intersects model/provider facts with adapter facts. Explicit rejection by
 * either layer wins; incomplete information remains unknown rather than false.
 */
export const intersectModelCapabilityFacts = (input: {
    model: ModelCapabilityFacts;
    runtime: ModelCapabilityFacts;
}): ModelCapabilityFacts => ({
    reasoningEfforts: Object.fromEntries(
        supportedReasoningEfforts.map((effort) => [
            effort,
            intersectSupport(
                input.model.reasoningEfforts[effort],
                input.runtime.reasoningEfforts[effort]
            ),
        ])
    ) as ModelCapabilityFacts['reasoningEfforts'],
    verbosity: Object.fromEntries(
        supportedVerbosityLevels.map((level) => [
            level,
            intersectSupport(
                input.model.verbosity[level],
                input.runtime.verbosity[level]
            ),
        ])
    ) as ModelCapabilityFacts['verbosity'],
    temperature: intersectSupport(
        input.model.temperature,
        input.runtime.temperature
    ),
    topP: intersectSupport(input.model.topP, input.runtime.topP),
    outputLimit: intersectSupport(
        input.model.outputLimit,
        input.runtime.outputLimit
    ),
    structuredOutput: intersectSupport(
        input.model.structuredOutput,
        input.runtime.structuredOutput
    ),
    nativeSearch: intersectSupport(
        input.model.nativeSearch,
        input.runtime.nativeSearch
    ),
});
