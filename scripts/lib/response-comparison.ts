/**
 * @description: Loads, validates, executes, and renders provider-neutral response comparisons.
 * The comparison is evidence collection; it never selects a winner or changes runtime defaults.
 * @footnote-scope: test
 * @footnote-module: ResponseComparison
 * @footnote-risk: high - Live comparisons spend provider budget and persist model outputs for review.
 * @footnote-ethics: high - Blind review must preserve authority, uncertainty, provenance, and reviewer consent.
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
    PresentationResult,
} from '../../packages/backend/src/services/presentation.js';

export type ResponseComparisonConfig = {
    version: 1;
    name: string;
    models: ResponseComparisonModel[];
    settings: ResponseComparisonSetting[];
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
        kind: 'facts' | 'uncertainty' | 'sources' | 'authority' | 'safety';
        statement: string;
    }>;
};

export type ResponseComparisonReviewConfig = {
    mustKeep: Array<
        'facts' | 'uncertainty' | 'sources' | 'authority' | 'safety'
    >;
    rate: Array<'naturalness' | 'persona' | 'clarity' | 'usefulness'>;
    automaticReviewer?: { profile: string };
    blind: boolean;
};

export type ResponseComparisonStatus = 'completed' | 'not_tested' | 'failed';

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
};

export type ResponseComparisonAutomaticReview = {
    reviewer: { profile: string; provider?: string; model?: string };
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
        throw new Error(`${label} is unsupported.`);
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
                    ['current', 'compact'],
                    `settings[${index}].prompt`
                ),
            }),
        };
    });
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
        ['version', 'name', 'models', 'settings', 'repeats', 'cases', 'review'],
        'config'
    );
    if (value.version !== 1) throw new Error('config.version must be 1.');
    if (!Array.isArray(value.models) || value.models.length === 0)
        throw new Error('models must be a non-empty list.');
    const models = value.models.map((item, index): ResponseComparisonModel => {
        if (!isRecord(item))
            throw new Error(`models[${index}] must be an object.`);
        if (item.profile !== undefined) {
            exactKeys(item, ['profile'], `models[${index}]`);
            return { profile: text(item.profile, `models[${index}].profile`) };
        }
        exactKeys(item, ['name', 'provider', 'model'], `models[${index}]`);
        return {
            name: text(item.name, `models[${index}].name`),
            provider: enumValue(
                item.provider,
                ['openai', 'ollama', 'openrouter'],
                `models[${index}].provider`
            ),
            model: text(item.model, `models[${index}].model`),
        };
    });
    assertUnique(
        models.map((model) =>
            'profile' in model
                ? `profile:${model.profile}`
                : `name:${model.name}`
        ),
        'model names and profile references'
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
            ['facts', 'uncertainty', 'sources', 'authority', 'safety'] as const,
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
    let automaticReviewer: { profile: string } | undefined;
    if (value.review.automaticReviewer !== undefined) {
        if (!isRecord(value.review.automaticReviewer))
            throw new Error('review.automaticReviewer must be an object.');
        exactKeys(
            value.review.automaticReviewer,
            ['profile'],
            'review.automaticReviewer'
        );
        automaticReviewer = {
            profile: text(
                value.review.automaticReviewer.profile,
                'review.automaticReviewer.profile'
            ),
        };
    }
    const settings = parseSettings(value.settings);
    assertUnique(
        settings.map((setting) => hash(setting)),
        'settings variants'
    );
    return {
        version: 1,
        name: text(value.name, 'name'),
        models,
        settings,
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
                      'packages/backend/test/fixtures/responseComparisonCore.yaml'
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
    description: `Ephemeral comparison candidate ${model.name}.`,
    provider: model.provider,
    providerModel: model.model,
    enabled: true,
    tierBindings: [],
    capabilities: { canUseSearch: false },
});

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
    const script = String.raw`(function(){
'use strict';
const report=JSON.parse(document.getElementById('canonical-report').textContent);
const app=document.getElementById('app');
const storageKey='response-comparison:'+report.reportId;
const add=(tag,content,cls)=>{const node=document.createElement(tag);if(cls)node.className=cls;node.textContent=content;return node};
const save=()=>{try{localStorage.setItem(storageKey,JSON.stringify({humanReviews:report.humanReviews,reviewerName:report.reviewerName,blindnessEvents:report.blindnessEvents}))}catch{}}
try{const saved=JSON.parse(localStorage.getItem(storageKey)||'null');if(saved){report.humanReviews=Array.isArray(saved.humanReviews)?saved.humanReviews:report.humanReviews;report.reviewerName=typeof saved.reviewerName==='string'?saved.reviewerName:report.reviewerName;report.blindnessEvents=Array.isArray(saved.blindnessEvents)?saved.blindnessEvents:report.blindnessEvents}}catch{}
let blind=Boolean(report.config.review.blind)&&!report.blindnessEvents.some((event)=>event.action==='revealed');
const median=(values)=>{const sorted=values.filter((value)=>typeof value==='number').sort((a,b)=>a-b);if(!sorted.length)return null;const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2};
const modelLabel=(attempt)=>attempt.model.profile||attempt.model.name||'candidate';
const settingLabel=(setting)=>setting==='default'?'Provider defaults':JSON.stringify(setting);
const scrollToAttempt=(attemptId)=>document.getElementById('attempt-'+attemptId)?.scrollIntoView({behavior:'smooth',block:'start'});
const formatMoney=(value)=>value===null?'—':'$'+value.toFixed(6);
const renderSummary=()=>{
 const summary=add('article');summary.append(add('h2','Summary'));
 summary.append(add('p','Completed: '+report.attempts.filter((a)=>a.status==='completed').length+' | Not tested: '+report.attempts.filter((a)=>a.status==='not_tested').length+' | Failed: '+report.attempts.filter((a)=>a.status==='failed').length));
 summary.append(add('p','Requirements checked: '+report.config.review.mustKeep.join(', ')+' (automatic and human reviews stay separate; no combined winner score)','muted'));
 if(!blind){
   summary.append(add('h3','Results'));
  const groups=new Map();for(const attempt of report.attempts){const key=JSON.stringify([attempt.model,attempt.setting]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(attempt)}
   const table=document.createElement('table');table.className='comparison';const head=document.createElement('tr');for(const label of ['Model / setting','Ran','Auto reviewed','Requirements passed','Auto scores','Human scores','Typical time','Generation cost','Review cost','Total cost','Output rate'])head.append(add('th',label));table.append(head);
  for(const group of groups.values()){
   const row=document.createElement('tr');const first=group[0];const completed=group.filter((a)=>a.status==='completed');const reviews=completed.map((a)=>a.automaticReview).filter((a)=>a?.status==='completed');const failedReviews=completed.filter((a)=>a.automaticReview?.status!=='completed');const mustKeep=reviews.flatMap((review)=>review.mustKeep);const rates=new Map();for(const review of reviews)for(const rating of review.ratings){const values=rates.get(rating.dimension)||[];values.push(rating.score);rates.set(rating.dimension,values)}
   const human=report.humanReviews.filter((entry)=>completed.some((attempt)=>attempt.attemptId===entry.attemptId)&&typeof entry.score==='number');const humanAttemptIds=new Set(human.map((entry)=>entry.attemptId));const humanRates=new Map();for(const entry of human){const values=humanRates.get(entry.dimension)||[];values.push(entry.score);humanRates.set(entry.dimension,values)}
   const label=document.createElement('button');label.textContent=modelLabel(first)+' | '+settingLabel(first.setting);label.onclick=()=>scrollToAttempt(first.attemptId);const labelCell=document.createElement('td');labelCell.append(label);row.append(labelCell);
   row.append(add('td',completed.length+'/'+group.length));row.append(add('td',reviews.length+'/'+completed.length+(failedReviews.length?' ('+failedReviews.length+' reviewer failures)':'')));row.append(add('td',mustKeep.length?mustKeep.filter((item)=>item.result==='pass').length+'/'+mustKeep.length:'—'));
   row.append(add('td',report.config.review.rate.map((dimension)=>{const values=rates.get(dimension)||[];return dimension+': '+(values.length?median(values)?.toFixed(1):'—')}).join(' | ')));
   row.append(add('td',humanAttemptIds.size+'/'+completed.length+' attempts; '+report.config.review.rate.map((dimension)=>{const values=humanRates.get(dimension)||[];return dimension+': '+(values.length?median(values)?.toFixed(1):'—')}).join(' | ')));
   const latencies=completed.map((a)=>a.operations?.latencyMs).filter((v)=>typeof v==='number');const generationCosts=completed.map((a)=>a.operations?.costUsd).filter((v)=>typeof v==='number');const reviewCosts=reviews.map((review)=>review.timing?.costUsd).filter((v)=>typeof v==='number');const totalCosts=completed.map((attempt)=>{const review=attempt.automaticReview?.status==='completed'?attempt.automaticReview.timing?.costUsd:undefined;const generation=attempt.operations?.costUsd;return typeof generation==='number'||typeof review==='number'?(generation||0)+(review||0):null}).filter((v)=>typeof v==='number');const ratesPerAttempt=completed.map((a)=>typeof a.operations?.completionTokens==='number'&&typeof a.operations?.latencyMs==='number'&&a.operations.latencyMs>0?a.operations.completionTokens/(a.operations.latencyMs/1000):null).filter((v)=>typeof v==='number');
   row.append(add('td',latencies.length?Math.round(median(latencies))+' ms':'—'));row.append(add('td',generationCosts.length?formatMoney(median(generationCosts)):'—'));row.append(add('td',reviewCosts.length?formatMoney(median(reviewCosts)):'—'));row.append(add('td',totalCosts.length?formatMoney(median(totalCosts)):'—'));row.append(add('td',ratesPerAttempt.length?median(ratesPerAttempt).toFixed(2):'—'));table.append(row);
  }
   summary.append(table);summary.append(add('p','Automatic and human reviews are shown separately. Output rate is completion tokens per second. Select a model to see its responses.','muted'));
  const findings=report.attempts.flatMap((attempt)=>attempt.automaticReview?.status==='completed'?attempt.automaticReview.mustKeep.filter((item)=>item.result!=='pass').map((item)=>attempt.caseId+' / '+item.requirementId+': '+item.result+' - '+item.explanation):attempt.automaticReview?.status==='failed'?[attempt.caseId+': automatic review failed - '+(attempt.automaticReview.failure||'unknown failure')]:[]);
   summary.append(add('h3','Requirement problems'));summary.append(add('p',findings.length?findings.join(' | '):'No requirement problems or review failures.','muted'));
 }
 return summary;
};
const render=()=>{
 app.replaceChildren();app.append(add('h1','Response comparison: '+report.config.name));app.append(add('p','Run '+report.reportId+' | '+report.attempts.length+' planned attempts','muted'));app.append(renderSummary());
 const controls=add('div');const reveal=add('button',blind?'Reveal metadata':'Metadata revealed');reveal.disabled=!blind;reveal.onclick=()=>{blind=false;report.blindnessEvents.push({at:new Date().toISOString(),action:'revealed'});save();render()};controls.append(reveal);
  const download=add('button','Download reviewed HTML');download.onclick=()=>{const reviewed=JSON.parse(JSON.stringify(report));reviewed.parentReportId=report.parentReportId||report.reportId;reviewed.reportId=reviewed.parentReportId+'-reviewed-'+Date.now();reviewed.blindnessEvents.push({at:new Date().toISOString(),action:'exported'});const body=JSON.stringify(reviewed).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026');const source=document.documentElement.outerHTML;const html=source.replace(document.getElementById('canonical-report').textContent,()=>body);const blob=new Blob([html],{type:'text/html'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='response-comparison-'+reviewed.reportId+'.html';link.click();URL.revokeObjectURL(url)};controls.append(download);
 const identity=add('label','Reviewer name: ');const name=document.createElement('input');name.value=report.reviewerName||'';name.placeholder='Optional';name.oninput=()=>{report.reviewerName=name.value;save()};identity.append(name);controls.append(identity)
 app.append(controls);if(blind)app.append(add('p','Blind view: model, provider, settings, cost, timing, automatic review, and saved human reviews are hidden. The source remains visible.','blind-warning'));app.append(add('h2',blind?'Blind review queue':'Run details'));
  for(const attempt of report.attempts){const card=add('article');card.id='attempt-'+attempt.attemptId;card.append(add('h2',attempt.caseId+' / repeat '+attempt.repeat));const reviewRequirements=attempt.source?.reviewRequirements||attempt.source?.requirements||[];if(attempt.source){const context=add('div');context.append(add('h3','Source'));for(const message of attempt.source.messages)context.append(add('p',message.role+': '+message.content));context.append(add('p','Persona: '+attempt.source.persona+' | strength: '+attempt.source.expressionStrength));context.append(add('p','Style guidance: '+attempt.source.resolvedGuidance));context.append(add('p','Expression guidance: '+(attempt.source.expressionGuidance||attempt.source.resolvedGuidance)));context.append(add('p','Checks: '+attempt.source.requirements.map((r)=>r.id+': '+r.statement).join(' | '),'muted'));card.append(context)}card.append(add('p','Status: '+attempt.status+(attempt.reason?' - '+attempt.reason:''),'muted'));if(attempt.output)card.append(add('pre',attempt.output.text));
  if(!blind){card.append(add('p','Model: '+JSON.stringify(attempt.model)));card.append(add('p','Setting: '+JSON.stringify(attempt.setting)));card.append(add('p','Model support: '+JSON.stringify(attempt.support||{})));card.append(add('p','Timing and cost: '+JSON.stringify(attempt.operations||{})));card.append(add('p','Provider details: '+JSON.stringify(attempt.attribution||{})));if(attempt.automaticReview)card.append(add('pre','Automatic review details:\n'+JSON.stringify(attempt.automaticReview,null,2)))}
  if(attempt.status==='completed'){
   const review=add('div');review.append(add('h3','Human review'));for(const dimension of report.config.review.rate){const label=add('label',dimension+': ');const select=document.createElement('select');const unrated=add('option','Not rated');unrated.value='';select.append(unrated);for(let score=1;score<=5;score++)select.append(add('option',String(score)));const saved=!blind?report.humanReviews.find((entry)=>entry.attemptId===attempt.attemptId&&entry.dimension===dimension):undefined;if(typeof saved?.score==='number')select.value=String(saved.score);select.onchange=()=>{report.humanReviews=report.humanReviews.filter((entry)=>!(entry.attemptId===attempt.attemptId&&entry.dimension===dimension));if(select.value)report.humanReviews.push({attemptId:attempt.attemptId,dimension,score:Number(select.value),reviewerName:report.reviewerName||undefined,at:new Date().toISOString()});save()};label.append(select);review.append(label)}
   for(const requirement of reviewRequirements){const line=add('div','');line.append(add('label',requirement.id+': '));const result=document.createElement('select');for(const value of ['Not judged','pass','fail','uncertain'])result.append(add('option',value));const saved=!blind?report.humanReviews.find((entry)=>entry.attemptId===attempt.attemptId&&entry.requirementId===requirement.id):undefined;if(typeof saved?.result==='string')result.value=saved.result;const evidence=document.createElement('textarea');evidence.placeholder='Evidence or note';evidence.value=typeof saved?.evidence==='string'?saved.evidence:'';const update=()=>{report.humanReviews=report.humanReviews.filter((entry)=>!(entry.attemptId===attempt.attemptId&&entry.requirementId===requirement.id));if(result.value!=='Not judged'||evidence.value){report.humanReviews.push({attemptId:attempt.attemptId,requirementId:requirement.id,result:result.value,evidence:evidence.value,reviewerName:report.reviewerName||undefined,at:new Date().toISOString()})}save()};result.onchange=update;evidence.oninput=update;line.append(result,evidence);review.append(line)}card.append(review)
  }
  app.append(card)
 }
};render();
})();`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Response comparison ${report.reportId}</title><style>body{font:15px system-ui,sans-serif;max-width:1180px;margin:2rem auto;padding:0 1rem;background:#f6f5f1;color:#24231f}article{background:white;border:1px solid #d8d5cc;border-radius:8px;padding:1rem;margin:1rem 0}pre{white-space:pre-wrap;background:#f0eee8;padding:1rem;border-radius:6px}button,input,select,textarea{padding:.5rem .75rem;margin:.25rem}textarea{min-width:20rem;min-height:2rem}.muted{color:#68655e}.blind-warning{background:#fff2c2;padding:.75rem;border-radius:6px}.comparison{border-collapse:collapse;width:100%;margin:.5rem 0}.comparison th,.comparison td{border:1px solid #d8d5cc;padding:.5rem;text-align:left;vertical-align:top}.comparison th{background:#f0eee8}</style></head><body><main id="app"></main><script id="canonical-report" type="application/json">${embedded}</script><script>${script}</script></body></html>`;
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
    for (const model of input.config.models) {
        const profile = resolveModel(model, input.dependencies.profiles);
        for (const setting of input.config.settings)
            for (const item of input.config.cases)
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
                                  runtime: input.dependencies.generationRuntime,
                                  runCandidate: input.dependencies.runCandidate,
                                  support:
                                      input.dependencies.checkProviderSupport,
                                  reviewRequirements: item.requirements.filter(
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
