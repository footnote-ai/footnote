/**
 * @description: Compares six paired automatic and deliberate cache requests through the existing runtime.
 * @footnote-scope: test
 * @footnote-module: CacheProbe
 * @footnote-risk: high - Live requests spend operator funds under a durable conservative allowance.
 * @footnote-ethics: high - Evidence contains measurements and hashes, never prompts, responses, or credentials.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createVoltAgentRuntime,
    isGenerationRuntimeError,
    normalizeProviderTextUsage,
    type GenerationRequest,
    type GenerationUsage,
} from '../packages/agent-runtime/src/index.js';
import type { ModelProfile } from '../packages/contracts/src/index.js';
import { openAITextPricingTable } from '../packages/contracts/src/pricing.js';
import { applyPromptCaching } from '../packages/backend/src/services/workflowEngine/promptCaching.js';
import { estimateBackendTextCost } from '../packages/backend/src/services/llmCostRecorder.js';
import { renderConversationPromptLayers } from '../packages/backend/src/services/prompts/conversationPromptLayers.js';
import {
    cacheProbeLimits,
    dispatchCacheProbeRequest,
    type CacheProbeBudget,
} from './lib/cache-probe-budget.js';
import {
    assertCacheProbeCheckpointMatches,
    readCacheProbeCommit,
    resolveCacheProbeGit,
} from './lib/cache-probe-git.js';
import {
    assertCacheProbeCanResume,
    cacheProbeSchedule,
    prepareCacheProbeWire,
    summarizeCacheProbe,
    type CacheProbeCell,
    type CacheProbeSample,
    type CacheProbeWire,
} from './lib/cache-probe-comparison.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = process.argv.slice(2);
assert.ok(
    flags.length <= 2 &&
        (!flags[0] || ['--check', '--live'].includes(flags[0])) &&
        (!flags[1] || flags[1].startsWith('--pricing-verified-at=')),
    'Usage: pnpm cache:probe [--check | --live [--pricing-verified-at=<ISO time>]]'
);
const live = flags[0] === '--live';
const pricingVerifiedAt = flags[1]?.slice('--pricing-verified-at='.length);
const git = resolveCacheProbeGit(process.platform);
const commit = readCacheProbeCommit(git, root);
const hash = (value: string | Buffer): string =>
    createHash('sha256').update(value).digest('hex');
const sources = execFileSync(
    git,
    [
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        'packages',
        'scripts',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'package.json',
    ],
    { cwd: root, encoding: 'utf8' }
)
    .trim()
    .split(/\r?\n/)
    .sort();
const reportSourceDigest = hash(
    sources
        .map(
            (file) => `${file}\0${hash(fs.readFileSync(path.join(root, file)))}`
        )
        .join('\n')
);
const original = path.join(root, 'docs/status/prompt-cache-probe.json');
const historicalSha256 =
    'dee1239dce2c5e083fadf2877676419e164e6232e2f50557bbeac7343f490a12';
assert.equal(
    hash(fs.readFileSync(original)),
    historicalSha256,
    'Historical experiment changed; refusing to run.'
);
const output = path.join(root, 'docs/status/prompt-cache-comparison.json');
const budget: CacheProbeBudget = { calls: 0, reservedUsd: 0 };
const samples: CacheProbeSample[] = [];
type WireRequest = CacheProbeCell &
    CacheProbeWire & {
        status: 'reserved' | 'reported';
        httpStatus?: number;
        usage?: GenerationUsage;
        model?: string;
    };
const wireRequests: WireRequest[] = [];
const rate = openAITextPricingTable['gpt-5.6-luna'];
const pricing = {
    inputPerToken: rate.input / 1e6,
    outputPerToken: rate.output / 1e6,
};
const preflight = {
    credentialsAvailable: Boolean(process.env.OPENAI_API_KEY),
    pricingVerifiedAt,
    pricingFresh:
        pricingVerifiedAt !== undefined &&
        Date.now() - Date.parse(pricingVerifiedAt) >= 0 &&
        Date.now() - Date.parse(pricingVerifiedAt) < 15 * 60 * 1000,
    ratesMatchApproved:
        rate.input === 0.2 &&
        rate.cachedInput === 0.02 &&
        rate.output === 1.2 &&
        rate.cacheWriteMultiplier === 1.25,
};
const profile: ModelProfile = {
    id: 'cache-probe-openai',
    description: 'Synthetic paired cache comparison',
    provider: 'openai',
    providerModel: 'gpt-5.6-luna',
    enabled: true,
    tierBindings: [],
    capabilities: { canUseSearch: false },
    promptCaching: { enabled: true, ttlSeconds: 1800 },
};
const layers = renderConversationPromptLayers('discord-chat');
const suffixes = [
    'The library opens at nine and closes at five. What time does it close?',
    'The library opens at nine and closes at five. What time does it close?',
    'The library opens at ten and closes at six. What time does it close?',
    'The library opens at eight and closes at four. What time does it close?',
    'The library opens at eleven and closes at seven. What time does it close?',
    'The library opens at seven and closes at three. What time does it close?',
];
const answers = ['five', 'five', 'six', 'four', 'seven', 'three'];

const run = async (): Promise<void> => {
    if (!live) {
        console.log(
            JSON.stringify(
                {
                    mode: 'check',
                    provider: profile.provider,
                    model: profile.providerModel,
                    ...preflight,
                    limits: cacheProbeLimits,
                    plannedRequests: 12,
                    stablePrefixBytes: Buffer.byteLength(
                        layers.systemPrompt + layers.personaPrompt
                    ),
                    billedCalls: 0,
                },
                null,
                2
            )
        );
        return;
    }
    // A crash leaves the lock in place. Reconcile it manually; never start overlapping allowances.
    const lock = output + '.lock';
    const lockFd = fs.openSync(lock, 'wx');
    const originalFetch = globalThis.fetch;
    let experimentId = randomUUID() as string;
    let active: CacheProbeCell | undefined;
    let activeWire: CacheProbeWire | undefined;
    const persist = (): void => {
        const temporary = output + '.tmp';
        const checkpoint = {
            experimentId,
            fixtureVersion: 2,
            commit,
            reportSourceDigest,
            capturedAt: new Date().toISOString(),
            synthetic: true,
            historicalExperiment: {
                experimentId: '44cf86b6-2860-4a66-8a63-44c26173d6e5',
                sha256: historicalSha256,
            },
            provider: profile.provider,
            model: profile.providerModel,
            pricing: {
                ...rate,
                verifiedAt: pricingVerifiedAt,
                sources: [
                    'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
                    'https://developers.openai.com/api/docs/guides/prompt-caching',
                ],
            },
            preflight,
            limits: cacheProbeLimits,
            budget,
            samples,
            wireRequests,
            result: !preflight.credentialsAvailable
                ? {
                      outcome: 'inconclusive',
                      issues: ['direct_openai_credentials_unavailable'],
                  }
                : !preflight.pricingFresh || !preflight.ratesMatchApproved
                  ? {
                        outcome: 'inconclusive',
                        issues: ['fresh_verified_pricing_required'],
                    }
                  : summarizeCacheProbe(samples, budget.calls),
            limitations: [
                'Only this six-request reuse pattern is tested.',
                'Costs are usage-priced estimates, not invoice reconciliation.',
                'Retention, production hit rates and latency significance are not tested.',
                'Any spent or interrupted experiment is terminal and cannot be replayed.',
            ],
            deliberateCachingEnabledByDefault: false,
        };
        const fd = fs.openSync(temporary, 'w');
        try {
            fs.writeFileSync(fd, JSON.stringify(checkpoint, null, 2) + '\n');
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(temporary, output);
    };
    try {
        if (fs.existsSync(output)) {
            const previous = JSON.parse(fs.readFileSync(output, 'utf8')) as {
                commit: string;
                reportSourceDigest: string;
            };
            assertCacheProbeCheckpointMatches(
                previous,
                commit,
                reportSourceDigest
            );
            experimentId = assertCacheProbeCanResume(previous).experimentId;
        }
        persist();
        if (
            !preflight.credentialsAvailable ||
            !preflight.pricingFresh ||
            !preflight.ratesMatchApproved
        ) {
            console.log(
                JSON.stringify(
                    {
                        output: path.relative(root, output),
                        ...preflight,
                        ...budget,
                        outcome: 'inconclusive',
                    },
                    null,
                    2
                )
            );
            process.exitCode = 2;
            return;
        }
        globalThis.fetch = async (input, init) => {
            const url = new URL(
                typeof input === 'string' || input instanceof URL
                    ? String(input)
                    : input.url
            );
            const method =
                init?.method ??
                (input instanceof Request ? input.method : 'GET');
            // Deny background SDK traffic too: the probe owns exactly one paid endpoint.
            assert.ok(
                active &&
                    method.toUpperCase() === 'POST' &&
                    url.href === 'https://api.openai.com/v1/responses',
                'Unexpected probe transport.'
            );
            const serialized =
                typeof init?.body === 'string'
                    ? init.body
                    : input instanceof Request
                      ? await input.clone().text()
                      : undefined;
            assert.ok(serialized !== undefined, 'Missing serialized request.');
            const marker = `${active.arm === 'automatic' ? 'A' : 'B'} ${experimentId}`;
            const { body, ...wire } = prepareCacheProbeWire(
                serialized,
                active.arm,
                marker
            );
            const matched = wireRequests.find(
                (request) =>
                    request.pair === active!.pair && request.arm !== active!.arm
            );
            assert.ok(
                !matched ||
                    matched.equivalenceDigest === wire.equivalenceDigest,
                'Mismatched serialized pair.'
            );
            activeWire = wire;
            const request: WireRequest = {
                ...active,
                ...wire,
                status: 'reserved',
            };
            const response = await dispatchCacheProbeRequest(
                budget,
                body,
                pricing,
                () => {
                    wireRequests.push(request);
                    persist();
                },
                () => originalFetch(input, { ...init, body, redirect: 'error' })
            );
            request.httpStatus = response.status;
            try {
                const payload = (await response.clone().json()) as {
                    model?: unknown;
                    usage?: unknown;
                };
                request.usage = normalizeProviderTextUsage(payload.usage);
                request.model =
                    typeof payload.model === 'string' &&
                    /^gpt-[a-zA-Z0-9.\-]{1,80}$/.test(payload.model)
                        ? payload.model
                        : undefined;
                request.status = 'reported';
            } catch {
                /* Missing or malformed receipts remain incomplete, never measured zero. */
            }
            persist();
            return response;
        };
        const runtime = createVoltAgentRuntime({
            defaultModel: profile.providerModel,
        });
        for (const cell of cacheProbeSchedule()) {
            active = cell;
            activeWire = undefined;
            const before = budget.calls;
            const started = Date.now();
            const marker = `${cell.arm === 'automatic' ? 'A' : 'B'} ${experimentId}`;
            const request: GenerationRequest = applyPromptCaching(
                {
                    provider: 'openai',
                    model: profile.providerModel,
                    maxOutputTokens: 64,
                    reasoningEffort: 'none',
                    capabilities: profile.capabilities,
                    messages: [
                        {
                            role: 'system',
                            cacheable: true,
                            content: marker + '\n' + layers.systemPrompt,
                        },
                        {
                            role: 'system',
                            cacheable: true,
                            content: layers.personaPrompt,
                        },
                        {
                            role: 'system',
                            content:
                                'Effective request time: 2026-10-27T00:00:00.000Z (UTC). This is a synthetic library exercise.',
                        },
                        {
                            role: 'user',
                            content:
                                suffixes[cell.pair]! +
                                ' Reply with only the closing hour as one lowercase word.',
                        },
                    ],
                },
                profile,
                'generation',
                'discord'
            );
            try {
                const result = await runtime.generate({
                    ...request,
                    signal: AbortSignal.timeout(45000),
                });
                const receipt = wireRequests.at(-1);
                const usage = receipt?.usage;
                samples.push({
                    ...cell,
                    status: 'measured',
                    model: receipt?.model,
                    usage,
                    estimate: estimateBackendTextCost(
                        receipt?.model ?? 'unverified-model',
                        usage?.promptTokens,
                        usage?.completionTokens,
                        usage,
                        profile.provider
                    ),
                    durationMs: Date.now() - started,
                    wireCalls: budget.calls - before,
                    wire: activeWire,
                    rawReceiptVerified:
                        receipt?.status === 'reported' &&
                        receipt.httpStatus === 200 &&
                        receipt.model === result.model &&
                        JSON.stringify(usage) === JSON.stringify(result.usage),
                    outputValid:
                        result.text.trim().toLowerCase() === answers[cell.pair],
                });
            } catch (error) {
                const failure = isGenerationRuntimeError(error)
                    ? error
                    : undefined;
                samples.push({
                    ...cell,
                    status: 'failed',
                    model: failure?.model,
                    usage: failure?.usage,
                    estimate: failure?.usage
                        ? estimateBackendTextCost(
                              failure.model ?? profile.providerModel,
                              failure.usage.promptTokens,
                              failure.usage.completionTokens,
                              failure.usage,
                              profile.provider
                          )
                        : undefined,
                    durationMs: Date.now() - started,
                    wireCalls: budget.calls - before,
                    wire: activeWire,
                    outputValid: false,
                    rawReceiptVerified: false,
                });
                persist();
                break; // Preserve uncertain charges; do not spend more trying to repair this sequence.
            }
            persist();
        }
        console.log(
            JSON.stringify(
                {
                    output: path.relative(root, output),
                    ...budget,
                    result: summarizeCacheProbe(samples, budget.calls),
                },
                null,
                2
            )
        );
    } finally {
        globalThis.fetch = originalFetch;
        fs.closeSync(lockFd);
        fs.unlinkSync(lock);
    }
};
// SDK tracing timers must not keep this standalone process alive after its checkpoint is durable.
void run().then(
    () => process.exit(process.exitCode ?? 0),
    () => {
        console.error(
            'Cache comparison stopped; inspect its checkpoint. Do not reset or replay spent allowances.'
        );
        process.exit(1);
    }
);
