/**
 * @description: Summarizes cache observations from canonical model Attempts without a second ledger.
 * @footnote-scope: core
 * @footnote-module: CacheMeasurements
 * @footnote-risk: high - Double counting or absent measurements can create false savings.
 * @footnote-ethics: high - Only allowlisted numeric facts and public model attribution leave this seam.
 */
import type { PromptCacheSummary } from '@footnote/contracts';
import type {
    WorkflowRecord,
    WorkflowAttemptRecord,
    WorkflowAttemptRoutingRecord,
} from '@footnote/contracts/policy';

/** Counts nested executed routes instead of their aggregate parent; unknowns remain unavailable. */
export const summarizePromptCaching = (
    workflow: WorkflowRecord
): PromptCacheSummary[] => {
    type Attempt = WorkflowAttemptRecord | WorkflowAttemptRoutingRecord;
    const groups = new Map<
        string,
        { summary: PromptCacheSummary; values: Attempt[] }
    >();
    for (const step of workflow.steps) {
        if (
            !['plan', 'generate', 'assess', 'presentation'].includes(
                step.stepKind
            )
        )
            continue;
        for (const parent of step.attempts ?? []) {
            const attempts = parent.routingAttempts ?? [parent];
            for (const attempt of attempts) {
                if (
                    attempt.status.startsWith('skipped') ||
                    attempt.status === 'blocked'
                )
                    continue;
                const purpose =
                    attempt.promptCache?.purpose ??
                    (step.stepKind === 'plan'
                        ? 'planner'
                        : step.stepKind === 'assess'
                          ? 'assessment'
                          : step.stepKind === 'presentation'
                            ? 'presentation'
                            : step.outcome.signals?.refinementSourceStepId ===
                                'assess'
                              ? 'revision'
                              : 'generation');
                const provider =
                    attempt.requestedProvider ??
                    parent.requestedProvider ??
                    'unknown';
                const model =
                    attempt.actualModel ??
                    attempt.requestedModel ??
                    parent.requestedModel ??
                    'unknown';
                const surface = attempt.promptCache?.surface ?? 'unknown';
                const promptVersion = attempt.promptCache?.promptVersion;
                const profileVersion = attempt.promptCache?.profileVersion;
                const key = JSON.stringify([
                    purpose,
                    provider,
                    model,
                    surface,
                    promptVersion,
                    profileVersion,
                ]);
                let group = groups.get(key);
                if (group === undefined) {
                    group = {
                        summary: {
                            purpose,
                            provider,
                            model,
                            surface,
                            promptVersion,
                            profileVersion,
                            attempts: 0,
                            inputReported: 0,
                            readsReported: 0,
                            writesReported: 0,
                            costCompleteness: 'unknown',
                        },
                        values: [],
                    };
                    groups.set(key, group);
                }
                group.values.push(attempt);
            }
        }
    }
    return [...groups.values()].map(({ summary, values }) => {
        const sum = (
            read: (attempt: Attempt) => number | undefined
        ): number | undefined => {
            const measurements = values
                .map(read)
                .filter(
                    (value): value is number =>
                        value !== undefined && Number.isFinite(value)
                );
            return measurements.length === 0
                ? undefined
                : measurements.reduce((total, value) => total + value, 0);
        };
        summary.attempts = values.length;
        summary.inputReported = values.filter(
            (attempt) => attempt.usage?.promptTokens !== undefined
        ).length;
        summary.readsReported = values.filter(
            (attempt) => attempt.usage?.cachedInputTokens !== undefined
        ).length;
        summary.writesReported = values.filter(
            (attempt) => attempt.usage?.cacheWriteTokens !== undefined
        ).length;
        summary.inputTokens = sum((attempt) => attempt.usage?.promptTokens);
        summary.cacheReadTokens = sum(
            (attempt) => attempt.usage?.cachedInputTokens
        );
        summary.cacheWriteTokens = sum(
            (attempt) => attempt.usage?.cacheWriteTokens
        );
        if (values.every((attempt) => attempt.durationMs !== undefined))
            summary.durationMs = sum((attempt) => attempt.durationMs);
        const complete = values.every(
            (attempt) => attempt.cost?.costCompleteness === 'complete'
        );
        summary.costCompleteness = complete
            ? 'complete'
            : values.some(
                    (attempt) =>
                        attempt.cost !== undefined &&
                        attempt.cost.costCompleteness !== 'unknown'
                )
              ? 'partial'
              : 'unknown';
        if (summary.readsReported === values.length)
            summary.hitRate =
                values.filter(
                    (attempt) => (attempt.usage?.cachedInputTokens ?? 0) > 0
                ).length / values.length;
        if (
            summary.inputReported === values.length &&
            summary.readsReported === values.length &&
            (summary.inputTokens ?? 0) > 0 &&
            values.every(
                (attempt) =>
                    attempt.usage!.cachedInputTokens! <=
                    attempt.usage!.promptTokens!
            )
        )
            summary.cacheReadShare =
                summary.cacheReadTokens! / summary.inputTokens!;
        if (
            summary.readsReported === values.length &&
            summary.writesReported === values.length &&
            (summary.cacheReadTokens ?? 0) > 0
        )
            summary.cacheWriteReadRatio =
                summary.cacheWriteTokens! / summary.cacheReadTokens!;
        if (
            complete &&
            values.every(
                (attempt) => attempt.cost?.cacheSavingsUsd !== undefined
            )
        )
            summary.cacheSavingsUsd = sum(
                (attempt) => attempt.cost?.cacheSavingsUsd
            );
        return summary;
    });
};
