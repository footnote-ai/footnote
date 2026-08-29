/**
 * @description: Loads, runs, checkpoints, and renders response comparisons.
 * @footnote-scope: test
 * @footnote-module: ResponseComparison
 * @footnote-risk: high - Live runs spend provider budget and save model output.
 * @footnote-ethics: high - Reports must preserve attribution and keep blind review honest.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type {
    GenerationResult,
    GenerationRuntime,
    GenerationStructuredOutput,
    RuntimeMessage,
} from '../../packages/agent-runtime/src/index.js';
import type {
    ModelProfile,
    PresentationGenerationSettings,
    PresentationPromptVariant,
    SupportedReasoningEffort,
    SupportedVerbosity,
} from '../../packages/contracts/src/index.js';
import { estimateOpenAITextCost } from '../../packages/contracts/src/pricing.js';
import type {
    PresentationPersona,
    PresentationHandoffVariant,
    PresentationResult,
} from '../../packages/backend/src/services/presentation.js';
import type {
    ResponseComparisonProgressEvent,
    ResponseComparisonStageProgress,
} from './response-comparison-progress.js';

export type ResponseComparisonCondition = {
    id: string;
    candidateModel?: ResponseComparisonModel;
    candidatePromptVariant?: Extract<
        PresentationPromptVariant,
        'faithful-rewrite' | 'style-sketch'
    >;
    handoffVariant?: PresentationHandoffVariant;
};

export type ResponseComparisonModelSettings = {
    model: ResponseComparisonModel;
    reasoningEffort?: SupportedReasoningEffort;
};

export type ResponseComparisonConfig = {
    version: 1 | 2;
    name: string;
    /** Legacy matrix fields remain readable for completed v1 reports. */
    models?: ResponseComparisonModel[];
    settings?: ResponseComparisonSetting[];
    authority?: ResponseComparisonModelSettings;
    conditions?: ResponseComparisonCondition[];
    repeats: number;
    cases: ResponseComparisonCase[];
    review: ResponseComparisonReviewConfig;
};

export type ResponseComparisonModel =
    | { profile: string }
    | { name: string; provider: ModelProfile['provider']; model: string };

export type ResponseComparisonSetting =
    | 'default'
    | {
          name?: string;
          temperature?: number;
          topP?: number;
          maxOutputTokens?: number;
          reasoningEffort?: SupportedReasoningEffort;
          verbosity?: SupportedVerbosity;
          prompt?: PresentationPromptVariant;
      };

export type ResponseComparisonCase = {
    id: string;
    persona: string;
    expressionStrength: 'subtle' | 'balanced' | 'strong';
    messages: RuntimeMessage[];
    requirements: Array<{
        id: string;
        kind:
            | 'facts'
            | 'uncertainty'
            | 'sources'
            | 'authority'
            | 'safety'
            | 'unsupported_additions';
        statement: string;
    }>;
};

export type ResponseComparisonReviewConfig = {
    mustKeep: Array<
        | 'facts'
        | 'uncertainty'
        | 'sources'
        | 'authority'
        | 'safety'
        | 'unsupported_additions'
    >;
    rate: Array<'naturalness' | 'persona' | 'clarity' | 'usefulness'>;
    automaticReviewer?: ResponseComparisonModelSettings;
    blind: boolean;
};

export type ResponseComparisonStatus = 'completed' | 'not_tested' | 'failed';

export type ResponseComparisonCandidateAvailability =
    'usable' | 'unavailable' | 'not_attempted';

export type ResponseComparisonAttempt = {
    attemptId: string;
    comparisonId: string;
    model: ResponseComparisonModel;
    setting: ResponseComparisonSetting;
    caseId: string;
    repeat: number;
    status: ResponseComparisonStatus;
    reason?: string;
    source: {
        messages: RuntimeMessage[];
        persona: string;
        resolvedGuidance: string;
        expressionGuidance: string;
        expressionStrength: ResponseComparisonCase['expressionStrength'];
        guidanceHash: string;
        requirements: ResponseComparisonCase['requirements'];
        reviewRequirements: ResponseComparisonCase['requirements'];
    };
    support?: ResponseComparisonSupportEvidence;
    output?: {
        text: string;
        completion?: GenerationResult['completion'];
    };
    settingsEvidence?: {
        requested: PresentationGenerationSettings;
        forwarded: PresentationGenerationSettings;
        omitted: Array<Record<string, string | number>>;
        providerObserved?: PresentationGenerationSettings;
    };
    attribution?: {
        requestedProvider?: string;
        requestedModel?: string;
        observedProvider?: string;
        observedModel?: string;
    };
    operations?: {
        latencyMs?: number;
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        costUsd?: number;
        costSource?: 'provider_reported' | 'backend_estimate';
        outputLength?: number;
    };
    automaticReview?: ResponseComparisonAutomaticReview;
    unsupportedChangesReview?: ResponseComparisonRequirementReview;
    condition?: ResponseComparisonCondition;
    authoritativeProfile?: string;
    authoritativeModel?: ResponseComparisonModel;
    stages?: {
        candidate: ResponseComparisonStage;
        authoritative: ResponseComparisonStage;
        final: ResponseComparisonStage;
        revisions?: ResponseComparisonStage[];
    };
    correctionDecisions?: ResponseComparisonCorrectionDecision[];
    candidateChangeHint?: ResponseComparisonCandidateChangeHint;
    candidateAvailability?: ResponseComparisonCandidateAvailability;
};

export type ResponseComparisonStage = {
    status: 'completed' | 'failed' | 'not_run';
    text?: string;
    completion?: GenerationResult['completion'];
    attribution?: {
        requestedProvider?: string;
        requestedModel?: string;
        observedProvider?: string;
        observedModel?: string;
    };
    operations?: {
        latencyMs?: number;
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        costUsd?: number;
        costSource?: 'provider_reported' | 'backend_estimate';
        outputLength?: number;
    };
    failure?: string;
};

export type ResponseComparisonCorrectionDecision = {
    stage: 'assessment' | 'revision';
    decision: 'finalize' | 'revise';
    reason?: string;
    instruction?: string;
};

export type ResponseComparisonCandidateChangeHint = {
    detected: boolean;
    evidence: string[];
    /** A text-matching hint for reviewers, not a correctness judgment. */
    method?: 'heuristic';
};

export type ResponseComparisonWorkflowResult = {
    candidate: ResponseComparisonStage;
    authoritative: ResponseComparisonStage;
    revisions: ResponseComparisonStage[];
    final: ResponseComparisonStage;
    candidateAvailability: ResponseComparisonCandidateAvailability;
    correctionDecisions: ResponseComparisonCorrectionDecision[];
    candidateChangeHint: ResponseComparisonCandidateChangeHint;
};

export type ResponseComparisonRequirementReview = {
    requirementId: 'unsupported-additions';
    status: 'pass' | 'fail' | 'uncertain' | 'not_run';
    explanation?: string;
};

export const RESPONSE_COMPARISON_UNSUPPORTED_ADDITIONS_REQUIREMENT = {
    id: 'unsupported-additions',
    kind: 'unsupported_additions' as const,
    statement:
        'The final answer must not introduce a material unsupported substantive fact, claim, assumption, source, recommendation, or conclusion that changes its factual, evidentiary, authority, or safety meaning. Do not fail ordinary task-appropriate general knowledge, explanatory detail, harmless examples or metaphor, or safety guidance consistent with the authoritative instructions.',
};

export const RESPONSE_COMPARISON_AUTOMATIC_REVIEW_INSTRUCTION =
    'Treat the supplied authoritative context as the source of truth for its claims, constraints, uncertainty, authority, sources, and safety posture, but do not treat it as an exhaustive knowledge base. Check every requirement and rate every requested dimension. For unsupported-additions, fail only when the final answer introduces a material unsupported claim that changes factual, evidentiary, authority, or safety meaning, invents a source or result, or adds an unwarranted recommendation or conclusion. Pass ordinary task-appropriate general knowledge, explanatory detail, harmless examples or metaphor, and safety guidance consistent with the authoritative instructions. Use uncertain when materiality cannot be determined. Give brief evidence for each result. Return exactly one result for each requirement and dimension. Do not invent evidence.';

export type ResponseComparisonAutomaticReview = {
    reviewer: {
        profile: string;
        name?: string;
        provider?: string;
        model?: string;
        reasoningEffort?: SupportedReasoningEffort;
    };
    promptHash: string;
    schemaHash: string;
    instruction: string;
    schema: GenerationStructuredOutput['schema'];
    status: 'completed' | 'failed';
    mustKeep: Array<{
        requirementId: string;
        result: 'pass' | 'fail' | 'uncertain';
        explanation: string;
        excerpt?: string;
        evidence?: string;
    }>;
    ratings: Array<{
        dimension: string;
        score: 1 | 2 | 3 | 4 | 5;
        rationale: string;
        evidence?: string;
    }>;
    timing?: {
        latencyMs?: number;
        usage?: GenerationResult['usage'];
        costUsd?: number;
        costSource?: 'provider_reported' | 'backend_estimate';
    };
    failure?: string;
};

/** Reads the unsupported-additions result from an automatic review. */
export const readUnsupportedChangesReview = (
    review: ResponseComparisonAutomaticReview | undefined
): ResponseComparisonRequirementReview => {
    if (review === undefined)
        return { requirementId: 'unsupported-additions', status: 'not_run' };
    if (review.status !== 'completed')
        return {
            requirementId: 'unsupported-additions',
            status: 'uncertain',
            explanation: review.failure,
        };
    const requirement = review.mustKeep.find(
        (item) => item.requirementId === 'unsupported-additions'
    );
    return requirement === undefined
        ? {
              requirementId: 'unsupported-additions',
              status: 'uncertain',
              explanation:
                  'Universal final-answer requirement was not reviewed.',
          }
        : {
              requirementId: 'unsupported-additions',
              status: requirement.result,
              explanation: requirement.explanation,
          };
};

export type ResponseComparisonReport = {
    schemaVersion: 1;
    reportId: string;
    parentReportId?: string;
    createdAt: string;
    completedAt?: string;
    reviewerName?: string;
    command: string;
    gitSha?: string;
    configPath: string;
    configHash: string;
    dependencies: Record<string, string>;
    config: ResponseComparisonConfig;
    attempts: ResponseComparisonAttempt[];
    humanReviews: Array<Record<string, unknown>>;
    blindnessEvents: Array<{ at: string; action: 'revealed' | 'exported' }>;
};

