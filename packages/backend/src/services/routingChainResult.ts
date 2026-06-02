/**
 * @description: Converts workflow routing-chain execution outcomes into typed
 * expected-failure Results.
 * @footnote-scope: utility
 * @footnote-module: RoutingChainResult
 * @footnote-risk: medium - Incorrect failure mapping can hide routing exhaustion causes.
 * @footnote-ethics: medium - Routing failure clarity supports auditable fail-open behavior.
 */
import type { ExecutionReasonCode } from '@footnote/contracts/policy';
import { err, ok, type Result } from 'neverthrow';
import type {
    RoutingChainAttemptLog,
    RoutingChainExecutionResult,
} from './stepRoutingExecutor.js';

export type RoutingChainFailureReasonCode = Extract<
    ExecutionReasonCode,
    'routing_chain_exhausted' | 'routing_chain_non_transient_error'
>;

export type RoutingChainFailure = {
    reasonCode: RoutingChainFailureReasonCode;
    attempts: RoutingChainAttemptLog[];
};

export type ExecutedRoutingChainResult<TSuccess> = Extract<
    RoutingChainExecutionResult<TSuccess>,
    { status: 'executed' }
>;

/**
 * Maps a broad ExecutionReasonCode into the collapsed RoutingChainFailureReasonCode set: non-transient failures keep their code, and all other exhausted-chain reasons collapse to routing_chain_exhausted.
 *
 * @param reasonCode Execution reason emitted by the routing-chain executor.
 * @returns RoutingChainFailureReasonCode used by fail-open routing callers.
 */
export const toRoutingChainFailureReasonCode = (
    reasonCode: ExecutionReasonCode
): RoutingChainFailureReasonCode =>
    reasonCode === 'routing_chain_non_transient_error'
        ? 'routing_chain_non_transient_error'
        : 'routing_chain_exhausted';

/**
 * Converts a RoutingChainExecutionResult into ok(chainResult) for executed chains or err(RoutingChainFailure) with collapsed reasonCode and attempts for non-executed chains.
 *
 * @param chainResult Routing-chain executor result to convert.
 * @returns Result containing the executed chain or a RoutingChainFailure.
 */
export const toRoutingChainResult = <TSuccess>(
    chainResult: RoutingChainExecutionResult<TSuccess>
): Result<ExecutedRoutingChainResult<TSuccess>, RoutingChainFailure> =>
    chainResult.status === 'executed'
        ? ok(chainResult)
        : err({
              reasonCode: toRoutingChainFailureReasonCode(
                  chainResult.reasonCode
              ),
              attempts: chainResult.attempts,
          });
