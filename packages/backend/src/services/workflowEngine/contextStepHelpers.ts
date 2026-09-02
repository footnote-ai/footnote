/**
 * @description: Shared helpers for context-step executor selection and
 * follow-up search hint selection in workflow execution.
 * @footnote-scope: core
 * @footnote-module: WorkflowEngineContextStepHelpers
 * @footnote-risk: low - Incorrect selection can skip an optional context path.
 * @footnote-ethics: medium - Hint selection must not change evidence authority.
 */
import type {
    ContextStepRequest,
    ContextStepResult,
    ContextStepExecutor,
} from '../workflowCore/reviewedChatWorkflow.js';
import type { GenerationRequest } from '@footnote/agent-runtime';

type FollowUpSearchHint = {
    query: string;
    intent: 'repo_explainer' | 'current_facts';
    priority: 'low' | 'medium' | 'high';
};

/**
 * Selects the context-step executor with explicit authority precedence.
 * Registry-owned executors take priority when the integration key is an own
 * property; otherwise the shared injected executor is used as fail-open
 * fallback.
 */
export const selectContextStepExecutor = (
    request: ContextStepRequest,
    contextStepExecutor: ContextStepExecutor | undefined,
    contextStepExecutorRegistry: Record<string, ContextStepExecutor> | undefined
): ContextStepExecutor | undefined => {
    const hasRegistryExecutor =
        contextStepExecutorRegistry !== undefined &&
        Object.prototype.hasOwnProperty.call(
            contextStepExecutorRegistry,
            request.integrationName
        );
    const registryExecutor = hasRegistryExecutor
        ? contextStepExecutorRegistry[request.integrationName]
        : undefined;
    if (registryExecutor !== undefined) {
        return registryExecutor;
    }
    return contextStepExecutor;
};

/**
 * Picks a single native-search hint from context-step outputs when OpenAI
 * follow-up search is enabled. Returns undefined fail-open when hints are
 * missing or malformed.
 */
export const selectFollowUpSearchHint = (input: {
    results: ContextStepResult[];
    openAiNativeSearchFromHintsEnabled: boolean;
    effectiveGenerationRequest: GenerationRequest;
}):
    | {
          query: string;
          intent: 'repo_explainer' | 'current_facts';
          contextSize: 'low';
      }
    | undefined => {
    if (!input.openAiNativeSearchFromHintsEnabled) {
        return undefined;
    }
    if (input.effectiveGenerationRequest.provider !== 'openai') {
        return undefined;
    }
    const webSearchStep = input.results.find(
        (result) => result.integrationContext?.kind === 'web_search'
    );
    const payload = webSearchStep?.integrationContext?.payload;
    if (
        payload === undefined ||
        payload === null ||
        typeof payload !== 'object' ||
        Array.isArray(payload)
    ) {
        return undefined;
    }
    const rawHints = (payload as { searchHints?: unknown }).searchHints;
    if (!Array.isArray(rawHints)) {
        return undefined;
    }
    const hints = rawHints
        .map((hint) => {
            if (
                hint === null ||
                typeof hint !== 'object' ||
                Array.isArray(hint)
            ) {
                return undefined;
            }
            const hintRecord = hint as Record<string, unknown>;
            const query =
                typeof hintRecord.query === 'string'
                    ? hintRecord.query.trim()
                    : '';
            if (query.length === 0) {
                return undefined;
            }
            const intent =
                hintRecord.intent === 'repo_explainer'
                    ? 'repo_explainer'
                    : 'current_facts';
            const priority =
                hintRecord.priority === 'high' ||
                hintRecord.priority === 'medium' ||
                hintRecord.priority === 'low'
                    ? hintRecord.priority
                    : 'medium';
            return { query, intent, priority } satisfies FollowUpSearchHint;
        })
        .filter((hint): hint is FollowUpSearchHint => hint !== undefined)
        .sort((left, right) => {
            const weight = (priority: FollowUpSearchHint['priority']) =>
                priority === 'high' ? 3 : priority === 'medium' ? 2 : 1;
            return weight(right.priority) - weight(left.priority);
        });
    const selected = hints[0];
    if (!selected) {
        return undefined;
    }
    return {
        query: selected.query,
        intent: selected.intent,
        contextSize: 'low',
    };
};