export type ResponseComparisonSupportEvidence = {
    checkedAt: string;
    source: 'catalog_profile' | 'openrouter_models_endpoint';
    modelId: string;
    status: 'supported' | 'unsupported' | 'unknown' | 'failed';
    modelFound?: boolean;
    observedParameters?: string[];
    observedReasoningEfforts?: SupportedReasoningEffort[];
    reasoningMandatory?: boolean;
    reasonCode?: string;
};

type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const hash = (value: unknown): string =>
    crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${label} must be a non-empty string.`);
    }
    return value.trim();
};
const integer = (value: unknown, label: string): number => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return value;
};
const exactKeys = (
    value: UnknownRecord,
    allowed: readonly string[],
    label: string
): void => {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key))
            throw new Error(`${label} has unknown key "${key}".`);
    }
};
const enumValue = <T extends string>(
    value: unknown,
    values: readonly T[],
    label: string
): T => {
    if (typeof value !== 'string' || !values.includes(value as T))
        throw new Error(`${label} must be one of: ${values.join(', ')}.`);
    return value as T;
};
const assertUnique = (values: string[], label: string): void => {
    if (new Set(values).size !== values.length)
        throw new Error(`${label} must be unique.`);
};

const parseMessages = (value: unknown, label: string): RuntimeMessage[] => {
    if (!Array.isArray(value) || value.length === 0)
        throw new Error(`${label} must be a non-empty list.`);
    return value.map((item, index) => {
        if (!isRecord(item))
            throw new Error(`${label}[${index}] must be an object.`);
        exactKeys(item, ['role', 'content'], `${label}[${index}]`);
        return {
            role: enumValue(
                item.role,
                ['system', 'user', 'assistant'],
                `${label}[${index}].role`
            ),
            content: text(item.content, `${label}[${index}].content`),
        };
    });
};

const parseSettings = (value: unknown): ResponseComparisonSetting[] => {
    if (!Array.isArray(value) || value.length === 0)
        throw new Error('settings must be a non-empty list.');
    return value.map((item, index) => {
        if (item === 'default') return item;
        if (!isRecord(item))
            throw new Error(`settings[${index}] must be default or an object.`);
        exactKeys(
            item,
            [
                'name',
                'temperature',
                'topP',
                'maxOutputTokens',
                'reasoningEffort',
                'verbosity',
                'prompt',
            ],
            `settings[${index}]`
        );
        const controlKeys = Object.keys(item).filter((key) => key !== 'name');
        if (controlKeys.length === 0)
            throw new Error(
                `settings[${index}] must contain at least one control.`
            );
        const settingName =
            item.name === undefined
                ? undefined
                : text(item.name, `settings[${index}].name`);
        if (
            item.temperature !== undefined &&
            (typeof item.temperature !== 'number' ||
                item.temperature < 0 ||
                item.temperature > 2)
        )
            throw new Error(
                `settings[${index}].temperature must be between 0 and 2.`
            );
        if (
            item.topP !== undefined &&
            (typeof item.topP !== 'number' || item.topP < 0 || item.topP > 1)
        )
            throw new Error(`settings[${index}].topP must be between 0 and 1.`);
        const maxOutputTokens =
            item.maxOutputTokens === undefined
                ? undefined
                : integer(
                      item.maxOutputTokens,
                      `settings[${index}].maxOutputTokens`
                  );
        return {
            ...(settingName !== undefined && { name: settingName }),
            ...(item.temperature !== undefined && {
                temperature: item.temperature,
            }),
            ...(item.topP !== undefined && { topP: item.topP }),
            ...(maxOutputTokens !== undefined && {
                maxOutputTokens,
            }),
            ...(item.reasoningEffort !== undefined && {
                reasoningEffort: enumValue(
                    item.reasoningEffort,
                    ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
                    `settings[${index}].reasoningEffort`
                ),
            }),
            ...(item.verbosity !== undefined && {
                verbosity: enumValue(
                    item.verbosity,
                    ['low', 'medium', 'high'],
                    `settings[${index}].verbosity`
                ),
            }),
            ...(item.prompt !== undefined && {
                prompt: enumValue(
                    item.prompt,
                    ['faithful-rewrite', 'style-sketch', 'current', 'compact'],
                    `settings[${index}].prompt`
                ),
            }),
        };
    });
};

const parseComparisonModel = (
    value: unknown,
    label: string
): ResponseComparisonModel => {
    if (!isRecord(value)) throw new Error(`${label} must be an object.`);
    if (value.profile !== undefined) {
        exactKeys(value, ['profile'], label);
        return { profile: text(value.profile, `${label}.profile`) };
    }
    exactKeys(value, ['name', 'provider', 'model'], label);
    return {
        name: text(value.name, `${label}.name`),
        provider: enumValue(
            value.provider,
            ['openai', 'ollama', 'openrouter'],
            `${label}.provider`
        ),
        model: text(value.model, `${label}.model`),
    };
};

const parseModelSettings = (
    value: unknown,
    label: string
): ResponseComparisonModelSettings => {
    if (!isRecord(value)) throw new Error(`${label} must be an object.`);
    exactKeys(value, ['model', 'reasoningEffort'], label);
    return {
        model: parseComparisonModel(value.model, `${label}.model`),
        ...(value.reasoningEffort !== undefined && {
            reasoningEffort: enumValue(
                value.reasoningEffort,
                ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const,
                `${label}.reasoningEffort`
            ),
        }),
    };
};

const parseConditions = (value: unknown): ResponseComparisonCondition[] => {
    if (!Array.isArray(value) || value.length === 0)
        throw new Error('conditions must be a non-empty list.');
    const conditions = value.map((item, index): ResponseComparisonCondition => {
        const label = `conditions[${index}]`;
        if (!isRecord(item)) throw new Error(`${label} must be an object.`);
        exactKeys(
            item,
            [
                'id',
                'candidateModel',
                'candidatePromptVariant',
                'handoffVariant',
            ],
            label
        );
        const candidateModel =
            item.candidateModel === undefined
                ? undefined
                : parseComparisonModel(
                      item.candidateModel,
                      `${label}.candidateModel`
                  );
        if (
            candidateModel !== undefined &&
            item.candidatePromptVariant === undefined
        )
            throw new Error(
                `${label}.candidatePromptVariant is required when candidateModel is configured.`
            );
        if (
            candidateModel === undefined &&
            (item.candidatePromptVariant !== undefined ||
                item.handoffVariant !== undefined)
        )
            throw new Error(
                `${label} cannot set candidate prompting or handoff without a candidateModel.`
            );
        if (candidateModel !== undefined && item.handoffVariant === undefined)
            throw new Error(
                `${label}.handoffVariant is required when candidateModel is configured.`
            );
        return {
            id: text(item.id, `${label}.id`),
            ...(candidateModel !== undefined && { candidateModel }),
            ...(item.candidatePromptVariant !== undefined && {
                candidatePromptVariant: enumValue(
                    item.candidatePromptVariant,
                    ['faithful-rewrite', 'style-sketch'] as const,
                    `${label}.candidatePromptVariant`
                ),
            }),
            ...(item.handoffVariant !== undefined && {
                handoffVariant: enumValue(
                    item.handoffVariant,
                    ['preserve-candidate', 'style-reference'] as const,
                    `${label}.handoffVariant`
                ),
            }),
        };
    });
    assertUnique(
        conditions.map((condition) => condition.id),
        'condition IDs'
    );
    return conditions;
};

export const parseResponseComparisonCases = (
    value: unknown
): ResponseComparisonCase[] => {
    if (!Array.isArray(value) || value.length === 0)
        throw new Error('cases must be a non-empty list.');
    const cases = value.map((item, index): ResponseComparisonCase => {
        if (!isRecord(item))
            throw new Error(`cases[${index}] must be an object.`);
        exactKeys(
            item,
            ['id', 'persona', 'expressionStrength', 'messages', 'requirements'],
            `cases[${index}]`
        );
        if (!Array.isArray(item.requirements) || item.requirements.length === 0)
            throw new Error(`cases[${index}].requirements must be non-empty.`);
        const requirements = item.requirements.map(
            (requirement, requirementIndex) => {
                if (!isRecord(requirement))
                    throw new Error(
                        `cases[${index}].requirements[${requirementIndex}] must be an object.`
                    );
                exactKeys(
                    requirement,
                    ['id', 'kind', 'statement'],
                    `cases[${index}].requirements[${requirementIndex}]`
                );
                return {
                    id: text(requirement.id, 'requirement.id'),
                    kind: enumValue(
                        requirement.kind,
                        [
                            'facts',
                            'uncertainty',
                            'sources',
                            'authority',
                            'safety',
                            'unsupported_additions',
                        ],
                        'requirement.kind'
                    ),
                    statement: text(
                        requirement.statement,
                        'requirement.statement'
                    ),
                };
            }
        );
        assertUnique(
            requirements.map((requirement) => requirement.id),
            `cases[${index}] requirement IDs`
        );
        return {
            id: text(item.id, `cases[${index}].id`),
            persona: text(item.persona, `cases[${index}].persona`),
            expressionStrength: enumValue(
                item.expressionStrength,
                ['subtle', 'balanced', 'strong'],
                `cases[${index}].expressionStrength`
            ),
            messages: parseMessages(item.messages, `cases[${index}].messages`),
            requirements,
        };
    });
    assertUnique(
        cases.map((item) => item.id),
        'case IDs'
    );
    return cases;
};

export const parseResponseComparisonConfig = (
    value: unknown,
    options: { coreCases?: unknown[] } = {}
): ResponseComparisonConfig => {
    if (!isRecord(value))
        throw new Error('response comparison config must be an object.');
    exactKeys(
        value,
        [
            'version',
            'name',
            'models',
            'settings',
            'authority',
            'conditions',
            'repeats',
            'cases',
            'review',
        ],
        'config'
    );
    if (value.version !== 1 && value.version !== 2)
        throw new Error('config.version must be 1 or 2.');
    const models = Array.isArray(value.models)
        ? value.models.map((item, index) =>
              parseComparisonModel(item, `models[${index}]`)
          )
        : undefined;
    if (models !== undefined)
        assertUnique(
            models.map((model) =>
                'profile' in model
                    ? `profile:${model.profile}`
                    : `name:${model.name}`
            ),
            'model names and profile references'
        );
    const conditions =
        value.conditions === undefined
            ? undefined
            : parseConditions(value.conditions);
    const authority =
        value.authority === undefined
            ? undefined
            : parseModelSettings(value.authority, 'authority');
    if (
        value.version === 1 &&
        (models === undefined || !Array.isArray(value.settings))
    )
        throw new Error('version 1 configs must define models and settings.');
    if (
        value.version === 2 &&
        (conditions === undefined || authority === undefined)
    )
        throw new Error(
            'version 2 configs must define authority and conditions.'
        );
    const casesValue = value.cases === 'core' ? options.coreCases : value.cases;
    const cases = parseResponseComparisonCases(casesValue);
    if (!isRecord(value.review)) throw new Error('review must be an object.');
    exactKeys(
        value.review,
        ['mustKeep', 'rate', 'automaticReviewer', 'blind'],
        'review'
    );
    const mustKeep: ResponseComparisonReviewConfig['mustKeep'] | undefined = (
        value.review.mustKeep as unknown[] | undefined
    )?.map((item) =>
        enumValue(
            item,
            [
                'facts',
                'uncertainty',
                'sources',
                'authority',
                'safety',
                'unsupported_additions',
            ] as const,
            'review.mustKeep'
        )
    );
    const rate: ResponseComparisonReviewConfig['rate'] | undefined = (
        value.review.rate as unknown[] | undefined
    )?.map((item) =>
        enumValue(
            item,
            ['naturalness', 'persona', 'clarity', 'usefulness'] as const,
            'review.rate'
        )
    );
    if (
        !mustKeep?.length ||
        !rate?.length ||
        typeof value.review.blind !== 'boolean'
    )
        throw new Error(
            'review must define non-empty mustKeep/rate lists and blind.'
        );
    assertUnique(mustKeep, 'review.mustKeep');
    assertUnique(rate, 'review.rate');
    let automaticReviewer: ResponseComparisonModelSettings | undefined;
    if (value.review.automaticReviewer !== undefined) {
        automaticReviewer = parseModelSettings(
            value.review.automaticReviewer,
            'review.automaticReviewer'
        );
    }
    const settings =
        value.settings === undefined
            ? undefined
            : parseSettings(value.settings);
    if (settings !== undefined)
        assertUnique(
            settings.map((setting) => hash(setting)),
            'settings variants'
        );
    return {
        version: value.version,
        name: text(value.name, 'name'),
        ...(models !== undefined && { models }),
        ...(settings !== undefined && { settings }),
        ...(authority !== undefined && { authority }),
        ...(conditions !== undefined && { conditions }),
        repeats: integer(value.repeats, 'repeats'),
        cases,
        review: {
            mustKeep,
            rate,
            ...(automaticReviewer !== undefined && { automaticReviewer }),
            blind: value.review.blind,
        },
    };
};

export const loadResponseComparisonConfig = (
    configPath: string,
    repoRoot = process.cwd()
): { config: ResponseComparisonConfig; raw: string; hash: string } => {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed: unknown = yaml.load(raw);
    const coreCases =
        isRecord(parsed) && parsed.cases === 'core'
            ? (() => {
                  const fixturePath = path.join(
                      repoRoot,
                      'response-comparison/core-cases.yaml'
                  );
                  const fixture = yaml.load(
                      fs.readFileSync(fixturePath, 'utf8')
                  );
                  return isRecord(fixture) && Array.isArray(fixture.cases)
                      ? fixture.cases
                      : undefined;
              })()
            : undefined;
    const config = parseResponseComparisonConfig(parsed, { coreCases });
    return { config, raw, hash: hash(config) };
};

export const settingToRequest = (
    setting: ResponseComparisonSetting
): PresentationGenerationSettings =>
    setting === 'default'
        ? {}
        : (() => {
              const { name: _name, prompt, ...controls } = setting;
              return {
                  ...controls,
                  ...(prompt !== undefined && { promptVariant: prompt }),
              };
          })();

export const rawProfile = (
    model: Extract<ResponseComparisonModel, { name: string }>
): ModelProfile => ({
    id: `comparison-${model.name}`,
    description: `Temporary comparison model: ${model.name}.`,
    provider: model.provider,
    providerModel: model.model,
    enabled: true,
    tierBindings: [],
    capabilities: { canUseSearch: false },
});

export type ResponseComparisonOpenRouterDiscoveredModel = {
    supportedParameters?: string[];
    reasoning?: {
        mandatory?: boolean;
        supportedEfforts?: string[];
        defaultEffort?: string;
    };
};

const isSupportedReasoningEffort = (
    value: string
): value is SupportedReasoningEffort =>
    ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value);

/** Applies provider discovery only to ephemeral comparison profiles. */
export const applyOpenRouterCapabilities = (
    profile: ModelProfile,
    discovered: ResponseComparisonOpenRouterDiscoveredModel | undefined
): ModelProfile => {
    if (
        profile.provider !== 'openrouter' ||
        discovered === undefined ||
        !profile.id.startsWith('comparison-')
    )
        return profile;
    const supportedParameters = new Set(discovered.supportedParameters ?? []);
    const supportedSamplingControls = [
        ...(supportedParameters.has('temperature')
            ? (['temperature'] as const)
            : []),
        ...(supportedParameters.has('top_p') ? (['topP'] as const) : []),
    ];
    const discoveredReasoningEfforts =
        discovered.reasoning?.supportedEfforts?.filter(
            isSupportedReasoningEffort
        );
    const supportedReasoningEfforts =
        discoveredReasoningEfforts !== undefined
            ? discoveredReasoningEfforts
            : discovered.reasoning?.mandatory === true
              ? []
              : undefined;
    const toolCapabilities = {
        ...(profile.capabilities.toolCapabilities ?? {}),
        ...(supportedParameters.has('structured_outputs') && {
            'routing.generation.structured-cheap': true,
        }),
    };
    return {
        ...profile,
        capabilities: {
            ...profile.capabilities,
            ...(supportedSamplingControls.length > 0 && {
                supportedSamplingControls: [...supportedSamplingControls],
            }),
            ...(supportedReasoningEfforts !== undefined && {
                supportedReasoningEfforts: [...supportedReasoningEfforts],
            }),
            ...(Object.keys(toolCapabilities).length > 0 && {
                toolCapabilities,
            }),
        },
    };
};

export type ComparisonDependencies = {
    profiles: ReadonlyMap<string, ModelProfile>;
    generationRuntime: GenerationRuntime;
    runCandidate: (input: {
        generationRuntime: GenerationRuntime;
        generationRequest: import('../../packages/agent-runtime/src/index.js').GenerationRequest;
        config: import('../../packages/backend/src/services/presentation.js').PresentationConfig;
        persona: PresentationPersona;
    }) => Promise<PresentationResult>;
    resolvePersona?: (input: ResponseComparisonCase) => PresentationPersona;
    prepareProfile?: (profile: ModelProfile) => Promise<ModelProfile>;
    checkProviderSupport?: (
        profile: ModelProfile,
        settings: PresentationGenerationSettings
    ) => Promise<ResponseComparisonSupportEvidence>;
    automaticReviewer?: (
        attempt: ResponseComparisonAttempt
    ) => Promise<ResponseComparisonAutomaticReview | undefined>;
    runWorkflow?: (input: {
        condition: ResponseComparisonCondition;
        item: ResponseComparisonCase;
        persona: PresentationPersona;
        candidateProfile?: ModelProfile;
        authoritativeProfile: ModelProfile;
        authoritativeReasoningEffort?: SupportedReasoningEffort;
        onStage?: (progress: ResponseComparisonStageProgress) => void;
    }) => Promise<ResponseComparisonWorkflowResult>;
    onProgress?: (event: ResponseComparisonProgressEvent) => void;
    gitSha?: string;
    dependencies?: Record<string, string>;
};

const defaultPersona = (item: ResponseComparisonCase): PresentationPersona => {
    return {
        id: item.persona,
        presentationGuidance:
            'Use clear, direct prose while preserving the authoritative context.',
        expressionStrength: item.expressionStrength,
        expressionSource: 'request',
        expressionGuidance: `Persona expression strength: ${item.expressionStrength}. This controls prose only; preserve facts, uncertainty, attribution, permissions, provenance, TRACE, and safety decisions.`,
    };
};

export const resolveModel = (
    model: ResponseComparisonModel,
    profiles: ReadonlyMap<string, ModelProfile>
): ModelProfile | null =>
    'profile' in model
        ? (profiles.get(model.profile) ?? null)
        : rawProfile(model);

export const responseComparisonAuthoritativeModel = (
    config: ResponseComparisonConfig
): ResponseComparisonModel => {
    if (config.authority !== undefined) return config.authority.model;
    throw new Error(
        'Comparison config does not define an authoritative model.'
    );
};

const attemptIdFor = (
    configHash: string,
    model: ResponseComparisonModel,
    setting: ResponseComparisonSetting,
    caseId: string,
    repeat: number
): string => hash({ configHash, model, setting, caseId, repeat }).slice(0, 24);

const toCost = (
    profile: ModelProfile,
    result: GenerationResult
): { value?: number; source?: 'provider_reported' | 'backend_estimate' } => {
    const reported = result.upstreamAttribution?.upstreamReportedCostUsd;
    if (reported !== undefined)
        return { value: reported, source: 'provider_reported' };
    const inputTokens = result.usage?.promptTokens;
    const outputTokens = result.usage?.completionTokens;
    if (
        profile.provider === 'openai' &&
        inputTokens !== undefined &&
        outputTokens !== undefined
    ) {
        return {
            value: estimateOpenAITextCost(
                profile.providerModel,
                inputTokens,
                outputTokens
            ).totalCost,
            source: 'backend_estimate',
        };
    }
    return {};
};

export const stageFromResult = (
    result: GenerationResult | undefined,
    profile: ModelProfile | undefined,
    startedAt: number,
    finishedAt: number,
    failure?: string
): ResponseComparisonStage => {
    if (result === undefined)
        return {
            status: failure === undefined ? 'not_run' : 'failed',
            ...(failure !== undefined && { failure }),
            operations: { latencyMs: Math.max(0, finishedAt - startedAt) },
        };
    const cost = profile === undefined ? {} : toCost(profile, result);
    return {
        status: failure === undefined ? 'completed' : 'failed',
        text: result.text,
        completion: result.completion,
        attribution: {
            ...(profile?.provider !== undefined && {
                requestedProvider: profile.provider,
            }),
            ...(profile?.providerModel !== undefined && {
                requestedModel: profile.providerModel,
            }),
            ...(result.upstreamAttribution?.inferenceProvider !== undefined && {
                observedProvider: result.upstreamAttribution.inferenceProvider,
            }),
            ...(result.model !== undefined && {
                observedModel: result.model,
            }),
        },
        operations: {
            latencyMs: Math.max(0, finishedAt - startedAt),
            promptTokens: result.usage?.promptTokens,
            completionTokens: result.usage?.completionTokens,
            totalTokens: result.usage?.totalTokens,
            costUsd: cost.value,
            costSource: cost.source,
            outputLength: result.text.length,
        },
        ...(failure !== undefined && { failure }),
    };
};

export type ResponseComparisonWorkflowCallStage =
    'candidate' | 'authoritative' | 'assessment' | 'revision' | 'final';

export type ResponseComparisonWorkflowCallLike = {
    stage: ResponseComparisonWorkflowCallStage;
};

/** Selects stage calls without treating review calls as generated answer text. */
export const selectResponseComparisonWorkflowCalls = <
    T extends ResponseComparisonWorkflowCallLike,
>(
    calls: readonly T[]
): {
    candidateCall: T | undefined;
    authoritativeCall: T | undefined;
    revisionCalls: T[];
    finalCall: T | undefined;
} => {
    const candidateCall = calls.find((call) => call.stage === 'candidate');
    const authoritativeCall = calls.find(
        (call) => call.stage === 'authoritative'
    );
    const revisionCalls = calls.filter((call) => call.stage === 'revision');
    const finalCall = [...calls]
        .reverse()
        .find(
            (call) =>
                call.stage === 'revision' ||
                call.stage === 'final' ||
                call.stage === 'authoritative'
        );
    return { candidateCall, authoritativeCall, revisionCalls, finalCall };
};

const looksLikeCandidateArtifact = (text: string): boolean =>
    /^[A-Z0-9 _-]{3,40}$/u.test(text) &&
    /\b(?:BEGIN|END|START|STOP)\b/u.test(text);

/** Separates a usable candidate from a fail-open provider result or artifact. */
export const classifyCandidateAvailability = (
    stage: ResponseComparisonStage
): ResponseComparisonCandidateAvailability => {
    if (stage.status === 'not_run') return 'not_attempted';
    if (stage.status === 'failed') return 'unavailable';
    const candidateText = stage.text?.trim() ?? '';
    return candidateText.length > 0 &&
        !looksLikeCandidateArtifact(candidateText)
        ? 'usable'
        : 'unavailable';
};

const universalFinalRequirement =
    RESPONSE_COMPARISON_UNSUPPORTED_ADDITIONS_REQUIREMENT;

/**
 * Flags candidate material that deserves separate final-answer scrutiny.
 * This is diagnostic, not an admission rule: authoritative context and the
 * final semantic review decide whether a signal is actually unsupported.
 */
export const detectCandidateChangeHints = (input: {
    candidateText: string | undefined;
    authoritativeContext: RuntimeMessage[];
}): ResponseComparisonCandidateChangeHint => {
    if (input.candidateText === undefined)
        return { detected: false, evidence: [], method: 'heuristic' };
    const context = input.authoritativeContext
        .map((message) => message.content)
        .join('\n');
    const evidence: string[] = [];
    const unknownNumbers = (
        input.candidateText.match(/\b\d+(?:\.\d+)?\b/gu) ?? []
    ).filter((value) => !context.includes(value));
    if (unknownNumbers.length > 0)
        evidence.push(
            `candidate introduced numeric material: ${unknownNumbers.join(', ')}`
        );
    const unknownSources = (
        input.candidateText.match(/https?:\/\/[^\s)]+/giu) ?? []
    ).filter((value) => !context.includes(value));
    if (unknownSources.length > 0)
        evidence.push(
            `candidate introduced source material: ${unknownSources.join(', ')}`
        );
    if (
        /\b(?:recommend(?:ation)?|policy|conclusion|therefore|should)\b/iu.test(
            input.candidateText
        )
    )
        evidence.push(
            'candidate contains substantive recommendation or conclusion language'
        );
    return { detected: evidence.length > 0, evidence, method: 'heuristic' };
};

const reviewRequirementsFor = (
    item: ResponseComparisonCase,
    review: ResponseComparisonReviewConfig,
    includeUniversal: boolean
): ResponseComparisonCase['requirements'] => {
    const requirements = item.requirements.filter((requirement) =>
        review.mustKeep.includes(requirement.kind)
    );
    return includeUniversal
        ? [
              ...requirements.filter(
                  (requirement) =>
                      requirement.id !== universalFinalRequirement.id
              ),
              universalFinalRequirement,
          ]
        : requirements;
};

const toWorkflowAttempt = async (input: {
    configHash: string;
    condition: ResponseComparisonCondition;
    item: ResponseComparisonCase;
    repeat: number;
    candidateProfile?: ModelProfile;
    authoritativeProfile: ModelProfile;
    authority: ResponseComparisonModelSettings;
    persona: PresentationPersona;
    support?: (
        profile: ModelProfile,
        settings: PresentationGenerationSettings
    ) => Promise<ResponseComparisonSupportEvidence>;
    reviewRequirements: ResponseComparisonCase['requirements'];
    automaticReview?: (
        attempt: ResponseComparisonAttempt
    ) => Promise<ResponseComparisonAutomaticReview | undefined>;
    runWorkflow?: ComparisonDependencies['runWorkflow'];
    reportStage?: (progress: ResponseComparisonStageProgress) => void;
}): Promise<ResponseComparisonAttempt> => {
    const authoritativeModel = input.authority.model;
    const comparisonId = hash({
        configHash: input.configHash,
        condition: input.condition,
        caseId: input.item.id,
        repeat: input.repeat,
    }).slice(0, 24);
    const source = {
        messages: input.item.messages,
        persona: input.item.persona,
        resolvedGuidance: input.persona.presentationGuidance,
        expressionStrength: input.persona.expressionStrength,
        guidanceHash: hash({
            presentation: input.persona.presentationGuidance,
            expression: input.persona.expressionGuidance,
        }),
        requirements: input.item.requirements,
        expressionGuidance: input.persona.expressionGuidance,
        reviewRequirements: input.reviewRequirements,
    };
    const base = {
        attemptId: comparisonId,
        comparisonId,
        model: input.condition.candidateModel ?? authoritativeModel,
        setting: 'default' as const,
        caseId: input.item.id,
        repeat: input.repeat,
        condition: input.condition,
        authoritativeModel,
        source,
    };
    if (input.runWorkflow === undefined)
        return {
            ...base,
            status: 'failed',
            reason: 'workflow_executor_not_configured',
            stages: {
                candidate: { status: 'not_run' },
                authoritative: {
                    status: 'not_run',
                    failure: 'workflow_executor_not_configured',
                },
                final: {
                    status: 'failed',
                    failure: 'workflow_executor_not_configured',
                },
            },
            candidateAvailability:
                input.candidateProfile === undefined
                    ? 'not_attempted'
                    : 'unavailable',
            correctionDecisions: [],
            candidateChangeHint: {
                detected: false,
                evidence: [],
                method: 'heuristic',
            },
        };
    let support: ResponseComparisonSupportEvidence | undefined;
    if (input.candidateProfile !== undefined && input.support !== undefined) {
        try {
            support = await input.support(input.candidateProfile, {
                promptVariant: input.condition.candidatePromptVariant,
            });
        } catch {
            support = {
                checkedAt: new Date().toISOString(),
                source: 'catalog_profile',
                modelId: input.candidateProfile.providerModel,
                status: 'failed',
                reasonCode: 'provider_support_check_failed',
            };
        }
        if (support.status !== 'supported')
            return {
                ...base,
                status: 'not_tested',
                reason:
                    support.reasonCode ?? `provider_support_${support.status}`,
                support,
            };
    }
    const startedAt = Date.now();
    try {
        const workflow = await input.runWorkflow({
            condition: input.condition,
            item: input.item,
            persona: input.persona,
            ...(input.candidateProfile !== undefined && {
                candidateProfile: input.candidateProfile,
            }),
            authoritativeProfile: input.authoritativeProfile,
            ...(input.authority.reasoningEffort !== undefined && {
                authoritativeReasoningEffort: input.authority.reasoningEffort,
            }),
            ...(input.reportStage !== undefined && {
                onStage: input.reportStage,
            }),
        });
        const finalText = workflow.final.text;
        const attempt: ResponseComparisonAttempt = {
            ...base,
            status:
                workflow.final.status === 'completed' ? 'completed' : 'failed',
            ...(workflow.final.status !== 'completed' && {
                reason: workflow.final.failure ?? 'final_stage_failed',
            }),
            stages: {
                candidate: workflow.candidate,
                authoritative: workflow.authoritative,
                final: workflow.final,
                revisions: workflow.revisions,
            },
            candidateAvailability:
                workflow.candidateAvailability ??
                classifyCandidateAvailability(workflow.candidate),
            correctionDecisions: workflow.correctionDecisions,
            candidateChangeHint: workflow.candidateChangeHint,
            ...(support !== undefined && { support }),
            ...(finalText !== undefined && {
                output: { text: finalText },
            }),
            attribution: workflow.final.attribution,
            operations: {
                latencyMs: Date.now() - startedAt,
                promptTokens: [
                    workflow.candidate,
                    workflow.authoritative,
                    workflow.final,
                ].reduce(
                    (sum, stage) => sum + (stage.operations?.promptTokens ?? 0),
                    0
                ),
                completionTokens: [
                    workflow.candidate,
                    workflow.authoritative,
                    workflow.final,
                ].reduce(
                    (sum, stage) =>
                        sum + (stage.operations?.completionTokens ?? 0),
                    0
                ),
                totalTokens: [
                    workflow.candidate,
                    workflow.authoritative,
                    workflow.final,
                ].reduce(
                    (sum, stage) => sum + (stage.operations?.totalTokens ?? 0),
                    0
                ),
                costUsd: [
                    workflow.candidate,
                    workflow.authoritative,
                    workflow.final,
                ].reduce(
                    (sum, stage) => sum + (stage.operations?.costUsd ?? 0),
                    0
                ),
                outputLength: finalText?.length,
            },
        };
        if (input.automaticReview !== undefined && attempt.output !== undefined)
            attempt.automaticReview = await input.automaticReview(attempt);
        attempt.unsupportedChangesReview = readUnsupportedChangesReview(
            attempt.automaticReview
        );
        return attempt;
    } catch (error) {
        return {
            ...base,
            status: 'failed',
            reason:
                error instanceof Error ? error.message : 'comparison_failed',
            stages: {
                candidate: { status: 'not_run' },
                authoritative: { status: 'failed', failure: 'workflow_failed' },
                final: {
                    status: 'failed',
                    failure:
                        error instanceof Error
                            ? error.message
                            : 'comparison_failed',
                },
            },
            candidateAvailability:
                input.candidateProfile === undefined
                    ? 'not_attempted'
                    : 'unavailable',
            correctionDecisions: [],
            candidateChangeHint: {
                detected: false,
                evidence: [],
                method: 'heuristic',
            },
            operations: { latencyMs: Date.now() - startedAt },
        };
    }
};

const toAttempt = async (input: {
    configHash: string;
    model: ResponseComparisonModel;
    setting: ResponseComparisonSetting;
    item: ResponseComparisonCase;
    repeat: number;
    profile: ModelProfile;
    persona: PresentationPersona;
    runtime: GenerationRuntime;
    runCandidate: ComparisonDependencies['runCandidate'];
    support?: (
        profile: ModelProfile,
        settings: PresentationGenerationSettings
    ) => Promise<ResponseComparisonSupportEvidence>;
    reviewRequirements: ResponseComparisonCase['requirements'];
    automaticReview?: (
        attempt: ResponseComparisonAttempt
    ) => Promise<ResponseComparisonAutomaticReview | undefined>;
}): Promise<ResponseComparisonAttempt> => {
    const comparisonId = attemptIdFor(
        input.configHash,
        input.model,
        input.setting,
        input.item.id,
        input.repeat
    );
    const settings = settingToRequest(input.setting);
    const source = {
        messages: input.item.messages,
        persona: input.item.persona,
        resolvedGuidance: input.persona.presentationGuidance,
        expressionStrength: input.persona.expressionStrength,
        guidanceHash: hash({
            presentation: input.persona.presentationGuidance,
            expression: input.persona.expressionGuidance,
        }),
        requirements: input.item.requirements,
        expressionGuidance: input.persona.expressionGuidance,
        reviewRequirements: input.reviewRequirements,
    };
    let support: ResponseComparisonSupportEvidence;
    try {
        support = input.support
            ? await input.support(input.profile, settings)
            : {
                  checkedAt: new Date().toISOString(),
                  source: 'catalog_profile' as const,
                  modelId: input.profile.providerModel,
                  status: 'supported' as const,
              };
    } catch {
        support = {
            checkedAt: new Date().toISOString(),
            source: 'catalog_profile',
            modelId: input.profile.providerModel,
            status: 'failed',
            reasonCode: 'provider_support_check_failed',
        };
    }
    if (support.status !== 'supported')
        return {
            attemptId: comparisonId,
            comparisonId,
            model: input.model,
            setting: input.setting,
            caseId: input.item.id,
            repeat: input.repeat,
            status: 'not_tested',
            reason: support.reasonCode ?? `provider_support_${support.status}`,
            source,
            support,
            candidateAvailability: 'unavailable',
        };
    const startedAt = Date.now();
    try {
        const result = await input.runCandidate({
            generationRuntime: input.runtime,
            generationRequest: {
                messages: input.item.messages,
                model: input.profile.providerModel,
                provider: input.profile.provider,
                capabilities: input.profile.capabilities,
                providerRouting: input.profile.providerRouting,
                ...settings,
            },
            config: {
                enabled: true,
                profileId: input.profile.id,
                timeoutMs: 30000,
                profile: {
                    ...input.profile,
                    presentationGeneration: undefined,
                },
            },
            persona: input.persona,
        });
        const cost = result.draftResult
            ? toCost(input.profile, result.draftResult)
            : {};
        const attempt: ResponseComparisonAttempt = {
            attemptId: comparisonId,
            comparisonId,
            model: input.model,
            setting: input.setting,
            caseId: input.item.id,
            repeat: input.repeat,
            status:
                result.outcome === 'candidate_generated'
                    ? 'completed'
                    : 'failed',
            ...(result.outcome !== 'candidate_generated' && {
                reason: result.metadata.reasonCode,
            }),
            source,
            support,
            candidateAvailability: classifyCandidateAvailability({
                status:
                    result.outcome === 'candidate_generated'
                        ? 'completed'
                        : 'failed',
                ...(result.draftResult !== undefined && {
                    text: result.draftResult.text,
                }),
                ...(result.outcome !== 'candidate_generated' && {
                    failure: result.metadata.reasonCode,
                }),
            }),
            ...(result.draftResult !== undefined && {
                output: {
                    text: result.draftResult.text,
                    completion: result.draftResult.completion,
                },
            }),
            ...(result.metadata.presentationSettings !== undefined && {
                settingsEvidence: result.metadata.presentationSettings,
            }),
            attribution: {
                requestedProvider: input.profile.provider,
                requestedModel: input.profile.providerModel,
                observedProvider: result.metadata.draftObservedProvider,
                observedModel: result.metadata.draftObservedModel,
            },
            operations: {
                latencyMs: Date.now() - startedAt,
                promptTokens: result.draftResult?.usage?.promptTokens,
                completionTokens: result.draftResult?.usage?.completionTokens,
                totalTokens: result.draftResult?.usage?.totalTokens,
                costUsd: cost.value,
                costSource: cost.source,
                outputLength: result.draftResult?.text.length,
            },
        };
        if (
            input.automaticReview !== undefined &&
            attempt.status === 'completed'
        )
            attempt.automaticReview = await input.automaticReview(attempt);
        return attempt;
    } catch (error) {
        return {
            attemptId: comparisonId,
            comparisonId,
            model: input.model,
            setting: input.setting,
            caseId: input.item.id,
            repeat: input.repeat,
            status: 'failed',
            reason:
                error instanceof Error ? error.message : 'comparison_failed',
            source,
            support,
            candidateAvailability: 'unavailable',
            operations: { latencyMs: Date.now() - startedAt },
        };
    }
};

const checkpointPath = (root: string, runId: string): string =>
    path.join(root, runId, 'checkpoint.jsonl');
const activeRunPath = (root: string, configHash: string): string =>
    path.join(root, `${configHash}.active`);
const createRunId = (): string =>
    `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
