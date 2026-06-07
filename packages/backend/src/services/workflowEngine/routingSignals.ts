/**
 * @description: Shared signal-shaping helpers for workflow routing-chain telemetry and assess hint lineage.
 * @footnote-scope: core
 * @footnote-module: WorkflowEngineRoutingSignals
 * @footnote-risk: low - Signal mapping drift affects observability metadata only.
 * @footnote-ethics: medium - Routing and hint signals support governance interpretation.
 */
import {
    buildWorkflowAssessRoutingHintSignals,
    buildWorkflowRoutingChainSignals,
} from '@footnote/contracts/policy';
import type {
    StepSignals,
    WorkflowAssessRoutingHintSignals,
    WorkflowRoutingHintConflictResolution,
    WorkflowRoutingHintLane,
} from '@footnote/contracts/policy';
import type { RoutingChainAttemptLog } from '../stepRoutingExecutor.js';

export type {
    WorkflowRoutingHintConflictResolution,
    WorkflowRoutingHintLane,
} from '@footnote/contracts/policy';

export const buildRoutingChainSignals = (input: {
    attempts?: RoutingChainAttemptLog[];
    selectedProfileId?: string | null;
    selectedProvider?: string | null;
    selectedModel?: string | null;
    signalKeys?: {
        profileId?: string;
        provider?: string;
        model?: string;
    };
}): StepSignals => buildWorkflowRoutingChainSignals(input);

export const buildAssessRoutingHintSignals = (input: {
    assessRoutingHintsCsv?: string;
    routingHintApplied?: WorkflowRoutingHintLane;
    routingHintConflictResolved?: WorkflowRoutingHintConflictResolution;
}): WorkflowAssessRoutingHintSignals =>
    buildWorkflowAssessRoutingHintSignals(input);
