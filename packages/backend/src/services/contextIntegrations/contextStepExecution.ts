/**
 * @description: Shared helpers for context-step execution status shaping and non-blocking task execution.
 * Keeps context-integration status conventions and error handling consistent
 * while preserving continuation behavior when integration work fails.
 * @footnote-scope: utility
 * @footnote-module: ContextStepExecution
 * @footnote-risk: medium - Inconsistent status shaping can confuse workflow telemetry and debugging.
 * @footnote-ethics: medium - Non-blocking integration behavior affects reliability and transparency boundaries.
 */
import type {
    ContextStepResult,
    ContextStepExecutorInput,
} from '../workflowEngine.js';
import type {
    Citation,
    ContextStepIntegrationContext,
    ToolClarification,
    ToolInvocationName,
    ToolInvocationReasonCode,
    ContextPromptMessage,
} from '@footnote/contracts/policy';

type NonBlockingExecutionLogger = {
    warn: (message: string, meta?: Record<string, unknown>) => void;
};

/**
 * Builds a skipped context-step result with canonical skipped execution status.
 * Used when a step is not requested/eligible or intentionally bypassed.
 */
export const buildSkippedContextStepResult = (input: {
    toolName: ToolInvocationName;
    reasonCode: ToolInvocationReasonCode;
    durationMs?: number;
    integrationContext?: ContextStepIntegrationContext;
}): ContextStepResult => ({
    outcome: 'skipped',
    executionContext: {
        toolName: input.toolName,
        status: 'skipped',
        reasonCode: input.reasonCode,
        ...(input.durationMs !== undefined && { durationMs: input.durationMs }),
    },
    ...(input.integrationContext !== undefined && {
        integrationContext: input.integrationContext,
    }),
});

/**
 * Builds an executed context-step result with optional advisory payload fields.
 * Use for successful or non-blocking-complete executions that still continue flow.
 */
export const buildExecutedContextStepResult = (input: {
    toolName: ToolInvocationName;
    durationMs?: number;
    contextMessages?: ContextPromptMessage[];
    contextMessageRole?: 'system' | 'user';
    sources?: Citation[];
    integrationContext?: ContextStepIntegrationContext;
}): ContextStepResult => ({
    outcome: 'executed',
    executionContext: {
        toolName: input.toolName,
        status: 'executed',
        ...(input.durationMs !== undefined && { durationMs: input.durationMs }),
    },
    ...(input.contextMessages !== undefined &&
        input.contextMessages.length > 0 && {
            contextMessages: input.contextMessages,
        }),
    ...(input.contextMessageRole !== undefined && {
        contextMessageRole: input.contextMessageRole,
    }),
    ...(input.sources !== undefined &&
        input.sources.length > 0 && {
            sources: input.sources,
        }),
    ...(input.integrationContext !== undefined && {
        integrationContext: input.integrationContext,
    }),
});

/**
 * Builds a context-step result for tool requests that need user clarification.
 * Clarification is a stop condition before generation, not successful context.
 */
export const buildNeedsClarificationContextStepResult = (input: {
    toolName: ToolInvocationName;
    clarification: ToolClarification;
    durationMs?: number;
    integrationContext?: ContextStepIntegrationContext;
}): ContextStepResult => ({
    outcome: 'needs_clarification',
    executionContext: {
        toolName: input.toolName,
        status: 'executed',
        clarification: input.clarification,
        ...(input.durationMs !== undefined && { durationMs: input.durationMs }),
    },
    clarification: input.clarification,
    ...(input.integrationContext !== undefined && {
        integrationContext: input.integrationContext,
    }),
});

/**
 * Builds a failed context-step result while preserving serializable context output.
 * Fail-open behavior is decided by callers; this helper only shapes failure status.
 */
export const buildFailedContextStepResult = (input: {
    toolName: ToolInvocationName;
    reasonCode: ToolInvocationReasonCode;
    durationMs?: number;
    sources?: Citation[];
    integrationContext?: ContextStepIntegrationContext;
}): ContextStepResult => ({
    outcome: 'failed',
    executionContext: {
        toolName: input.toolName,
        status: 'failed',
        reasonCode: input.reasonCode,
        ...(input.durationMs !== undefined && { durationMs: input.durationMs }),
    },
    ...(input.sources !== undefined &&
        input.sources.length > 0 && {
            sources: input.sources,
        }),
    ...(input.integrationContext !== undefined && {
        integrationContext: input.integrationContext,
    }),
});

/**
 * Executes integration work in a non-blocking wrapper.
 * On success returns `{ status: 'executed', value }`.
 * On error logs once and returns fail-open `{ status: 'degraded', error }`.
 */
export const runNonBlockingIntegrationTask = async <T>(input: {
    integrationName: string;
    logger: NonBlockingExecutionLogger;
    contextStepInput: ContextStepExecutorInput;
    task: () => Promise<T>;
    onErrorMessage: string;
}): Promise<
    | { status: 'executed'; value: T }
    | {
          status: 'degraded';
          error: string;
      }
> => {
    try {
        const value = await input.task();
        return { status: 'executed', value };
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        input.logger.warn(input.onErrorMessage, {
            integrationName: input.integrationName,
            attempt: input.contextStepInput.attempt,
            workflowId: input.contextStepInput.workflowId,
            workflowName: input.contextStepInput.workflowName,
            error: errorMessage,
        });
        return {
            status: 'degraded',
            error: errorMessage,
        };
    }
};
