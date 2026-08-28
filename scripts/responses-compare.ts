/**
 * @description: Runs the YAML-defined response comparison and writes one self-contained HTML report.
 * Check mode validates credentials and provider support without generating responses.
 * @footnote-scope: test
 * @footnote-module: ResponseComparisonCli
 * @footnote-risk: high - The command can issue repeated paid provider requests and persist generated prose.
 * @footnote-ethics: high - Explicit configuration and blind review keep model evidence separate from human judgment.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
    GenerationRuntime,
    GenerationStructuredOutput,
} from '../packages/agent-runtime/src/index.js';
import type {
    ModelProfile,
    PresentationGenerationSettings,
} from '../packages/contracts/src/index.js';
import { supportedProviders } from '../packages/contracts/src/providers.js';
import {
    loadResponseComparisonConfig,
    runResponseComparison,
    resolveModel,
    settingToRequest,
    writeResponseComparisonReport,
    type ComparisonDependencies,
    type ResponseComparisonAttempt,
    type ResponseComparisonAutomaticReview,
    type ResponseComparisonModel,
    type ResponseComparisonSupportEvidence,
} from './lib/response-comparison.js';
import { estimateOpenAITextCost } from '../packages/contracts/src/pricing.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPENROUTER_MODELS_TIMEOUT_MS = 10_000;

const usage = (): string =>
    [
        'Usage: pnpm responses:compare [--config <path>] [--check]',
        '',
        'The default command runs all supported comparisons and writes a self-contained HTML report.',
        'Resume is automatic from .footnote/response-comparison/<run-id>/checkpoint.jsonl.',
    ].join('\n');

const requiredValue = (args: string[], index: number, flag: string): string => {
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--'))
        throw new Error(`${flag} requires a value.`);
    return value;
};

const parseArgs = (args: string[]): { configPath: string; check: boolean } => {
    let configPath = path.join(root, 'response-comparison.yaml');
    let check = false;
    for (let index = 0; index < args.length; index += 1) {
        switch (args[index]) {
            case '--config':
                configPath = path.resolve(
                    root,
                    requiredValue(args, index, '--config')
                );
                index += 1;
                break;
            case '--check':
                check = true;
                break;
            case '--help':
            case '-h':
                console.log(usage());
                process.exit(0);
                break;
            default:
                throw new Error(`Unknown option: ${args[index]}`);
        }
    }
    return { configPath, check };
};

const gitSha = (): string | undefined => {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: root,
            encoding: 'utf8',
        }).trim();
    } catch {
        return undefined;
    }
};

type OpenRouterDiscoveredModel = { supportedParameters?: string[] };
type OpenRouterDiscovery = Map<string, OpenRouterDiscoveredModel>;

export const applyOpenRouterCapabilities = (
    profile: ModelProfile,
    discovered: OpenRouterDiscoveredModel | undefined
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
    return {
        ...profile,
        capabilities: {
            ...profile.capabilities,
            ...(supportedSamplingControls.length > 0 && {
                supportedSamplingControls: [...supportedSamplingControls],
            }),
        },
    };
};

const buildSupportChecker = () => {
    const discovery = new Map<string, OpenRouterDiscovery | null>();
    const loadOpenRouter = async (): Promise<OpenRouterDiscovery | null> => {
        if (discovery.has('openrouter'))
            return discovery.get('openrouter') ?? null;
        try {
            const response = await fetch(
                'https://openrouter.ai/api/v1/models',
                {
                    headers: process.env.OPENROUTER_API_KEY?.trim()
                        ? {
                              Authorization: `Bearer ${process.env.OPENROUTER_API_KEY.trim()}`,
                          }
                        : {},
                    signal: AbortSignal.timeout(OPENROUTER_MODELS_TIMEOUT_MS),
                }
            );
            if (!response.ok) {
                discovery.set('openrouter', null);
                return null;
            }
            const payload: unknown = await response.json();
            const models = new Map<string, OpenRouterDiscoveredModel>();
            if (isRecord(payload) && Array.isArray(payload.data))
                for (const entry of payload.data) {
                    if (!isRecord(entry) || typeof entry.id !== 'string')
                        continue;
                    const supportedParameters = Array.isArray(
                        entry.supported_parameters
                    )
                        ? entry.supported_parameters.filter(
                              (value): value is string =>
                                  typeof value === 'string'
                          )
                        : undefined;
                    models.set(entry.id, { supportedParameters });
                }
            discovery.set('openrouter', models);
            return models;
        } catch {
            discovery.set('openrouter', null);
            return null;
        }
    };
    const check = async (
        profile: ModelProfile,
        settings: PresentationGenerationSettings
    ): Promise<ResponseComparisonSupportEvidence> => {
        const base: Omit<ResponseComparisonSupportEvidence, 'status'> = {
            checkedAt: new Date().toISOString(),
            source:
                profile.provider === 'openrouter'
                    ? ('openrouter_models_endpoint' as const)
                    : ('catalog_profile' as const),
            modelId: profile.providerModel,
        };
        if (
            profile.provider === 'openai' &&
            !process.env.OPENAI_API_KEY?.trim()
        )
            return {
                ...base,
                status: 'unknown',
                reasonCode: 'credentials_missing',
            };
        if (
            profile.provider === 'openrouter' &&
            !process.env.OPENROUTER_API_KEY?.trim()
        )
            return {
                ...base,
                status: 'unknown',
                reasonCode: 'credentials_missing',
            };
        if (
            profile.provider === 'ollama' &&
            !process.env.OLLAMA_BASE_URL?.trim() &&
            process.env.OLLAMA_LOCAL_INFERENCE_ENABLED !== 'true'
        )
            return {
                ...base,
                status: 'unknown',
                reasonCode: 'credentials_or_endpoint_missing',
            };
        if (profile.provider === 'openrouter') {
            const models = await loadOpenRouter();
            if (models === null)
                return {
                    ...base,
                    status: 'failed',
                    reasonCode: 'provider_support_check_failed',
                };
            const discovered = models.get(profile.providerModel);
            if (discovered === undefined)
                return {
                    ...base,
                    status: 'unsupported',
                    modelFound: false,
                    reasonCode: 'provider_model_not_discovered',
                };
            base.observedParameters = discovered.supportedParameters;
        }
        const supportsSamplingControl = (
            control: 'temperature' | 'topP',
            providerParameter: 'temperature' | 'top_p'
        ): boolean =>
            base.source === 'openrouter_models_endpoint' &&
            base.observedParameters !== undefined
                ? base.observedParameters.includes(providerParameter)
                : Boolean(
                      profile.capabilities.supportedSamplingControls?.includes(
                          control
                      )
                  );
        if (
            settings.temperature !== undefined &&
            !supportsSamplingControl('temperature', 'temperature')
        )
            return {
                ...base,
                status: 'unsupported',
                reasonCode: 'temperature_not_supported_or_unknown',
            };
        if (
            settings.topP !== undefined &&
            !supportsSamplingControl('topP', 'top_p')
        )
            return {
                ...base,
                status: 'unsupported',
                reasonCode: 'topP_not_supported_or_unknown',
            };
        if (
            settings.reasoningEffort !== undefined &&
            !profile.capabilities.supportedReasoningEfforts?.includes(
                settings.reasoningEffort
            )
        )
            return {
                ...base,
                status: 'unsupported',
                reasonCode: 'reasoningEffort_not_supported_or_unknown',
            };
        if (
            settings.verbosity !== undefined &&
            !profile.capabilities.supportedVerbosity?.includes(
                settings.verbosity
            )
        )
            return {
                ...base,
                status: 'unsupported',
                reasonCode: 'verbosity_not_supported_or_unknown',
            };
        if (
            settings.maxOutputTokens !== undefined &&
            profile.maxOutputTokens !== undefined &&
            settings.maxOutputTokens > profile.maxOutputTokens
        )
            return {
                ...base,
                status: 'unsupported',
                reasonCode: 'maxOutputTokens_exceeds_profile_maximum',
            };
        if (
            settings.maxOutputTokens !== undefined &&
            base.source === 'openrouter_models_endpoint' &&
            base.observedParameters !== undefined &&
            !base.observedParameters.includes('max_tokens')
        )
            return {
                ...base,
                status: 'unsupported',
                reasonCode: 'maxOutputTokens_not_supported_or_unknown',
            };
        if (settings.temperature !== undefined && settings.topP !== undefined)
            return {
                ...base,
                status: 'unsupported',
                reasonCode: 'sampling_controls_mutually_exclusive',
            };
        return {
            ...base,
            status: 'supported',
            modelFound: profile.provider === 'openrouter' ? true : undefined,
        };
    };
    const prepareProfile = async (
        profile: ModelProfile
    ): Promise<ModelProfile> =>
        profile.provider === 'openrouter'
            ? applyOpenRouterCapabilities(
                  profile,
                  (await loadOpenRouter())?.get(profile.providerModel)
              )
            : profile;
    return { check, prepareProfile };
};

const describeSupport = (
    evidence: ResponseComparisonSupportEvidence
): string => {
    if (evidence.status === 'supported') return 'supported';
    const reason = evidence.reasonCode ?? `provider_support_${evidence.status}`;
    const messages: Record<string, string> = {
        credentials_missing: 'credentials are not configured',
        credentials_or_endpoint_missing: 'provider endpoint is not configured',
        provider_model_not_discovered:
            'provider does not advertise this model ID',
        provider_support_check_failed: 'provider support check failed',
        temperature_not_supported_or_unknown:
            'this model does not advertise temperature control',
        topP_not_supported_or_unknown:
            'this model does not advertise top_p control',
        reasoningEffort_not_supported_or_unknown:
            'this model does not advertise the requested reasoning effort',
        verbosity_not_supported_or_unknown:
            'this model does not advertise the requested verbosity',
        maxOutputTokens_exceeds_profile_maximum:
            'the requested output limit exceeds the profile maximum',
        sampling_controls_mutually_exclusive:
            'temperature and top_p are mutually exclusive in Footnote',
    };
    return `${messages[reason] ?? reason} (${evidence.status}; ${reason})`;
};

const modelLabel = (
    model: ResponseComparisonModel,
    profile: ModelProfile
): string =>
    'profile' in model
        ? `${profile.description} (${model.profile})`
        : `${model.name} (${model.provider}/${model.model})`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const packageManagerVersion = (): string => {
    try {
        const packageJson: unknown = JSON.parse(
            fs.readFileSync(path.join(root, 'package.json'), 'utf8')
        );
        if (
            isRecord(packageJson) &&
            typeof packageJson.packageManager === 'string'
        )
            return packageJson.packageManager.split('+', 1)[0];
    } catch {
        // Fall back to the package-manager-provided user agent below.
    }
    const userAgent = process.env.npm_config_user_agent?.trim().split(' ')[0];
    if (userAgent !== undefined) {
        const separator = userAgent.indexOf('/');
        if (separator > 0 && separator < userAgent.length - 1)
            return `${userAgent.slice(0, separator)}@${userAgent.slice(separator + 1)}`;
    }
    return 'unknown';
};

const hash = (value: unknown): string =>
    crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const buildAutomaticReviewer =
    (input: {
        profile: ModelProfile;
        runtime: GenerationRuntime;
        rate: string[];
    }): ((
        attempt: ResponseComparisonAttempt
    ) => Promise<ResponseComparisonAutomaticReview | undefined>) =>
    async (attempt) => {
        if (!attempt.output) return undefined;
        const instruction =
            'Review the candidate against every supplied requirement and rating dimension. Preserve uncertainty and do not invent evidence. Return exactly one result for every requirement and dimension.';
        const reviewInput = {
            sourceMessages: attempt.source.messages,
            persona: attempt.source.persona,
            resolvedPresentationGuidance: attempt.source.resolvedGuidance,
            expressionGuidance: attempt.source.expressionGuidance,
            expressionStrength: attempt.source.expressionStrength,
            requirements: attempt.source.reviewRequirements,
            dimensions: input.rate,
            response: attempt.output.text,
        };
        const prompt = JSON.stringify(reviewInput);
        const schema: GenerationStructuredOutput['schema'] = {
            type: 'object',
            additionalProperties: false,
            properties: {
                mustKeep: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            requirementId: { type: 'string' },
                            result: {
                                type: 'string',
                                enum: ['pass', 'fail', 'uncertain'],
                            },
                            explanation: { type: 'string' },
                            excerpt: { type: 'string' },
                            evidence: { type: 'string' },
                        },
                        required: [
                            'requirementId',
                            'result',
                            'explanation',
                            'excerpt',
                            'evidence',
                        ],
                    },
                },
                ratings: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            dimension: { type: 'string' },
                            score: { type: 'integer', minimum: 1, maximum: 5 },
                            rationale: { type: 'string' },
                            evidence: { type: 'string' },
                        },
                        required: [
                            'dimension',
                            'score',
                            'rationale',
                            'evidence',
                        ],
                    },
                },
            },
            required: ['mustKeep', 'ratings'],
        };
        const promptHash = hash(prompt);
        const schemaHash = hash(schema);
        const startedAt = Date.now();
        const reviewer = {
            profile: input.profile.id,
            provider: input.profile.provider,
            model: input.profile.providerModel,
        };
        try {
            const result = await input.runtime.generate({
                messages: [
                    { role: 'system', content: instruction },
                    { role: 'user', content: prompt },
                ],
                model: input.profile.providerModel,
                provider: input.profile.provider,
                capabilities: input.profile.capabilities,
                structuredOutput: {
                    name: 'response-comparison-review',
                    schema,
                },
            });
            const parsed: unknown = JSON.parse(result.text);
            if (
                !isRecord(parsed) ||
                !Array.isArray(parsed.mustKeep) ||
                !Array.isArray(parsed.ratings)
            )
                throw new Error('automatic review shape invalid');
            const mustKeep = parsed.mustKeep.map(
                (
                    item
                ): ResponseComparisonAutomaticReview['mustKeep'][number] => {
                    if (
                        !isRecord(item) ||
                        typeof item.requirementId !== 'string' ||
                        !(['pass', 'fail', 'uncertain'] as const).includes(
                            item.result as 'pass' | 'fail' | 'uncertain'
                        ) ||
                        typeof item.explanation !== 'string' ||
                        typeof item.excerpt !== 'string' ||
                        typeof item.evidence !== 'string'
                    )
                        throw new Error(
                            'automatic review must-keep item invalid'
                        );
                    return {
                        requirementId: item.requirementId,
                        result: item.result as 'pass' | 'fail' | 'uncertain',
                        explanation: item.explanation,
                        excerpt: item.excerpt,
                        evidence: item.evidence,
                    };
                }
            );
            const ratings = parsed.ratings.map(
                (
                    item
                ): ResponseComparisonAutomaticReview['ratings'][number] => {
                    if (
                        !isRecord(item) ||
                        typeof item.dimension !== 'string' ||
                        typeof item.score !== 'number' ||
                        !Number.isInteger(item.score) ||
                        item.score < 1 ||
                        item.score > 5 ||
                        typeof item.rationale !== 'string' ||
                        typeof item.evidence !== 'string'
                    )
                        throw new Error('automatic review rating item invalid');
                    return {
                        dimension: item.dimension,
                        score: item.score as 1 | 2 | 3 | 4 | 5,
                        rationale: item.rationale,
                        evidence: item.evidence,
                    };
                }
            );
            const expectedRequirements = attempt.source.reviewRequirements.map(
                (requirement) => requirement.id
            );
            const expectedDimensions = input.rate;
            const isExact = (actual: string[], expected: string[]): boolean =>
                actual.length === expected.length &&
                new Set(actual).size === actual.length &&
                actual.every((value) => expected.includes(value));
            if (
                !isExact(
                    mustKeep.map((item) => item.requirementId),
                    expectedRequirements
                ) ||
                !isExact(
                    ratings.map((item) => item.dimension),
                    expectedDimensions
                )
            )
                throw new Error('incomplete_or_invalid_review');
            const reportedCost =
                result.upstreamAttribution?.upstreamReportedCostUsd;
            const estimatedCost =
                reportedCost === undefined &&
                input.profile.provider === 'openai' &&
                result.usage?.promptTokens !== undefined &&
                result.usage?.completionTokens !== undefined
                    ? estimateOpenAITextCost(
                          input.profile.providerModel,
                          result.usage.promptTokens,
                          result.usage.completionTokens
                      ).totalCost
                    : undefined;
            return {
                reviewer,
                promptHash,
                schemaHash,
                instruction,
                schema,
                status: 'completed',
                mustKeep,
                ratings,
                timing: {
                    latencyMs: Date.now() - startedAt,
                    usage: result.usage,
                    ...(reportedCost !== undefined
                        ? {
                              costUsd: reportedCost,
                              costSource: 'provider_reported' as const,
                          }
                        : estimatedCost !== undefined
                          ? {
                                costUsd: estimatedCost,
                                costSource: 'backend_estimate' as const,
                            }
                          : {}),
                },
            };
        } catch (error) {
            return {
                reviewer,
                promptHash,
                schemaHash,
                instruction,
                schema,
                status: 'failed',
                mustKeep: [],
                ratings: [],
                timing: { latencyMs: Date.now() - startedAt },
                failure:
                    error instanceof Error
                        ? error.message
                        : 'automatic_review_failed',
            };
        }
    };

const main = async (): Promise<void> => {
    const options = parseArgs(process.argv.slice(2));
    const loaded = loadResponseComparisonConfig(options.configPath, root);
    const { runtimeConfig } = await import('../packages/backend/src/config.js');
    const { resolvePersonaExpression, resolvePersonaPresentationGuidance } =
        await import('../packages/backend/src/services/chatProfileOverlay.js');
    const profiles = new Map(
        runtimeConfig.modelProfiles.catalog.map((profile) => [
            profile.id,
            profile,
        ])
    );
    const selectedModels = [
        ...loaded.config.models,
        ...(loaded.config.review.automaticReviewer
            ? [loaded.config.review.automaticReviewer]
            : []),
    ];
    const selectedProfiles = selectedModels.map((model) =>
        resolveModel(model, profiles)
    );
    const missingProfiles = loaded.config.models.filter(
        (model) => resolveModel(model, profiles) === null
    );
    const automaticReviewer = loaded.config.review.automaticReviewer;
    const automaticReviewerProfile =
        automaticReviewer === undefined
            ? null
            : resolveModel(automaticReviewer, profiles);
    const credentialProviders = new Set(
        selectedProfiles
            .filter((profile): profile is ModelProfile => profile !== null)
            .map((profile) => profile.provider)
    );
    const credentials = {
        openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
        openrouter: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
        ollama: Boolean(
            runtimeConfig.ollama.baseUrl ||
            runtimeConfig.ollama.localInferenceEnabled
        ),
    };
    const support = buildSupportChecker();
    const checks = [
        `config: valid (${options.configPath})`,
        `models: ${loaded.config.models.length} configured; ${missingProfiles.length} missing profile references`,
        ...supportedProviders
            .filter((provider) => credentialProviders.has(provider))
            .map(
                (provider) =>
                    `credentials ${provider}: ${credentials[provider] ? 'available' : 'missing'}`
            ),
        `planned attempts: ${loaded.config.models.length * loaded.config.settings.length * loaded.config.cases.length * loaded.config.repeats}`,
    ];
    if (options.check) {
        for (const model of loaded.config.models) {
            const profile = resolveModel(model, profiles);
            if (profile === null) {
                checks.push(
                    `support ${JSON.stringify(model)}: not_tested (profile_not_found)`
                );
                continue;
            }
            for (const setting of loaded.config.settings) {
                const values: PresentationGenerationSettings =
                    settingToRequest(setting);
                checks.push(
                    `${modelLabel(model, profile)} | ${setting === 'default' ? 'Provider defaults' : JSON.stringify(setting)}: ${describeSupport(await support.check(profile, values))}`
                );
            }
        }
        if (automaticReviewer !== undefined) {
            const reviewerModel = automaticReviewer;
            const reviewerProfile = automaticReviewerProfile;
            if (reviewerProfile === null) {
                checks.push(
                    `automatic reviewer ${reviewerModel.profile}: not_tested (profile_not_found)`
                );
            } else {
                const reviewerSupport = await support.check(
                    reviewerProfile,
                    {}
                );
                const structuredReviewSupported =
                    reviewerProfile.capabilities.toolCapabilities?.[
                        'routing.generation.structured-cheap'
                    ] === true;
                checks.push(
                    `automatic reviewer ${modelLabel(reviewerModel, reviewerProfile)} | structured review: ${
                        structuredReviewSupported
                            ? describeSupport(reviewerSupport)
                            : 'structured review capability is not advertised (unsupported; structured_review_capability_not_advertised)'
                    }`
                );
            }
        }
        console.log(checks.map((line) => `- ${line}`).join('\n'));
        return;
    }
    if (automaticReviewer !== undefined && automaticReviewerProfile === null)
        throw new Error(
            `Automatic reviewer profile not found: ${automaticReviewer.profile}`
        );
    const defaultProfile =
        selectedProfiles.find(
            (profile): profile is ModelProfile => profile !== null
        ) ?? runtimeConfig.modelProfiles.catalog[0];
    if (defaultProfile === undefined)
        throw new Error(
            'No model profile is available for comparison runtime startup.'
        );
    const { createVoltAgentRuntime } =
        await import('../packages/agent-runtime/src/voltagentRuntime.js');
    const { runPresentationCandidate } =
        await import('../packages/backend/src/services/presentation.js');
    const runtime = createVoltAgentRuntime({
        defaultModel: `${defaultProfile.provider}/${defaultProfile.providerModel}`,
        ollama: {
            baseUrl: runtimeConfig.ollama.baseUrl ?? undefined,
            apiKey: runtimeConfig.ollama.apiKey ?? undefined,
            localInferenceEnabled: runtimeConfig.ollama.localInferenceEnabled,
        },
        openrouter: {
            apiKey: runtimeConfig.openrouter.apiKey ?? undefined,
            baseUrl: runtimeConfig.openrouter.baseUrl,
        },
    });
    const dependencies: ComparisonDependencies = {
        profiles,
        generationRuntime: runtime,
        runCandidate: runPresentationCandidate,
        resolvePersona: (item) => {
            const expression = resolvePersonaExpression(
                { personaExpressionStrength: item.expressionStrength },
                { id: item.persona }
            );
            return {
                id: item.persona,
                presentationGuidance: resolvePersonaPresentationGuidance(
                    item.persona
                ),
                expressionStrength: expression.strength,
                expressionSource: expression.source,
                expressionGuidance: expression.guidance,
            };
        },
        prepareProfile: support.prepareProfile,
        checkProviderSupport: support.check,
        ...(automaticReviewer !== undefined &&
            automaticReviewerProfile !== null && {
                automaticReviewer: buildAutomaticReviewer({
                    profile: automaticReviewerProfile,
                    runtime,
                    rate: loaded.config.review.rate,
                }),
            }),
        gitSha: gitSha(),
        dependencies: {
            node: process.version,
            runtime: runtime.kind,
            packageManager: packageManagerVersion(),
        },
    };
    const report = await runResponseComparison({
        configPath: path
            .relative(root, options.configPath)
            .replaceAll(path.sep, '/'),
        checkpointRoot: path.join(root, '.footnote/response-comparison'),
        command: `pnpm responses:compare --config ${path.relative(root, options.configPath).replaceAll(path.sep, '/')}`,
        config: loaded.config,
        configHash: loaded.hash,
        dependencies,
    });
    const reportPath = writeResponseComparisonReport(root, report);
    console.log(
        JSON.stringify({
            reportId: report.reportId,
            reportPath,
            attempts: report.attempts.length,
            completed: report.attempts.filter(
                (attempt) => attempt.status === 'completed'
            ).length,
        })
    );
};

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
