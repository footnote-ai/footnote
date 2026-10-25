/**
 * @description: Shares provider-usage cost cases between planner and chat accounting tests.
 * @footnote-scope: test
 * @footnote-module: TextUsageCostCases
 * @footnote-risk: low - Fixture drift can weaken accounting regression coverage.
 * @footnote-ethics: low - Synthetic usage keeps cost assertions independent of live providers.
 */
export const textUsageCostCases = [
    [undefined, 'gpt-5-mini', 'partial', 0],
    [{}, 'gpt-5-mini', 'partial', 0],
    [{ promptTokens: 0, completionTokens: 0 }, 'gpt-5-mini', 'complete', 0],
    [{ promptTokens: 120 }, 'gpt-5-mini', 'partial', 0.00003],
    [{ completionTokens: 80 }, 'gpt-5-mini', 'partial', 0.00016],
    [{ totalTokens: 200 }, 'gpt-5-mini', 'partial', 0],
    [
        { promptTokens: 120, completionTokens: 80 },
        'unlisted-model',
        'unknown',
        0,
    ],
] as const;
