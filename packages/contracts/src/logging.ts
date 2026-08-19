/**
 * @description: Serializable lifecycle event vocabulary for Footnote runtime logging.
 * @footnote-scope: interface
 * @footnote-module: RuntimeLoggingContracts
 * @footnote-risk: medium - Drift in lifecycle names can break operator automation and readiness interpretation.
 * @footnote-ethics: medium - Accurate readiness and bounded identity fields preserve operator trust and privacy.
 */

export type RuntimeService =
    'backend' | 'discord-bot' | 'launcher' | 'supervisor';

export type RuntimeLifecyclePhase = 'starting' | 'ready';

export type RuntimeReadinessBoundary =
    'discord_client' | 'docker_probe' | 'http_listener' | 'supervision_active';

export type RuntimeLifecycleEventName =
    'footnote.runtime.starting' | 'footnote.runtime.ready';

export type RuntimeIdentity = {
    service: RuntimeService;
    nodeId?: string;
    profileId?: string;
    module?: string;
};

export type RuntimeLifecycleEvent = RuntimeIdentity & {
    event: RuntimeLifecycleEventName;
    phase: RuntimeLifecyclePhase;
    readiness?: RuntimeReadinessBoundary;
};

const EVENT_NAME_BY_PHASE: Record<
    RuntimeLifecyclePhase,
    RuntimeLifecycleEventName
> = {
    starting: 'footnote.runtime.starting',
    ready: 'footnote.runtime.ready',
};

/**
 * Builds a bounded, serializable lifecycle event for operator logs.
 * Logging transports add timestamps and must not add secrets or user content.
 */
export const createRuntimeLifecycleEvent = (
    identity: RuntimeIdentity,
    phase: RuntimeLifecyclePhase,
    readiness?: RuntimeReadinessBoundary
): RuntimeLifecycleEvent => ({
    service: identity.service,
    ...(identity.nodeId !== undefined ? { nodeId: identity.nodeId } : {}),
    ...(identity.profileId !== undefined
        ? { profileId: identity.profileId }
        : {}),
    ...(identity.module !== undefined ? { module: identity.module } : {}),
    event: EVENT_NAME_BY_PHASE[phase],
    phase,
    ...(readiness ? { readiness } : {}),
});
