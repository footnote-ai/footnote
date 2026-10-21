/**
 * @description: Verifies bounded search recovery reuses the reviewed workflow and preserves evidence.
 * @footnote-scope: test
 * @footnote-module: WorkflowEngineReviewSearchRecoveryTests
 * @footnote-risk: medium - Recovery regressions can change workflow limits and fail-open behavior.
 * @footnote-ethics: high - Search decisions must preserve untrusted evidence and prior drafts.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import type {
    GenerationRequest,
    GenerationResult,
    GenerationRuntime,
} from '@footnote/agent-runtime';
import type { ModelProfile } from '@footnote/contracts';
import type { ContextStepResult } from '@footnote/contracts/policy';
import type { ExecutionLimits } from '../../src/services/workflowEngine/limits.js';
import type {
    PresentationConfig,
    PresentationPersona,
} from '../../src/services/presentation.js';
import type { AppliedPlanState } from '../../src/services/plannerWorkflowSeams.js';
import { parseReviewDecisionOutputResult } from '../../src/services/workflowEngine/reviewDecision.js';
import {
    buildExecutedContextStepResult,
    buildSkippedContextStepResult,
} from '../../src/services/contextIntegrations/contextStepExecution.js';
import { runBoundedReviewWorkflowForTest } from './helpers.js';

type SearchRecoveryFixture = {
    userRequest: string;
    initialQuery?: string;
    initialTitle?: string;
    initialText?: string;
    followUpQuery?: string;
    followUpTitle?: string;
    followUpText?: string;
};

type SearchRecoveryFixtures = {
    missedInitialSearch: SearchRecoveryFixture;
    staleInitialResults: SearchRecoveryFixture;
    stableControl: SearchRecoveryFixture;
};

const fixtureJson: unknown = JSON.parse(
    readFileSync(
        new URL('../fixtures/searchRecoveryScenarios.json', import.meta.url),
        'utf8'
    )
);
const fixtures = fixtureJson as SearchRecoveryFixtures;

const makeDecision = (
    decision: 'finalize' | 'revise' | 'search',
    query?: string
): string =>
    JSON.stringify({
        reviewDecision: decision,
        reviewReason:
            decision === 'search'
                ? 'The retrieved context is insufficient.'
                : decision === 'revise'
                  ? 'The wording needs a bounded revision.'
                  : 'The answer is ready.',
        ...(decision === 'revise'
            ? { revisionInstruction: 'Tighten the wording.' }
            : {}),
        ...(decision === 'search'
            ? {
                  search: {
                      query: query ?? 'updated official release schedule',
                  },
              }
            : {}),
    });

const executionLimits = (
    input: {
        maxWorkflowSteps?: number;
        maxToolCalls?: number;
        maxDeliberationCalls?: number;
        maxReviewCycles?: number;
        maxTokensTotal?: number;
        maxDurationMs?: number;
    } = {}
): ExecutionLimits => ({
    maxWorkflowSteps: input.maxWorkflowSteps ?? 7,
    maxToolCalls: input.maxToolCalls ?? 2,
    maxPlanCycles: 1,
    maxReviewCycles: input.maxReviewCycles ?? 2,
    maxDeliberationCalls: input.maxDeliberationCalls ?? 3,
    maxTokensTotal: input.maxTokensTotal ?? 48_000,
    maxDurationMs: input.maxDurationMs ?? 90_000,
});

const presentationProfile: ModelProfile = {
    id: 'search-recovery-presentation',
    description: 'Search recovery test presentation profile.',
    provider: 'openai',
    providerModel: 'fixture-model',
    enabled: true,
    tierBindings: [],
    capabilities: { canUseSearch: false },
    maxInputTokens: 2000,
    maxOutputTokens: 500,
    costClass: 'low',
};

const presentationConfig: PresentationConfig = {
    enabled: true,
    profileId: presentationProfile.id,
    profile: presentationProfile,
    timeoutMs: 100,
};

const presentationPersona: PresentationPersona = {
    id: 'search-recovery-test',
    presentationGuidance: 'Clear, direct wording.',
    expressionStrength: 'strong',
    expressionSource: 'profile',
    expressionGuidance: 'Persona expression strength: strong.',
};

const createRuntime = (input: {
    assessmentDecisions: string[];
    onRequest?: (request: GenerationRequest) => void;
    abortAfterFirstSearchDecision?: AbortController;
    tokensPerCall?: number;
    initialNativeSearchUsed?: boolean;
    initialNativeToolExecution?: GenerationResult['toolExecution'];
    presentationEnabled?: boolean;
}): GenerationRuntime => {
    let callCount = 0;
    let assessmentCount = 0;
    return {
        kind: 'search-recovery-test-runtime',
        async generate(request) {
            callCount += 1;
            input.onRequest?.(request);
            const assessmentCall = input.presentationEnabled
                ? callCount > 1 && callCount % 2 === 1
                : callCount % 2 === 0;
            if (assessmentCall) {
                const decision =
                    input.assessmentDecisions[assessmentCount++] ??
                    makeDecision('finalize');
                if (assessmentCount === 1) {
                    input.abortAfterFirstSearchDecision?.abort();
                }
                return {
                    text: decision,
                    model: 'fixture-model',
                    provenance: 'Inferred',
                    citations: [],
                    ...(input.tokensPerCall === undefined
                        ? {}
                        : {
                              usage: {
                                  promptTokens: 0,
                                  completionTokens: input.tokensPerCall,
                                  totalTokens: input.tokensPerCall,
                              },
                          }),
                };
            }
            return {
                text:
                    input.presentationEnabled && callCount === 1
                        ? 'A concise presentation candidate.'
                        : callCount === (input.presentationEnabled ? 2 : 1)
                          ? 'Initial draft with an unsupported current claim.'
                          : 'Updated draft based on the returned discovery context.',
                model: 'fixture-model',
                provenance: 'Inferred',
                citations:
                    callCount === 1
                        ? []
                        : [
                              {
                                  title: 'Release schedule (sanitized fixture)',
                                  url: 'https://sources.example.test/release-schedule',
                              },
                          ],
                ...(callCount === 1 &&
                input.initialNativeSearchUsed !== undefined
                    ? {
                          retrieval: {
                              requested: true,
                              used: input.initialNativeSearchUsed,
                          },
                      }
                    : {}),
                ...(callCount === 1 &&
                input.initialNativeToolExecution !== undefined
                    ? { toolExecution: input.initialNativeToolExecution }
                    : {}),
                ...(input.tokensPerCall === undefined
                    ? {}
                    : {
                          usage: {
                              promptTokens: 0,
                              completionTokens: input.tokensPerCall,
                              totalTokens: input.tokensPerCall,
                          },
                      }),
            };
        },
    };
};

const createSearchResult = (input: {
    query: string;
    querySource: 'planner' | 'backend_repair' | 'assessment';
    title: string;
    content: string;
}): ContextStepResult =>
    buildExecutedContextStepResult({
        toolName: 'web_search',
        evidence: {
            content: [input.content],
        },
        sources: [
            {
                title: input.title,
                url: 'https://sources.example.test/release-schedule',
                snippet: input.content,
            },
        ],
        integrationContext: {
            kind: 'web_search',
            version: 'v1',
            payload: {
                query: input.query,
                querySource: input.querySource,
                attempts: [
                    {
                        provider: 'searxng',
                        status: 'executed_with_results',
                        durationMs: 4,
                        resultCount: 1,
                    },
                ],
                searchHints: [],
            },
        },
    });

const runRecovery = async (input: {
    fixture: SearchRecoveryFixture;
    maxSearchRecoveryCycles: number;
    assessmentDecisions: string[];
    initialSearch?: boolean;
    initialSearchEligible?: boolean;
    initialWeather?: boolean;
    initialQuery?: string;
    contextExecutor?: (
        query: string,
        querySource: string,
        signal?: AbortSignal
    ) => Promise<ContextStepResult>;
    executionLimits?: ExecutionLimits;
    signal?: AbortSignal;
    abortAfterFirstSearchDecision?: AbortController;
    requests?: GenerationRequest[];
    tokensPerCall?: number;
    planning?: boolean;
    planContinuationEnabled?: boolean;
    nativeSearchHint?: string;
    initialNativeSearchUsed?: boolean;
    initialNativeToolExecution?: GenerationResult['toolExecution'];
    presentationEnabled?: boolean;
    maxIterations?: number;
    generationStartedAtMs?: number;
}) => {
    const requestMessages = [
        { role: 'user' as const, content: input.fixture.userRequest },
    ];
    const initialQuery = input.initialQuery ?? input.fixture.initialQuery;
    const contextStepRequests = [
        ...(input.initialSearch && initialQuery !== undefined
            ? [
                  {
                      integrationName: 'web_search' as const,
                      requested: true,
                      eligible: input.initialSearchEligible ?? true,
                      input: {
                          query: initialQuery,
                          querySource: 'planner',
                          intent: 'current_facts',
                          contextSize: 'medium',
                      },
                  },
              ]
            : []),
        ...(input.initialWeather
            ? [
                  {
                      integrationName: 'weather_forecast' as const,
                      requested: true,
                      eligible: true,
                      input: { location: 'Indianapolis' },
                  },
              ]
            : []),
    ];
    const executedQueries: string[] = [];
    const executedIntegrations: string[] = [];
    let plannerCallCount = 0;
    const result = await runBoundedReviewWorkflowForTest({
        generationRuntime: createRuntime({
            assessmentDecisions: input.assessmentDecisions,
            onRequest: (request) => input.requests?.push(request),
            abortAfterFirstSearchDecision: input.abortAfterFirstSearchDecision,
            tokensPerCall: input.tokensPerCall,
            initialNativeSearchUsed: input.initialNativeSearchUsed,
            initialNativeToolExecution: input.initialNativeToolExecution,
            presentationEnabled: input.presentationEnabled,
        }),
        generationRequest: {
            model: 'fixture-model',
            messages: requestMessages,
            ...(input.presentationEnabled ? { maxOutputTokens: 500 } : {}),
            ...(input.nativeSearchHint === undefined
                ? {}
                : {
                      search: {
                          query: input.nativeSearchHint,
                          contextSize: 'medium' as const,
                          intent: 'current_facts' as const,
                      },
                  }),
            ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
        messagesWithHints: requestMessages,
        generationStartedAtMs: input.generationStartedAtMs ?? Date.now(),
        workflowConfig: {
            workflowName: 'message_reviewed',
            maxIterations: input.maxIterations ?? 3,
            maxDurationMs: 90_000,
            maxSearchRecoveryCycles: input.maxSearchRecoveryCycles,
            executionLimits: input.executionLimits ?? executionLimits(),
        },
        workflowPolicy: {
            enablePlanning: input.planning ?? false,
            enableToolUse: true,
            enableReplanning: false,
            enableGeneration: true,
            enableAssessment: true,
            enableRevision: true,
        },
        ...(input.presentationEnabled
            ? {
                  presentation: {
                      config: presentationConfig,
                      persona: presentationPersona,
                      captureUsage: (generationResult: GenerationResult) => ({
                          model: generationResult.model ?? 'fixture-model',
                          promptTokens:
                              generationResult.usage?.promptTokens ?? 0,
                          completionTokens:
                              generationResult.usage?.completionTokens ?? 0,
                          totalTokens: generationResult.usage?.totalTokens ?? 0,
                          estimatedCost: {
                              inputCostUsd: 0,
                              outputCostUsd: 0,
                              totalCostUsd: 0,
                          },
                      }),
                  },
              }
            : {}),
        contextStepRequests,
        contextStepExecutor: async ({ request, signal }) => {
            executedIntegrations.push(request.integrationName);
            if (request.integrationName !== 'web_search') {
                return buildExecutedContextStepResult({
                    toolName: request.integrationName,
                    evidence: {
                        content: ['Unrelated initial weather context.'],
                    },
                });
            }
            const query =
                typeof request.input?.query === 'string'
                    ? request.input.query
                    : '';
            const querySource =
                typeof request.input?.querySource === 'string'
                    ? request.input.querySource
                    : 'planner';
            executedQueries.push(query);
            if (input.contextExecutor !== undefined) {
                return input.contextExecutor(query, querySource, signal);
            }
            return createSearchResult({
                query,
                querySource:
                    querySource === 'backend_repair' ||
                    querySource === 'assessment'
                        ? querySource
                        : 'planner',
                title:
                    querySource === 'assessment'
                        ? (input.fixture.followUpTitle ?? 'Updated result')
                        : (input.fixture.initialTitle ?? 'Initial result'),
                content:
                    querySource === 'assessment'
                        ? (input.fixture.followUpText ??
                          'Updated fixture evidence.')
                        : (input.fixture.initialText ??
                          'Initial fixture evidence.'),
            });
        },
        ...(input.planning
            ? {
                  plannerStepRequest: {
                      workflowId: 'wf_search_recovery_test',
                      workflowName: 'message_reviewed',
                      attempt: 1,
                      request: {
                          surface: 'web' as const,
                          trigger: { kind: 'submit' as const },
                          latestUserInput: input.fixture.userRequest,
                          conversation: requestMessages,
                      },
                      invocationContext: {
                          owner: 'workflow' as const,
                          workflowName: 'message_reviewed',
                          stepKind: 'plan' as const,
                          purpose:
                              'chat_orchestrator_action_selection' as const,
                      },
                      capabilityProfiles: [],
                  },
                  plannerStepExecutor: async () => {
                      plannerCallCount += 1;
                      return {
                          plan: {
                              action: 'message' as const,
                              modality: 'text' as const,
                              safetyTier: 'Low' as const,
                              reasoning: 'Continue with the user request.',
                              generation: {
                                  reasoningEffort: 'low' as const,
                                  verbosity: 'low' as const,
                              },
                          },
                          execution: {
                              status: 'executed' as const,
                              purpose:
                                  'chat_orchestrator_action_selection' as const,
                              contractType: 'structured' as const,
                              durationMs: 1,
                          },
                          ingestion: {
                              outputApplyOutcome: 'accepted' as const,
                              fallbackTier: 'none' as const,
                              correctionCodes: [],
                              outOfContractFields: [],
                              authorityFieldAttempts: [],
                          },
                          diagnostics: {
                              rawToolIntentPresent: false,
                              normalizedToolIntentPresent: false,
                              toolIntentRejected: false,
                              toolIntentRejectionReasons: [],
                          },
                      };
                  },
              }
            : {}),
        ...(input.planContinuationEnabled
            ? {
                  planContinuationBuilder: ({
                      plannerStepResult,
                      baseMessagesWithHints,
                      baseGenerationRequest,
                      contextEnvelope,
                  }) => ({
                      continuation: 'continue_message' as const,
                      messagesWithHints: baseMessagesWithHints,
                      generationRequest: baseGenerationRequest,
                      conversationSnapshot: input.fixture.userRequest,
                      contextEnvelope,
                      contextStepRequests: [],
                      plannerSummary: {
                          executionPlan: plannerStepResult.plan,
                          generationForExecution:
                              plannerStepResult.plan.generation,
                          selectedResponseProfile: {
                              id: 'fixture-model',
                              provider: 'openai',
                              providerModel: 'fixture-model',
                              capabilities: { canUseSearch: false },
                          },
                          originalSelectedProfileId: 'fixture-model',
                          effectiveSelectedProfileId: 'fixture-model',
                          toolRequestContext: {
                              toolName: 'web_search',
                              requested: false,
                              eligible: false,
                          },
                          plannerDiagnostics: plannerStepResult.diagnostics,
                          plannerApplyOutcome: 'applied',
                          plannerMattered: false,
                          plannerMatteredControlIds: [],
                          fallbackReasons: [],
                          fallbackRollupSelectionSource: 'default',
                          modality: plannerStepResult.plan.modality,
                          safetyTier: plannerStepResult.plan.safetyTier,
                          searchRequested: false,
                      } satisfies AppliedPlanState,
                  }),
              }
            : {}),
        parseReviewDecision: parseReviewDecisionOutputResult,
        captureUsage: (generationResult) => ({
            model: generationResult.model ?? 'fixture-model',
            promptTokens: generationResult.usage?.promptTokens ?? 0,
            completionTokens: generationResult.usage?.completionTokens ?? 0,
            totalTokens: generationResult.usage?.totalTokens ?? 0,
            estimatedCost: {
                inputCostUsd: 0,
                outputCostUsd: 0,
                totalCostUsd: 0,
            },
        }),
    });
    return {
        result,
        executedQueries,
        executedIntegrations,
        plannerCallCount,
    };
};

const generatedText = (
    result: Awaited<ReturnType<typeof runBoundedReviewWorkflowForTest>>
): string | undefined =>
    result.outcome === 'generated' ? result.generationResult.text : undefined;

test('missed initial search is recovered with merged evidence and linked lineage', async () => {
    const requests: GenerationRequest[] = [];
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.missedInitialSearch,
        maxSearchRecoveryCycles: 1,
        maxIterations: 1,
        assessmentDecisions: [
            makeDecision('search', fixtures.missedInitialSearch.followUpQuery),
            makeDecision('finalize'),
        ],
        requests,
    });

    assert.equal(requests[1]?.maxOutputTokens, 1024);
    assert.equal(result.outcome, 'generated');
    assert.deepEqual(executedQueries, [
        fixtures.missedInitialSearch.followUpQuery,
    ]);
    assert.match(
        requests[2]?.messages.map((message) => message.content).join('\n') ??
            '',
        /Synthetic current release-line evidence/
    );
    assert.match(
        requests[2]?.messages.map((message) => message.content).join('\n') ??
            '',
        /Initial draft with an unsupported current claim/
    );
    assert.match(
        requests[3]?.messages.map((message) => message.content).join('\n') ??
            '',
        /Sources returned by retrieval/
    );
    assert.match(
        requests[3]?.messages.map((message) => message.content).join('\n') ??
            '',
        /Sources cited by the current answer/
    );

    const steps = result.workflowLineage.steps;
    const assess = steps.find((step) => step.stepKind === 'assess');
    const retrieval = steps.find((step) => step.stepKind === 'tool');
    const regeneration = steps.filter(
        (step) => step.stepKind === 'generate'
    )[1];
    assert.ok(assess && retrieval && regeneration);
    assert.equal(retrieval.parentStepId, assess.stepId);
    assert.equal(regeneration.parentStepId, retrieval.stepId);
    assert.equal(assess.outcome.signals?.reviewDecision, 'search');
    assert.equal(
        assess.outcome.signals?.searchQuery,
        fixtures.missedInitialSearch.followUpQuery
    );
    assert.equal(retrieval.outcome.signals?.searchRecoveryOutcome, 'executed');
    assert.equal(retrieval.outcome.signals?.searchQuerySource, 'assessment');
    assert.equal(regeneration.outcome.signals?.retrievedSourceCount, 1);
    assert.equal(regeneration.outcome.signals?.answerCitationCount, 1);
    assert.ok(
        retrieval.inputRefs?.some((reference) => reference.name === 'review')
    );
    assert.equal(requests.length, 4);
});

test('an unexecuted initial query does not block the same assessment recovery query', async () => {
    const query = fixtures.missedInitialSearch.followUpQuery;
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.missedInitialSearch,
        maxSearchRecoveryCycles: 1,
        assessmentDecisions: [
            makeDecision('search', query),
            makeDecision('finalize'),
        ],
        initialSearch: true,
        initialSearchEligible: false,
        initialQuery: query,
    });

    assert.equal(result.outcome, 'generated');
    assert.deepEqual(executedQueries, [query]);
    assert.equal(result.workflowLineage.terminationReason, 'goal_satisfied');
});

test('six workflow steps admit one recovery after planning skips initial retrieval', async () => {
    const query = fixtures.missedInitialSearch.followUpQuery;
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.missedInitialSearch,
        maxSearchRecoveryCycles: 1,
        maxIterations: 1,
        assessmentDecisions: [
            makeDecision('search', query),
            makeDecision('finalize'),
        ],
        planning: true,
        planContinuationEnabled: true,
        executionLimits: executionLimits({
            maxWorkflowSteps: 6,
            maxToolCalls: 1,
            maxDeliberationCalls: 3,
            maxReviewCycles: 2,
        }),
    });

    assert.equal(result.outcome, 'generated');
    assert.deepEqual(executedQueries, [query]);
    assert.deepEqual(
        result.workflowLineage.steps.map((step) => step.stepKind),
        ['plan', 'generate', 'assess', 'tool', 'generate', 'assess']
    );
});

test('Balanced allowances admit plan, initial retrieval, recovery, and reassessment', async () => {
    const requests: GenerationRequest[] = [];
    const { result, executedQueries, plannerCallCount } = await runRecovery({
        fixture: fixtures.staleInitialResults,
        maxSearchRecoveryCycles: 1,
        maxIterations: 1,
        assessmentDecisions: [
            makeDecision('search', fixtures.staleInitialResults.followUpQuery),
            makeDecision('finalize'),
        ],
        initialSearch: true,
        planning: true,
        executionLimits: executionLimits(),
        requests,
    });

    assert.equal(result.outcome, 'generated');
    assert.deepEqual(
        result.workflowLineage.steps.map((step) => step.stepKind),
        ['plan', 'tool', 'generate', 'assess', 'tool', 'generate', 'assess']
    );
    assert.deepEqual(executedQueries, [
        fixtures.staleInitialResults.initialQuery,
        fixtures.staleInitialResults.followUpQuery,
    ]);
    assert.equal(plannerCallCount, 1);
    assert.equal(requests.length, 4);
});

test('stale initial results are retained and a fresh query runs as the only follow-up retrieval', async () => {
    const requests: GenerationRequest[] = [];
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.staleInitialResults,
        maxSearchRecoveryCycles: 1,
        initialSearch: true,
        nativeSearchHint: 'native provider search hint from planning',
        assessmentDecisions: [
            makeDecision('search', fixtures.staleInitialResults.followUpQuery),
            makeDecision('finalize'),
        ],
        requests,
    });

    assert.equal(result.outcome, 'generated');
    assert.deepEqual(executedQueries, [
        fixtures.staleInitialResults.initialQuery,
        fixtures.staleInitialResults.followUpQuery,
    ]);
    const regenerationContext =
        requests[2]?.messages.map((message) => message.content).join('\n') ??
        '';
    assert.match(regenerationContext, /Synthetic stale result/);
    assert.match(
        regenerationContext,
        /Synthetic current release-line evidence/
    );
    assert.equal(requests[2]?.search, undefined);
    const tools = result.workflowLineage.steps.filter(
        (step) => step.stepKind === 'tool'
    );
    const assessments = result.workflowLineage.steps.filter(
        (step) => step.stepKind === 'assess'
    );
    assert.equal(tools.length, 2);
    assert.deepEqual(
        tools.map((step) => step.attempt),
        [1, 2]
    );
    assert.equal(tools[1]?.parentStepId, assessments[0]?.stepId);
});

test('successful recovery skips the single-use presentation step', async () => {
    const requests: GenerationRequest[] = [];
    const { result } = await runRecovery({
        fixture: fixtures.missedInitialSearch,
        maxSearchRecoveryCycles: 1,
        assessmentDecisions: [
            makeDecision('search', fixtures.missedInitialSearch.followUpQuery),
            makeDecision('finalize'),
        ],
        presentationEnabled: true,
        requests,
    });

    assert.equal(result.outcome, 'generated');
    assert.deepEqual(
        result.workflowLineage.steps.map((step) => step.stepKind),
        ['presentation', 'generate', 'assess', 'tool', 'generate', 'assess']
    );
    assert.equal(result.presentation?.outcome, 'candidate_generated');
    assert.equal(requests.length, 5);
    assert.equal(
        result.workflowLineage.steps.filter(
            (step) => step.stepKind === 'presentation'
        ).length,
        1
    );
    assert.equal(
        result.workflowLineage.steps.find(
            (step) =>
                step.stepKind === 'generate' &&
                step.outcome.signals?.searchRecoveryOutcome === 'regenerated'
        )?.outcome.status,
        'executed'
    );
});

test('recovery does not rerun unrelated integrations from the initial retrieval batch', async () => {
    const { executedQueries, executedIntegrations } = await runRecovery({
        fixture: fixtures.staleInitialResults,
        maxSearchRecoveryCycles: 1,
        initialSearch: true,
        initialWeather: true,
        executionLimits: executionLimits({ maxToolCalls: 3 }),
        assessmentDecisions: [
            makeDecision('search', fixtures.staleInitialResults.followUpQuery),
            makeDecision('finalize'),
        ],
    });

    assert.deepEqual(executedQueries, [
        fixtures.staleInitialResults.initialQuery,
        fixtures.staleInitialResults.followUpQuery,
    ]);
    assert.equal(
        executedIntegrations.filter((name) => name === 'weather_forecast')
            .length,
        1
    );
    assert.equal(
        executedIntegrations.filter((name) => name === 'web_search').length,
        2
    );
});

test('recovery limits 0, 1, and 2 bound search cycles', async (t) => {
    for (const cycles of [0, 1, 2]) {
        await t.test(`maxSearchRecoveryCycles=${cycles}`, async () => {
            const decisions = [
                ...Array.from({ length: cycles + 1 }, (_, index) =>
                    makeDecision('search', `fresh source query ${index + 1}`)
                ),
            ];
            const requests: GenerationRequest[] = [];
            const { result, executedQueries } = await runRecovery({
                fixture: fixtures.missedInitialSearch,
                maxSearchRecoveryCycles: cycles,
                assessmentDecisions: decisions,
                requests,
                ...(cycles < 2
                    ? {}
                    : {
                          executionLimits: executionLimits({
                              maxWorkflowSteps: 10,
                              maxToolCalls: 3,
                              maxDeliberationCalls: 4,
                              maxReviewCycles: 3,
                              maxTokensTotal: 96_000,
                          }),
                      }),
            });
            assert.equal(executedQueries.length, cycles);
            assert.equal(requests.length, 2 + cycles * 2);
            assert.equal(
                result.workflowLineage.maxSearchRecoveryCycles,
                cycles
            );
        });
    }
});

test('effective recovery exhaustion takes precedence over later step exhaustion', async () => {
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.missedInitialSearch,
        maxSearchRecoveryCycles: 2,
        assessmentDecisions: [
            makeDecision('search', 'first recovery query'),
            makeDecision('search', 'second recovery query'),
        ],
        executionLimits: executionLimits({
            maxWorkflowSteps: 5,
            maxToolCalls: 2,
            maxDeliberationCalls: 3,
            maxReviewCycles: 2,
        }),
    });

    assert.deepEqual(executedQueries, ['first recovery query']);
    assert.equal(
        result.workflowLineage.terminationReason,
        'max_search_recovery_cycles_reached'
    );
    assert.equal(
        result.workflowLineage.steps.findLast(
            (step) => step.stepKind === 'assess'
        )?.outcome.signals?.searchRecoveryOutcome,
        'cycle_limit'
    );
});

test('repeat recovery queries are rejected before retrieval and preserve the first draft', async () => {
    const query = fixtures.staleInitialResults.initialQuery ?? '';
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.staleInitialResults,
        maxSearchRecoveryCycles: 1,
        initialSearch: true,
        assessmentDecisions: [
            makeDecision('search', ` ${query.toUpperCase()} `),
        ],
    });

    assert.equal(result.outcome, 'generated');
    assert.deepEqual(executedQueries, [query]);
    assert.equal(
        result.workflowLineage.terminationReason,
        'search_query_repeated'
    );
    assert.equal(
        generatedText(result),
        'Initial draft with an unsupported current claim.'
    );
});

test('a repeated prior recovery query preserves the latest generated draft', async () => {
    const query = 'current official release support schedule';
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.missedInitialSearch,
        maxSearchRecoveryCycles: 2,
        assessmentDecisions: [
            makeDecision('search', query),
            makeDecision('search', query),
        ],
    });

    assert.deepEqual(executedQueries, [query]);
    assert.equal(
        result.workflowLineage.terminationReason,
        'search_query_repeated'
    );
    assert.equal(
        generatedText(result),
        'Updated draft based on the returned discovery context.'
    );
    assert.equal(
        result.workflowLineage.steps.filter((step) => step.stepKind === 'tool')
            .length,
        1
    );
});

test('unavailable recovery provider retains the draft and records the failed recovery', async () => {
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.missedInitialSearch,
        maxSearchRecoveryCycles: 1,
        assessmentDecisions: [makeDecision('search')],
        contextExecutor: async () =>
            buildSkippedContextStepResult({
                toolName: 'web_search',
                reasonCode: 'tool_unavailable',
                integrationContext: {
                    kind: 'web_search',
                    version: 'v1',
                    payload: {
                        query: 'updated official release schedule',
                        querySource: 'assessment',
                        attempts: [],
                        searchHints: [],
                    },
                },
            }),
    });

    assert.equal(result.outcome, 'generated');
    assert.equal(executedQueries.length, 1);
    assert.equal(
        result.workflowLineage.terminationReason,
        'search_recovery_unavailable'
    );
    assert.equal(
        generatedText(result),
        'Initial draft with an unsupported current claim.'
    );
    assert.equal(
        result.workflowLineage.steps.find((step) => step.stepKind === 'tool')
            ?.outcome.signals?.searchRecoveryOutcome,
        'unavailable'
    );
});

test('cancellation during recovery is recorded and does not regenerate', async () => {
    const controller = new AbortController();
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.missedInitialSearch,
        maxSearchRecoveryCycles: 1,
        assessmentDecisions: [makeDecision('search')],
        signal: controller.signal,
        abortAfterFirstSearchDecision: controller,
    });

    assert.equal(result.outcome, 'generated');
    assert.deepEqual(executedQueries, []);
    assert.equal(
        result.workflowLineage.terminationReason,
        'provider_cancelled'
    );
    assert.equal(
        generatedText(result),
        'Initial draft with an unsupported current claim.'
    );
});

test('cancellation after retrieval starts retains any completed evidence', async () => {
    const controller = new AbortController();
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.missedInitialSearch,
        maxSearchRecoveryCycles: 1,
        assessmentDecisions: [makeDecision('search')],
        signal: controller.signal,
        contextExecutor: async (query, querySource, signal) => {
            assert.equal(querySource, 'assessment');
            assert.equal(signal, controller.signal);
            controller.abort();
            return createSearchResult({
                query,
                querySource: 'assessment',
                title: 'Completed result before cancellation',
                content: 'Evidence returned before request cancellation.',
            });
        },
    });

    assert.deepEqual(executedQueries, ['updated official release schedule']);
    assert.equal(
        result.workflowLineage.terminationReason,
        'provider_cancelled'
    );
    assert.equal(
        result.workflowLineage.steps.find((step) => step.stepKind === 'tool')
            ?.outcome.signals?.retrievedSourceCount,
        1
    );
    assert.equal(
        generatedText(result),
        'Initial draft with an unsupported current claim.'
    );
});

test('tool exhaustion blocks recovery before retrieval and keeps the latest draft', async () => {
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.staleInitialResults,
        maxSearchRecoveryCycles: 1,
        initialSearch: true,
        assessmentDecisions: [makeDecision('search')],
        executionLimits: executionLimits({ maxToolCalls: 1 }),
    });

    assert.equal(result.outcome, 'generated');
    assert.deepEqual(executedQueries, [
        fixtures.staleInitialResults.initialQuery,
    ]);
    assert.equal(
        result.workflowLineage.terminationReason,
        'max_tool_calls_reached'
    );
    assert.equal(
        generatedText(result),
        'Initial draft with an unsupported current claim.'
    );
});

test('token exhaustion blocks recovery before retrieval and preserves the prior draft', async () => {
    const requests: GenerationRequest[] = [];
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.missedInitialSearch,
        maxSearchRecoveryCycles: 1,
        assessmentDecisions: [makeDecision('search')],
        executionLimits: executionLimits({ maxTokensTotal: 10_001 }),
        tokensPerCall: 5_000,
        requests,
    });

    assert.deepEqual(executedQueries, []);
    assert.equal(
        generatedText(result),
        'Initial draft with an unsupported current claim.'
    );
    assert.equal(
        result.workflowLineage.terminationReason,
        'budget_exhausted_tokens'
    );
    assert.equal(
        result.workflowLineage.steps.filter(
            (step) => step.stepKind === 'generate'
        ).length,
        1
    );
    assert.equal(requests.length, 2);
    assert.equal(
        result.workflowLineage.steps.some((step) => step.stepKind === 'tool'),
        false
    );
});

test('large recovery evidence that exhausts token allowance preserves draft and records the failed generation', async () => {
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.missedInitialSearch,
        maxSearchRecoveryCycles: 1,
        assessmentDecisions: [makeDecision('search')],
        executionLimits: executionLimits({ maxTokensTotal: 10_001 }),
        tokensPerCall: 100,
        contextExecutor: async (query) =>
            createSearchResult({
                query,
                querySource: 'assessment',
                title: 'Large sanitized result',
                content: 'x'.repeat(50_000),
            }),
    });

    assert.deepEqual(executedQueries, ['updated official release schedule']);
    assert.equal(
        generatedText(result),
        'Initial draft with an unsupported current claim.'
    );
    assert.equal(
        result.workflowLineage.terminationReason,
        'budget_exhausted_tokens'
    );
    const generationSteps = result.workflowLineage.steps.filter(
        (step) => step.stepKind === 'generate'
    );
    assert.equal(generationSteps.length, 1);
    assert.equal(
        result.workflowLineage.limitStop?.stoppedBeforeStepKind,
        'generate'
    );
    assert.equal(result.workflowLineage.limitStop?.stoppedByLimit, true);
    assert.equal(
        result.workflowLineage.steps.find(
            (step) =>
                step.stepKind === 'tool' &&
                step.outcome.signals?.searchRecoveryOutcome !== undefined
        )?.outcome.status,
        'executed'
    );
});

test('duration exhaustion after recovery retrieval preserves the prior draft', async () => {
    const maxDurationMs = 2_000;
    const startedAt = Date.now() - 100;
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.missedInitialSearch,
        maxSearchRecoveryCycles: 1,
        assessmentDecisions: [makeDecision('search')],
        generationStartedAtMs: startedAt,
        executionLimits: executionLimits({ maxDurationMs }),
        contextExecutor: async (query) => {
            await new Promise<void>((resolve) =>
                setTimeout(resolve, maxDurationMs + 100)
            );
            return createSearchResult({
                query,
                querySource: 'assessment',
                title: 'Updated result',
                content: 'Updated fixture evidence.',
            });
        },
    });

    assert.deepEqual(executedQueries, ['updated official release schedule']);
    assert.ok(result.outcome === 'generated');
    assert.equal(
        result.generationResult.text,
        'Initial draft with an unsupported current claim.'
    );
    assert.equal(
        result.workflowLineage.terminationReason,
        'budget_exhausted_time'
    );
    assert.equal(
        result.workflowLineage.steps.filter(
            (step) => step.stepKind === 'generate'
        ).length,
        1
    );
});

test('search-free stable-control answers do not call the retrieval executor', async () => {
    const requests: GenerationRequest[] = [];
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.stableControl,
        maxSearchRecoveryCycles: 1,
        assessmentDecisions: [makeDecision('finalize')],
        requests,
    });

    assert.equal(result.outcome, 'generated');
    assert.deepEqual(executedQueries, []);
    assert.equal(requests.length, 2);
    assert.equal(
        result.workflowLineage.steps.some((step) => step.stepKind === 'tool'),
        false
    );
});

test('Balanced non-search revisions retain the baseline model-call allowance', async () => {
    const baselineRequests: GenerationRequest[] = [];
    const currentRequests: GenerationRequest[] = [];
    const reviseThenFinalize = [
        makeDecision('revise'),
        makeDecision('finalize'),
    ];
    const baseline = await runRecovery({
        fixture: fixtures.stableControl,
        maxSearchRecoveryCycles: 0,
        maxIterations: 2,
        assessmentDecisions: reviseThenFinalize,
        executionLimits: executionLimits({
            maxWorkflowSteps: 5,
            maxToolCalls: 1,
            maxDeliberationCalls: 3,
            maxReviewCycles: 2,
        }),
        requests: baselineRequests,
    });
    const current = await runRecovery({
        fixture: fixtures.stableControl,
        maxSearchRecoveryCycles: 1,
        maxIterations: 2,
        assessmentDecisions: reviseThenFinalize,
        executionLimits: executionLimits(),
        requests: currentRequests,
    });

    assert.equal(baseline.result.outcome, 'generated');
    assert.equal(current.result.outcome, 'generated');
    for (const result of [baseline.result, current.result]) {
        assert.ok(
            result.workflowLineage.steps.some(
                (step) =>
                    step.stepKind === 'generate' &&
                    step.outcome.signals?.refinementApplied === true
            ),
            'the comparison must exercise an actual non-search revision'
        );
    }
    assert.equal(
        currentRequests.length,
        baselineRequests.length,
        JSON.stringify({
            baselineCalls: baselineRequests.length,
            baselineSteps: baseline.result.workflowLineage.steps.map(
                (step) => ({
                    kind: step.stepKind,
                    outcome: step.outcome.signals,
                })
            ),
            currentCalls: currentRequests.length,
            currentSteps: current.result.workflowLineage.steps.map((step) => ({
                kind: step.stepKind,
                outcome: step.outcome.signals,
            })),
        })
    );
    assert.deepEqual(
        current.result.workflowLineage.steps.map((step) => step.stepKind),
        baseline.result.workflowLineage.steps.map((step) => step.stepKind)
    );
});

test('provider-native search is counted only when the runtime reports it used', async (t) => {
    const query = 'current official release lines';
    for (const used of [false, true]) {
        await t.test(`native search used=${used}`, async () => {
            const requests: GenerationRequest[] = [];
            const { result, executedQueries } = await runRecovery({
                fixture: fixtures.missedInitialSearch,
                maxSearchRecoveryCycles: 1,
                nativeSearchHint: query,
                initialNativeSearchUsed: used,
                assessmentDecisions: [makeDecision('search', query)],
                requests,
            });
            assert.deepEqual(executedQueries, used ? [] : [query]);
            assert.equal(
                result.workflowLineage.terminationReason,
                used ? 'search_query_repeated' : 'goal_satisfied'
            );
            assert.ok(
                JSON.stringify(requests[1]?.messages).includes(
                    `Provider-native search: query ${query}; runtime outcome: requested=true, used=${used}.`
                )
            );
            assert.ok(
                requests
                    .slice(1)
                    .every((request) => request.search === undefined)
            );
        });
    }
});

test('web-search toolExecution is passed to assessment and prevents duplicate work', async () => {
    const query = 'current official release lines';
    const requests: GenerationRequest[] = [];
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.missedInitialSearch,
        maxSearchRecoveryCycles: 1,
        nativeSearchHint: query,
        initialNativeToolExecution: {
            toolName: 'web_search',
            status: 'executed',
        },
        assessmentDecisions: [makeDecision('search', query)],
        requests,
    });

    assert.deepEqual(executedQueries, []);
    assert.equal(
        result.workflowLineage.terminationReason,
        'search_query_repeated'
    );
    assert.ok(
        JSON.stringify(requests[1]?.messages).includes(
            `toolExecution=web_search:executed`
        )
    );
});

test('unrelated runtime toolExecution does not count as native web search', async () => {
    const query = 'current official release lines';
    const requests: GenerationRequest[] = [];
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.missedInitialSearch,
        maxSearchRecoveryCycles: 1,
        nativeSearchHint: query,
        initialNativeToolExecution: {
            toolName: 'weather_forecast',
            status: 'executed',
        },
        assessmentDecisions: [makeDecision('search', query)],
        requests,
    });

    assert.deepEqual(executedQueries, [query]);
    assert.equal(result.workflowLineage.terminationReason, 'goal_satisfied');
    assert.ok(
        JSON.stringify(requests[1]?.messages).includes(
            'runtime outcome: not reported'
        )
    );
});

test('search recovery remains distinct from the existing revise path', async () => {
    const requests: GenerationRequest[] = [];
    const { result, executedQueries } = await runRecovery({
        fixture: fixtures.missedInitialSearch,
        maxSearchRecoveryCycles: 1,
        assessmentDecisions: [
            makeDecision('revise'),
            makeDecision('search', 'updated official release schedule'),
            makeDecision('finalize'),
        ],
        executionLimits: executionLimits({
            maxWorkflowSteps: 10,
            maxDeliberationCalls: 5,
            maxReviewCycles: 4,
        }),
        requests,
    });

    assert.equal(result.outcome, 'generated');
    assert.equal(executedQueries.length, 1);
    const generations = result.workflowLineage.steps.filter(
        (step) => step.stepKind === 'generate'
    );
    assert.equal(generations.length, 3);
    assert.equal(generations[1]?.outcome.signals?.refinementApplied, true);
    assert.equal(generations[2]?.outcome.signals?.refinementApplied, undefined);
    assert.equal(
        generations[2]?.outcome.signals?.searchRecoveryOutcome,
        'regenerated'
    );
    assert.match(
        requests[2]?.messages.map((message) => message.content).join('\n') ??
            '',
        /Tighten the wording/
    );
});