const resolveRunId = (root: string, configHash: string): string => {
    const pointer = activeRunPath(root, configHash);
    if (fs.existsSync(pointer)) {
        const activeRunId = fs.readFileSync(pointer, 'utf8').trim();
        if (activeRunId !== '') return activeRunId;
    }
    const runId = createRunId();
    fs.writeFileSync(pointer, `${runId}\n`, 'utf8');
    return runId;
};
const readCheckpoint = (
    filePath: string
): Map<string, ResponseComparisonAttempt> => {
    const entries = new Map<string, ResponseComparisonAttempt>();
    if (!fs.existsSync(filePath)) return entries;
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
            const parsed: unknown = JSON.parse(line);
            if (isRecord(parsed) && typeof parsed.attemptId === 'string')
                entries.set(
                    parsed.attemptId,
                    parsed as unknown as ResponseComparisonAttempt
                );
        } catch {
            /* Preserve a partial run and continue. */
        }
    }
    return entries;
};

const appendCheckpoint = (
    filePath: string,
    attempt: ResponseComparisonAttempt
): void => {
    fs.appendFileSync(filePath, `${JSON.stringify(attempt)}\n`, 'utf8');
};

export const buildReportHtml = (report: ResponseComparisonReport): string => {
    const embedded = JSON.stringify(report)
        .replaceAll('<', '\\u003c')
        .replaceAll('>', '\\u003e')
        .replaceAll('&', '\\u0026');
    const script = String.raw`(function () {
    'use strict';
    const report = JSON.parse(
        document.getElementById('canonical-report').textContent
    );
    const app = document.getElementById('app');
    const storageKey = 'response-comparison:' + report.reportId;
    const add = (tag, content, cls) => {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        node.textContent = content;
        return node;
    };
    const save = () => {
        try {
            localStorage.setItem(
                storageKey,
                JSON.stringify({
                    humanReviews: report.humanReviews,
                    reviewerName: report.reviewerName,
                    blindnessEvents: report.blindnessEvents,
                })
            );
        } catch {}
    };
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (saved) {
            report.humanReviews = Array.isArray(saved.humanReviews)
                ? saved.humanReviews
                : report.humanReviews;
            report.reviewerName =
                typeof saved.reviewerName === 'string'
                    ? saved.reviewerName
                    : report.reviewerName;
            report.blindnessEvents = Array.isArray(saved.blindnessEvents)
                ? saved.blindnessEvents
                : report.blindnessEvents;
        }
    } catch {}
    let blind =
        Boolean(report.config.review.blind) &&
        !report.blindnessEvents.some((event) => event.action === 'revealed');
    const median = (values) => {
        const sorted = values
            .filter((value) => typeof value === 'number')
            .sort((a, b) => a - b);
        if (!sorted.length) return null;
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2
            ? sorted[middle]
            : (sorted[middle - 1] + sorted[middle]) / 2;
    };
    const modelLabel = (attempt) =>
        attempt.condition?.id ||
        attempt.model.profile ||
        attempt.model.name ||
        'candidate';
    const settingLabel = (setting) =>
        setting === 'default' ? 'Provider defaults' : JSON.stringify(setting);
    const scrollToAttempt = (attemptId) =>
        document
            .getElementById('attempt-' + attemptId)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const formatMoney = (value) =>
        value === null ? '—' : '$' + value.toFixed(6);
    const renderSummary = () => {
        const summary = add('section');
        summary.setAttribute('data-role', 'comparison-summary');
        summary.append(add('h2', 'Summary'));
        summary.append(
            add(
                'p',
                'Completed: ' +
                    report.attempts.filter((a) => a.status === 'completed')
                        .length +
                    ' | Not tested: ' +
                    report.attempts.filter((a) => a.status === 'not_tested')
                        .length +
                    ' | Failed: ' +
                    report.attempts.filter((a) => a.status === 'failed').length
            )
        );
        summary.append(
            add(
                'p',
                'Requirements checked: ' +
                    report.config.review.mustKeep.join(', ') +
                    ' (automatic and human reviews stay separate; no combined winner score)',
                'muted'
            )
        );
        if (!blind) {
            summary.append(add('h3', 'Results'));
            const groups = new Map();
            for (const attempt of report.attempts) {
                const key =
                    attempt.condition?.id ||
                    JSON.stringify([attempt.model, attempt.setting]);
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(attempt);
            }
            const table = document.createElement('table');
            table.className = 'comparison';
            const head = document.createElement('tr');
            for (const label of [
                'Model / setting',
                'Ran',
                'Candidate availability',
                'Auto reviewed',
                'Requirements passed',
                'Final gate',
                'Auto scores',
                'Human scores',
                'Typical time',
                'Generation cost',
                'Review cost',
                'Total cost',
                'Output rate',
            ])
                head.append(add('th', label));
            table.append(head);
            for (const group of groups.values()) {
                const row = document.createElement('tr');
                const first = group[0];
                const completed = group.filter((a) => a.status === 'completed');
                const reviews = completed
                    .map((a) => a.automaticReview)
                    .filter((a) => a?.status === 'completed');
                const failedReviews = completed.filter(
                    (a) => a.automaticReview?.status !== 'completed'
                );
                const mustKeep = reviews.flatMap((review) => review.mustKeep);
                const candidateCounts = group.reduce(
                    (counts, a) => {
                        const value =
                            a.candidateAvailability ||
                            (a.stages?.candidate?.status === 'completed' &&
                            a.stages.candidate.text?.trim()
                                ? 'usable'
                                : a.stages?.candidate?.status === 'not_run'
                                  ? 'not_attempted'
                                  : 'unavailable');
                        counts[value] = (counts[value] || 0) + 1;
                        return counts;
                    },
                    { usable: 0, unavailable: 0, not_attempted: 0 }
                );
                const gateCounts = completed.reduce(
                    (counts, a) => {
                        const value =
                            a.unsupportedChangesReview?.status || 'not_run';
                        counts[value] = (counts[value] || 0) + 1;
                        return counts;
                    },
                    { pass: 0, fail: 0, uncertain: 0, not_run: 0 }
                );
                const rates = new Map();
                for (const review of reviews)
                    for (const rating of review.ratings) {
                        const values = rates.get(rating.dimension) || [];
                        values.push(rating.score);
                        rates.set(rating.dimension, values);
                    }
                const human = report.humanReviews.filter(
                    (entry) =>
                        completed.some(
                            (attempt) => attempt.attemptId === entry.attemptId
                        ) && typeof entry.score === 'number'
                );
                const humanAttemptIds = new Set(
                    human.map((entry) => entry.attemptId)
                );
                const humanRates = new Map();
                for (const entry of human) {
                    const values = humanRates.get(entry.dimension) || [];
                    values.push(entry.score);
                    humanRates.set(entry.dimension, values);
                }
                const label = document.createElement('button');
                label.textContent =
                    modelLabel(first) + ' | ' + settingLabel(first.setting);
                label.onclick = () => scrollToAttempt(first.attemptId);
                const labelCell = document.createElement('td');
                labelCell.append(label);
                row.append(labelCell);
                row.append(add('td', completed.length + '/' + group.length));
                row.append(
                    add(
                        'td',
                        candidateCounts.usable +
                            ' usable / ' +
                            candidateCounts.unavailable +
                            ' unavailable / ' +
                            candidateCounts.not_attempted +
                            ' not attempted'
                    )
                );
                row.append(
                    add(
                        'td',
                        reviews.length +
                            '/' +
                            completed.length +
                            (failedReviews.length
                                ? ' (' +
                                  failedReviews.length +
                                  ' reviewer failures)'
                                : '')
                    )
                );
                row.append(
                    add(
                        'td',
                        mustKeep.length
                            ? mustKeep.filter((item) => item.result === 'pass')
                                  .length +
                                  '/' +
                                  mustKeep.length
                            : '—'
                    )
                );
                row.append(
                    add(
                        'td',
                        gateCounts.pass +
                            ' pass / ' +
                            gateCounts.fail +
                            ' fail / ' +
                            gateCounts.uncertain +
                            ' uncertain / ' +
                            gateCounts.not_run +
                            ' not run'
                    )
                );
                row.append(
                    add(
                        'td',
                        report.config.review.rate
                            .map((dimension) => {
                                const values = rates.get(dimension) || [];
                                return (
                                    dimension +
                                    ': ' +
                                    (values.length
                                        ? median(values)?.toFixed(1)
                                        : '—')
                                );
                            })
                            .join(' | ')
                    )
                );
                row.append(
                    add(
                        'td',
                        humanAttemptIds.size +
                            '/' +
                            completed.length +
                            ' attempts; ' +
                            report.config.review.rate
                                .map((dimension) => {
                                    const values =
                                        humanRates.get(dimension) || [];
                                    return (
                                        dimension +
                                        ': ' +
                                        (values.length
                                            ? median(values)?.toFixed(1)
                                            : '—')
                                    );
                                })
                                .join(' | ')
                    )
                );
                const latencies = completed
                    .map((a) => a.operations?.latencyMs)
                    .filter((v) => typeof v === 'number');
                const generationCosts = completed
                    .map((a) => a.operations?.costUsd)
                    .filter((v) => typeof v === 'number');
                const reviewCosts = reviews
                    .map((review) => review.timing?.costUsd)
                    .filter((v) => typeof v === 'number');
                const totalCosts = completed
                    .map((attempt) => {
                        const review =
                            attempt.automaticReview?.status === 'completed'
                                ? attempt.automaticReview.timing?.costUsd
                                : undefined;
                        const generation = attempt.operations?.costUsd;
                        return typeof generation === 'number' ||
                            typeof review === 'number'
                            ? (generation || 0) + (review || 0)
                            : null;
                    })
                    .filter((v) => typeof v === 'number');
                const ratesPerAttempt = completed
                    .map((a) =>
                        typeof a.operations?.completionTokens === 'number' &&
                        typeof a.operations?.latencyMs === 'number' &&
                        a.operations.latencyMs > 0
                            ? a.operations.completionTokens /
                              (a.operations.latencyMs / 1000)
                            : null
                    )
                    .filter((v) => typeof v === 'number');
                row.append(
                    add(
                        'td',
                        latencies.length
                            ? Math.round(median(latencies)) + ' ms'
                            : '—'
                    )
                );
                row.append(
                    add(
                        'td',
                        generationCosts.length
                            ? formatMoney(median(generationCosts))
                            : '—'
                    )
                );
                row.append(
                    add(
                        'td',
                        reviewCosts.length
                            ? formatMoney(median(reviewCosts))
                            : '—'
                    )
                );
                row.append(
                    add(
                        'td',
                        totalCosts.length
                            ? formatMoney(median(totalCosts))
                            : '—'
                    )
                );
                row.append(
                    add(
                        'td',
                        ratesPerAttempt.length
                            ? median(ratesPerAttempt).toFixed(2)
                            : '—'
                    )
                );
                table.append(row);
            }
            summary.append(table);
            summary.append(
                add(
                    'p',
                    'Automatic and human reviews are shown separately. Output rate is completion tokens per second. Select a model to see its responses.',
                    'muted'
                )
            );
            const findings = report.attempts.flatMap((attempt) =>
                attempt.automaticReview?.status === 'completed'
                    ? attempt.automaticReview.mustKeep
                          .filter((item) => item.result !== 'pass')
                          .map(
                              (item) =>
                                  attempt.caseId +
                                  ' / ' +
                                  item.requirementId +
                                  ': ' +
                                  item.result +
                                  ' - ' +
                                  item.explanation
                          )
                    : attempt.automaticReview?.status === 'failed'
                      ? [
                            attempt.caseId +
                                ': automatic review failed - ' +
                                (attempt.automaticReview.failure ||
                                    'unknown failure'),
                        ]
                      : []
            );
            summary.append(add('h3', 'Requirement problems'));
            summary.append(
                add(
                    'p',
                    findings.length
                        ? findings.join(' | ')
                        : 'No requirement problems or review failures.',
                    'muted'
                )
            );
        }
        return summary;
    };
    const render = () => {
        app.replaceChildren();
        app.append(add('h1', 'Response comparison: ' + report.config.name));
        app.append(
            add(
                'p',
                'Run ' +
                    report.reportId +
                    ' | ' +
                    report.attempts.length +
                    ' planned attempts',
                'muted'
            )
        );
        app.append(renderSummary());
        const controls = add('div');
        const reveal = add(
            'button',
            blind ? 'Reveal metadata' : 'Metadata revealed'
        );
        reveal.disabled = !blind;
        reveal.onclick = () => {
            blind = false;
            report.blindnessEvents.push({
                at: new Date().toISOString(),
                action: 'revealed',
            });
            save();
            render();
        };
        controls.append(reveal);
        const download = add('button', 'Download reviewed HTML');
        download.onclick = () => {
            const reviewed = JSON.parse(JSON.stringify(report));
            reviewed.parentReportId = report.parentReportId || report.reportId;
            reviewed.reportId =
                reviewed.parentReportId + '-reviewed-' + Date.now();
            reviewed.blindnessEvents.push({
                at: new Date().toISOString(),
                action: 'exported',
            });
            const body = JSON.stringify(reviewed)
                .replaceAll('<', '\\u003c')
                .replaceAll('>', '\\u003e')
                .replaceAll('&', '\\u0026');
            const source = document.documentElement.outerHTML;
            const html = source.replace(
                document.getElementById('canonical-report').textContent,
                () => body
            );
            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download =
                'response-comparison-' + reviewed.reportId + '.html';
            link.click();
            URL.revokeObjectURL(url);
        };
        controls.append(download);
        const identity = add('label', 'Reviewer name: ');
        const name = document.createElement('input');
        name.value = report.reviewerName || '';
        name.placeholder = 'Optional';
        name.oninput = () => {
            report.reviewerName = name.value;
            save();
        };
        identity.append(name);
        controls.append(identity);
        app.append(controls);
        if (blind)
            app.append(
                add(
                    'p',
                    'Blind view: model, provider, settings, cost, timing, automatic review, and saved human reviews are hidden. The source remains visible.',
                    'blind-warning'
                )
            );
        const details = add('section');
        details.setAttribute(
            'data-role',
            blind ? 'blind-review' : 'operational-details'
        );
        details.append(add('h2', blind ? 'Blind review queue' : 'Run details'));
        app.append(details);
        for (const attempt of report.attempts) {
            const card = add('article');
            card.id = 'attempt-' + attempt.attemptId;
            card.append(
                add('h2', attempt.caseId + ' / repeat ' + attempt.repeat)
            );
            const reviewRequirements =
                attempt.source?.reviewRequirements ||
                attempt.source?.requirements ||
                [];
            if (attempt.source) {
                const context = add('div');
                context.append(add('h3', 'Source'));
                for (const message of attempt.source.messages)
                    context.append(
                        add('p', message.role + ': ' + message.content)
                    );
                context.append(
                    add(
                        'p',
                        'Persona: ' +
                            attempt.source.persona +
                            ' | strength: ' +
                            attempt.source.expressionStrength
                    )
                );
                context.append(
                    add(
                        'p',
                        'Style guidance: ' + attempt.source.resolvedGuidance
                    )
                );
                context.append(
                    add(
                        'p',
                        'Expression guidance: ' +
                            (attempt.source.expressionGuidance ||
                                attempt.source.resolvedGuidance)
                    )
                );
                context.append(
                    add(
                        'p',
                        'Checks: ' +
                            attempt.source.requirements
                                .map((r) => r.id + ': ' + r.statement)
                                .join(' | '),
                        'muted'
                    )
                );
                card.append(context);
            }
            card.append(
                add(
                    'p',
                    'Status: ' +
                        attempt.status +
                        (attempt.reason ? ' - ' + attempt.reason : ''),
                    'muted'
                )
            );
            if (attempt.output) card.append(add('pre', attempt.output.text));
            if (!blind) {
                card.append(
                    add(
                        'p',
                        'Condition: ' + JSON.stringify(attempt.condition || {})
                    )
                );
                card.append(
                    add('p', 'Model: ' + JSON.stringify(attempt.model))
                );
                card.append(
                    add('p', 'Setting: ' + JSON.stringify(attempt.setting))
                );
                card.append(
                    add(
                        'p',
                        'Model support: ' +
                            JSON.stringify(attempt.support || {})
                    )
                );
                card.append(
                    add(
                        'p',
                        'Candidate availability: ' +
                            (attempt.candidateAvailability || 'not recorded')
                    )
                );
                card.append(
                    add(
                        'p',
                        'Timing and cost: ' +
                            JSON.stringify(attempt.operations || {})
                    )
                );
                card.append(
                    add(
                        'p',
                        'Provider details: ' +
                            JSON.stringify(attempt.attribution || {})
                    )
                );
                if (attempt.stages)
                    card.append(
                        add(
                            'pre',
                            'Stage evidence:\n' +
                                JSON.stringify(attempt.stages, null, 2)
                        )
                    );
                if (attempt.correctionDecisions)
                    card.append(
                        add(
                            'pre',
                            'Correction/revision decisions:\n' +
                                JSON.stringify(
                                    attempt.correctionDecisions,
                                    null,
                                    2
                                )
                        )
                    );
                if (attempt.candidateChangeHint)
                    card.append(
                        add(
                            'pre',
                            'Possible candidate changes (heuristic):\n' +
                                JSON.stringify(
                                    attempt.candidateChangeHint,
                                    null,
                                    2
                                )
                        )
                    );
                if (attempt.unsupportedChangesReview)
                    card.append(
                        add(
                            'p',
                            'Unsupported changes review: ' +
                                JSON.stringify(attempt.unsupportedChangesReview)
                        )
                    );
                if (attempt.automaticReview)
                    card.append(
                        add(
                            'pre',
                            'Automatic review details:\n' +
                                JSON.stringify(attempt.automaticReview, null, 2)
                        )
                    );
            }
            if (attempt.status === 'completed') {
                const review = add('form');
                review.setAttribute('data-role', 'human-review');
                review.append(add('h3', 'Human review'));
                for (const dimension of report.config.review.rate) {
                    const label = add('label', dimension + ': ');
                    const select = document.createElement('select');
                    const unrated = add('option', 'Not rated');
                    unrated.value = '';
                    select.append(unrated);
                    for (let score = 1; score <= 5; score++)
                        select.append(add('option', String(score)));
                    const saved = report.humanReviews.find(
                        (entry) =>
                            entry.attemptId === attempt.attemptId &&
                            entry.dimension === dimension
                    );
                    if (typeof saved?.score === 'number')
                        select.value = String(saved.score);
                    select.onchange = () => {
                        report.humanReviews = report.humanReviews.filter(
                            (entry) =>
                                !(
                                    entry.attemptId === attempt.attemptId &&
                                    entry.dimension === dimension
                                )
                        );
                        if (select.value)
                            report.humanReviews.push({
                                attemptId: attempt.attemptId,
                                dimension,
                                score: Number(select.value),
                                reviewerName: report.reviewerName || undefined,
                                at: new Date().toISOString(),
                            });
                        save();
                    };
                    label.append(select);
                    review.append(label);
                }
                for (const requirement of reviewRequirements) {
                    const line = add('div', '');
                    line.append(add('label', requirement.id + ': '));
                    const result = document.createElement('select');
                    for (const value of [
                        'Not judged',
                        'pass',
                        'fail',
                        'uncertain',
                    ])
                        result.append(add('option', value));
                    const saved = report.humanReviews.find(
                        (entry) =>
                            entry.attemptId === attempt.attemptId &&
                            entry.requirementId === requirement.id
                    );
                    if (typeof saved?.result === 'string')
                        result.value = saved.result;
                    const evidence = document.createElement('textarea');
                    evidence.placeholder = 'Evidence or note';
                    evidence.value =
                        typeof saved?.evidence === 'string'
                            ? saved.evidence
                            : '';
                    const update = () => {
                        report.humanReviews = report.humanReviews.filter(
                            (entry) =>
                                !(
                                    entry.attemptId === attempt.attemptId &&
                                    entry.requirementId === requirement.id
                                )
                        );
                        if (result.value !== 'Not judged' || evidence.value) {
                            report.humanReviews.push({
                                attemptId: attempt.attemptId,
                                requirementId: requirement.id,
                                result: result.value,
                                evidence: evidence.value,
                                reviewerName: report.reviewerName || undefined,
                                at: new Date().toISOString(),
                            });
                        }
                        save();
                    };
                    result.onchange = update;
                    evidence.oninput = update;
                    line.append(result, evidence);
                    review.append(line);
                }
                card.append(review);
            }
            details.append(card);
        }
    };
    render();
})();`;
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Response comparison ${report.reportId}</title>
    <style>
        body { font: 15px system-ui, sans-serif; max-width: 1180px; margin: 2rem auto; padding: 0 1rem; background: #f6f5f1; color: #24231f; }
        article { background: white; border: 1px solid #d8d5cc; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
        pre { white-space: pre-wrap; background: #f0eee8; padding: 1rem; border-radius: 6px; }
        button, input, select, textarea { padding: .5rem .75rem; margin: .25rem; }
        textarea { min-width: 20rem; min-height: 2rem; }
        .muted { color: #68655e; }
        .blind-warning { background: #fff2c2; padding: .75rem; border-radius: 6px; }
        .comparison { border-collapse: collapse; width: 100%; margin: .5rem 0; }
        .comparison th, .comparison td { border: 1px solid #d8d5cc; padding: .5rem; text-align: left; vertical-align: top; }
        .comparison th { background: #f0eee8; }
    </style>
</head>
<body>
    <main id="app"></main>
    <script id="canonical-report" type="application/json">${embedded}</script>
    <script>${script}</script>
</body>
</html>`;
};

export const runResponseComparison = async (input: {
    configPath: string;
    checkpointRoot: string;
    command: string;
    config: ResponseComparisonConfig;
    configHash: string;
    dependencies: ComparisonDependencies;
}): Promise<ResponseComparisonReport> => {
    const startedAt = new Date().toISOString();
    fs.mkdirSync(input.checkpointRoot, { recursive: true });
    const runId = resolveRunId(input.checkpointRoot, input.configHash);
    const runRoot = path.join(input.checkpointRoot, runId);
    fs.mkdirSync(runRoot, { recursive: true });
    const checkpoint = checkpointPath(input.checkpointRoot, runId);
    const known = readCheckpoint(checkpoint);
    const attempts: ResponseComparisonAttempt[] = [...known.values()];
    const totalAttempts =
        (input.config.conditions?.length ?? input.config.models?.length ?? 0) *
        (input.config.conditions === undefined
            ? (input.config.settings?.length ?? 0)
            : 1) *
        input.config.cases.length *
        input.config.repeats;
    const emitProgress = (event: ResponseComparisonProgressEvent): void => {
        input.dependencies.onProgress?.(event);
    };
    const progressModelLabel = (
        model: ResponseComparisonModel,
        profile: ModelProfile
    ): string =>
        'profile' in model
            ? `${model.profile} (${profile.providerModel})`
            : `${model.name} (${model.model})`;
    const finishedCounts = (): {
        completedAttempts: number;
        failedAttempts: number;
        notTestedAttempts: number;
        remainingAttempts: number;
    } => {
        const completedAttempts = attempts.filter(
            (attempt) => attempt.status === 'completed'
        ).length;
        const failedAttempts = attempts.filter(
            (attempt) => attempt.status === 'failed'
        ).length;
        const notTestedAttempts = attempts.filter(
            (attempt) => attempt.status === 'not_tested'
        ).length;
        return {
            completedAttempts,
            failedAttempts,
            notTestedAttempts,
            remainingAttempts: Math.max(
                0,
                totalAttempts -
                    completedAttempts -
                    failedAttempts -
                    notTestedAttempts
            ),
        };
    };
    const emitAttemptStarted = (inputEvent: {
        attemptIndex: number;
        conditionId: string;
        caseId: string;
        repeat: number;
        candidateLabel?: string;
        authoritativeLabel: string;
    }): void => {
        emitProgress({
            kind: 'attempt_started',
            totalAttempts,
            repeatCount: input.config.repeats,
            ...inputEvent,
        });
    };
    const emitAttemptFinished = (inputEvent: {
        attemptIndex: number;
        conditionId: string;
        caseId: string;
        repeat: number;
        status: ResponseComparisonAttempt['status'];
        durationMs: number;
        costUsd?: number;
        reason?: string;
    }): void => {
        const counts = finishedCounts();
        emitProgress({
            kind: 'attempt_finished',
            totalAttempts,
            repeatCount: input.config.repeats,
            ...inputEvent,
            ...counts,
        });
    };
    const emitStage = (inputEvent: {
        attemptIndex: number;
        conditionId: string;
        caseId: string;
        repeat: number;
        progress: ResponseComparisonStageProgress;
    }): void => {
        const { progress, ...base } = inputEvent;
        if (progress.status === 'running') {
            emitProgress({
                kind: 'stage_started',
                totalAttempts,
                repeatCount: input.config.repeats,
                ...base,
                stage: progress.stage,
            });
            return;
        }
        emitProgress({
            kind: 'stage_finished',
            totalAttempts,
            repeatCount: input.config.repeats,
            ...base,
            stage: progress.stage,
            status: progress.status,
            durationMs: progress.durationMs ?? 0,
            ...(progress.reason !== undefined && {
                reason: progress.reason,
            }),
            ...(progress.decision !== undefined && {
                decision: progress.decision,
            }),
        });
    };
    if (input.config.conditions !== undefined) {
        const authority = input.config.authority;
        if (authority === undefined)
            throw new Error('Comparison config does not define an authority.');
        for (const [
            conditionIndex,
            condition,
        ] of input.config.conditions.entries())
            for (const [itemIndex, item] of input.config.cases.entries())
                for (
                    let repeat = 1;
                    repeat <= input.config.repeats;
                    repeat += 1
                ) {
                    const id = hash({
                        configHash: input.configHash,
                        condition,
                        caseId: item.id,
                        repeat,
                    }).slice(0, 24);
                    if (known.has(id)) continue;
                    const persona = (
                        input.dependencies.resolvePersona ?? defaultPersona
                    )(item);
                    const authoritativeModel =
                        responseComparisonAuthoritativeModel(input.config);
                    const configuredAuthoritativeProfile = resolveModel(
                        authoritativeModel,
                        input.dependencies.profiles
                    );
                    const authoritativeProfile =
                        configuredAuthoritativeProfile === null
                            ? undefined
                            : await (input.dependencies.prepareProfile?.(
                                  configuredAuthoritativeProfile
                              ) ?? configuredAuthoritativeProfile);
                    const candidateProfile =
                        condition.candidateModel === undefined
                            ? undefined
                            : resolveModel(
                                  condition.candidateModel,
                                  input.dependencies.profiles
                              );
                    const reviewRequirements = reviewRequirementsFor(
                        item,
                        input.config.review,
                        true
                    );
                    const attemptIndex =
                        (conditionIndex * input.config.cases.length +
                            itemIndex) *
                            input.config.repeats +
                        repeat;
                    emitAttemptStarted({
                        attemptIndex,
                        conditionId: condition.id,
                        caseId: item.id,
                        repeat,
                        ...(candidateProfile !== null &&
                            candidateProfile !== undefined &&
                            condition.candidateModel !== undefined && {
                                candidateLabel: progressModelLabel(
                                    condition.candidateModel,
                                    candidateProfile
                                ),
                            }),
                        authoritativeLabel: authoritativeProfile
                            ? progressModelLabel(
                                  authoritativeModel,
                                  authoritativeProfile
                              )
                            : 'profile' in authoritativeModel
                              ? authoritativeModel.profile
                              : `${authoritativeModel.name}/${authoritativeModel.model}`,
                    });
                    const attempt =
                        authoritativeProfile === undefined
                            ? {
                                  attemptId: id,
                                  comparisonId: id,
                                  model:
                                      condition.candidateModel ??
                                      authoritativeModel,
                                  setting: 'default' as const,
                                  caseId: item.id,
                                  repeat,
                                  status: 'not_tested' as const,
                                  reason: 'authoritative_profile_not_found',
                                  candidateAvailability:
                                      candidateProfile === undefined
                                          ? ('not_attempted' as const)
                                          : ('unavailable' as const),
                                  condition,
                                  authoritativeModel,
                                  source: {
                                      messages: item.messages,
                                      persona: item.persona,
                                      resolvedGuidance:
                                          persona.presentationGuidance,
                                      expressionGuidance:
                                          persona.expressionGuidance,
                                      expressionStrength:
                                          persona.expressionStrength,
                                      guidanceHash: hash({
                                          presentation:
                                              persona.presentationGuidance,
                                          expression:
                                              persona.expressionGuidance,
                                      }),
                                      requirements: item.requirements,
                                      reviewRequirements,
                                  },
                              }
                            : candidateProfile === null
                              ? {
                                    attemptId: id,
                                    comparisonId: id,
                                    model:
                                        condition.candidateModel ??
                                        authoritativeModel,
                                    setting: 'default' as const,
                                    caseId: item.id,
                                    repeat,
                                    status: 'not_tested' as const,
                                    reason: 'candidate_profile_not_found',
                                    candidateAvailability:
                                        'unavailable' as const,
                                    condition,
                                    authoritativeModel,
                                    source: {
                                        messages: item.messages,
                                        persona: item.persona,
                                        resolvedGuidance:
                                            persona.presentationGuidance,
                                        expressionGuidance:
                                            persona.expressionGuidance,
                                        expressionStrength:
                                            persona.expressionStrength,
                                        guidanceHash: hash({
                                            presentation:
                                                persona.presentationGuidance,
                                            expression:
                                                persona.expressionGuidance,
                                        }),
                                        requirements: item.requirements,
                                        reviewRequirements,
                                    },
                                }
                              : await toWorkflowAttempt({
                                    configHash: input.configHash,
                                    condition,
                                    item,
                                    repeat,
                                    candidateProfile,
                                    authoritativeProfile,
                                    authority,
                                    persona,
                                    support:
                                        input.dependencies.checkProviderSupport,
                                    reviewRequirements,
                                    automaticReview:
                                        input.dependencies.automaticReviewer,
                                    reportStage: (progress) =>
                                        emitStage({
                                            attemptIndex,
                                            conditionId: condition.id,
                                            caseId: item.id,
                                            repeat,
                                            progress,
                                        }),
                                    runWorkflow: input.dependencies.runWorkflow,
                                });
                    appendCheckpoint(checkpoint, attempt);
                    attempts.push(attempt);
                    emitAttemptFinished({
                        attemptIndex,
                        conditionId: condition.id,
                        caseId: item.id,
                        repeat,
                        status: attempt.status,
                        durationMs: attempt.operations?.latencyMs ?? 0,
                        costUsd: attempt.operations?.costUsd,
                        reason: attempt.reason,
                    });
                }
    } else {
        const settings = input.config.settings ?? [];
        for (const [modelIndex, model] of (
            input.config.models ?? []
        ).entries()) {
            const profile = resolveModel(model, input.dependencies.profiles);
            for (const [settingIndex, setting] of settings.entries())
                for (const [itemIndex, item] of input.config.cases.entries())
                    for (
                        let repeat = 1;
                        repeat <= input.config.repeats;
                        repeat += 1
                    ) {
                        const id = attemptIdFor(
                            input.configHash,
                            model,
                            setting,
                            item.id,
                            repeat
                        );
                        if (known.has(id)) continue;
                        const persona = (
                            input.dependencies.resolvePersona ?? defaultPersona
                        )(item);
                        const attemptIndex =
                            ((modelIndex * settings.length + settingIndex) *
                                input.config.cases.length +
                                itemIndex) *
                                input.config.repeats +
                            repeat;
                        emitAttemptStarted({
                            attemptIndex,
                            conditionId:
                                'profile' in model ? model.profile : model.name,
                            caseId: item.id,
                            repeat,
                            ...(profile !== null && {
                                candidateLabel: progressModelLabel(
                                    model,
                                    profile
                                ),
                            }),
                            authoritativeLabel: 'authoritative generation',
                        });
                        const preparedProfile =
                            profile === null
                                ? null
                                : await (input.dependencies.prepareProfile?.(
                                      profile
                                  ) ?? profile);
                        const attempt =
                            preparedProfile === null
                                ? {
                                      attemptId: id,
                                      comparisonId: id,
                                      model,
                                      setting,
                                      caseId: item.id,
                                      repeat,
                                      status: 'not_tested' as const,
                                      reason: 'profile_not_found',
                                      source: {
                                          messages: item.messages,
                                          persona: item.persona,
                                          resolvedGuidance:
                                              persona.presentationGuidance,
                                          expressionGuidance:
                                              persona.expressionGuidance,
                                          expressionStrength:
                                              persona.expressionStrength,
                                          guidanceHash: hash({
                                              presentation:
                                                  persona.presentationGuidance,
                                              expression:
                                                  persona.expressionGuidance,
                                          }),
                                          requirements: item.requirements,
                                          reviewRequirements:
                                              item.requirements.filter(
                                                  (requirement) =>
                                                      input.config.review.mustKeep.includes(
                                                          requirement.kind
                                                      )
                                              ),
                                      },
                                      support: {
                                          checkedAt: new Date().toISOString(),
                                          source: 'catalog_profile' as const,
                                          modelId:
                                              'profile' in model
                                                  ? model.profile
                                                  : model.model,
                                          status: 'unknown' as const,
                                          reasonCode: 'profile_not_found',
                                      },
                                  }
                                : await toAttempt({
                                      configHash: input.configHash,
                                      model,
                                      setting,
                                      item,
                                      repeat,
                                      profile: preparedProfile,
                                      persona,
                                      runtime:
                                          input.dependencies.generationRuntime,
                                      runCandidate:
                                          input.dependencies.runCandidate,
                                      support:
                                          input.dependencies
                                              .checkProviderSupport,
                                      reviewRequirements:
                                          item.requirements.filter(
                                              (requirement) =>
                                                  input.config.review.mustKeep.includes(
                                                      requirement.kind
                                                  )
                                          ),
                                      automaticReview:
                                          input.dependencies.automaticReviewer,
                                  });
                        appendCheckpoint(checkpoint, attempt);
                        attempts.push(attempt);
                        emitAttemptFinished({
                            attemptIndex,
                            conditionId:
                                'profile' in model ? model.profile : model.name,
                            caseId: item.id,
                            repeat,
                            status: attempt.status,
                            durationMs: attempt.operations?.latencyMs ?? 0,
                            costUsd: attempt.operations?.costUsd,
                            reason: attempt.reason,
                        });
                    }
        }
    }
    attempts.sort((left, right) =>
        left.attemptId.localeCompare(right.attemptId)
    );
    const activePointer = activeRunPath(input.checkpointRoot, input.configHash);
    if (
        fs.existsSync(activePointer) &&
        fs.readFileSync(activePointer, 'utf8').trim() === runId
    )
        fs.rmSync(activePointer, { force: true });
    return {
        schemaVersion: 1,
        reportId: runId,
        createdAt: startedAt,
        completedAt: new Date().toISOString(),
        command: input.command,
        ...(input.dependencies.gitSha !== undefined && {
            gitSha: input.dependencies.gitSha,
        }),
        configPath: input.configPath,
        configHash: input.configHash,
        dependencies: input.dependencies.dependencies ?? {},
        config: input.config,
        attempts,
        humanReviews: [],
        blindnessEvents: [],
    };
};

export const writeResponseComparisonReport = (
    root: string,
    report: ResponseComparisonReport
): string => {
    const reportPath = path.join(
        root,
        `response-comparison-${report.reportId}.html`
    );
    fs.writeFileSync(reportPath, buildReportHtml(report), 'utf8');
    return reportPath;
};
