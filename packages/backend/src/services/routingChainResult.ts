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

export const toRoutingChainFailureReasonCode = (
    reasonCode: ExecutionReasonCode
): RoutingChainFailureReasonCode =>
    reasonCode === 'routing_chain_non_transient_error'
        ? 'routing_chain_non_transient_error'
        : 'routing_chain_exhausted';

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
