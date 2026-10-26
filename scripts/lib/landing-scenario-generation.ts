/**
 * @description: Shared landing-scenario generation helpers for live capture, sanitization, and fixture emission.
 * @footnote-scope: utility
 * @footnote-module: LandingScenarioGeneration
 * @footnote-risk: medium - Incorrect fixture generation would leak unstable capture details into public landing examples.
 * @footnote-ethics: high - Prepared examples influence how users understand transparency, provenance, and review.
 */

import crypto from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';

import type {
    ChatMessageActionResponse,
    PostChatRequest,
} from '@footnote/contracts/web';
import type {
    ResponseMetadata,
    WorkflowModeId,
} from '@footnote/contracts/policy';

export type LandingScenarioPromptConfig = {
    id: string;
    question: string;
    submittedPrompt?: string;
};

export type LandingScenarioMetadata = Pick<
    ResponseMetadata,
    | 'responseId'
    | 'provenance'
    | 'safetyTier'
    | 'tradeoffCount'
    | 'chainHash'
    | 'licenseContext'
    | 'modelVersion'
    | 'staleAfter'
    | 'citations'
    | 'provenanceAssessment'
    | 'execution'
    | 'workflow'
    | 'steerabilityControls'
    | 'trace_target'
    | 'trace_final'
    | 'trace_final_reason_code'
    | 'reviewRuntime'
    | 'evaluator'
    | 'totalDurationMs'
>;

export type LandingScenarioRuntimePayload = {
    id: string;
    question: string;
    response: Omit<ChatMessageActionResponse, 'metadata'> & {
        metadata: LandingScenarioMetadata;
    };
};

export type LandingScenario = LandingScenarioRuntimePayload;

export type LandingScenarioCapture = {
    generatedAt: string;
    backendBaseUrl: string;
    workflowModeId: string;
    capturedResponseId: string;
    capturedChainHash: string;
    capturedQuestion?: string;
};

export type LandingScenarioFixture = LandingScenarioRuntimePayload & {
    capture: LandingScenarioCapture;
};

export type LandingScenarioGenerationInput = {
    scenario: LandingScenarioPromptConfig;
    response: ChatMessageActionResponse;
    capturedResponseId: string;
    capturedChainHash: string;
    capturedAt: string;
    backendBaseUrl: string;
    workflowModeId: WorkflowModeId;
};

export type LandingScenarioRequestOptions = {
    backendBaseUrl: string;
    modeId: WorkflowModeId;
};

const SCENARIO_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Defines the public landing prompts that may be captured from the backend.
 *
 * The ids are stable fixture keys, so they stay serializable and do not carry
 * runtime provenance until a capture is sanitized.
 */
export const LANDING_SCENARIO_PROMPTS = [
    {
        id: 'inspect-an-answer',
        question:
            'Can you walk me through how to trace why Footnote gave an answer? Please link to two relevant documentation pages.',
        submittedPrompt:
            'In about 1,500 characters, how can I inspect why Footnote answered something? Link to two relevant documentation pages.',
    },
    {
        id: 'unconfirmed-claims',
        question: "What does Footnote do when it can't confirm a claim?",
    },
    {
        id: 'run-locally',
        question: 'Can I run Footnote locally instead of using a cloud model?',
    },
    {
        id: 'weekly-household-checklist',
        question:
            'What should I include in a simple weekly household checklist?',
    },
    {
        id: 'compare-commute-options',
        question:
            'How can I compare two commute options without relying on precise numerical claims?',
    },
    {
        id: 'project-context-explainer',
        question: "How does Footnote's project context integration work?",
    },
] as const satisfies readonly LandingScenarioPromptConfig[];

/**
 * Selects all landing prompts by default or one known prompt for a safe refresh.
 */
export const selectLandingScenarioPrompts = (
    args: readonly string[]
): readonly (typeof LANDING_SCENARIO_PROMPTS)[number][] => {
    if (args.length === 0) return LANDING_SCENARIO_PROMPTS;
    if (args.length !== 2 || args[0] !== '--scenario-id') {
        throw new Error('Expected no arguments or --scenario-id <known-id>.');
    }

    const prompt = LANDING_SCENARIO_PROMPTS.find(
        (candidate) => candidate.id === args[1]
    );
    if (!prompt) {
        throw new Error(`Unknown landing scenario id: ${args[1]}`);
    }

    return [prompt];
};

/** Replaces known fixture ids in place while preserving every other capture. */
export const mergeLandingScenarioFixtures = (
    existing: readonly LandingScenarioFixture[],
    replacements: readonly LandingScenarioFixture[]
): LandingScenarioFixture[] => {
    const replacementIds = new Set<string>();
    for (const replacement of replacements) {
        if (replacementIds.has(replacement.id)) {
            throw new Error(
                `Duplicate landing scenario replacement: ${replacement.id}`
            );
        }
        replacementIds.add(replacement.id);
        if (
            existing.filter((fixture) => fixture.id === replacement.id)
                .length !== 1
        ) {
            throw new Error(
                `Expected one existing landing scenario: ${replacement.id}`
            );
        }
    }

    return existing.map(
        (fixture) =>
            replacements.find((replacement) => replacement.id === fixture.id) ??
            fixture
    );
};

/**
 * Builds the prepared-response hash used by checked-in landing fixtures.
 *
 * The hash intentionally uses only the public question and message so regenerated
 * fixtures do not expose backend runtime ids or private capture details.
 */
export const canonicalLandingHash = (
    question: string,
    message: string
): string =>
    crypto
        .createHash('sha256')
        .update(`landing-prepared-v1\nquestion:${question}\nmessage:${message}`)
        .digest('hex')
        .slice(0, 16);

/**
 * Enforces the fixture id boundary before data is emitted to web-facing JSON.
 *
 * This keeps generated files addressable by predictable kebab-case names and
 * prevents arbitrary ids from becoming public fixture keys.
 */
export function assertScenarioId(value: string): void {
    if (!SCENARIO_ID_PATTERN.test(value)) {
        throw new Error(`Invalid landing scenario id: ${value}`);
    }
}

export function assertNonEmptyCapturedAnswer(message: string): void {
    if (!message.trim()) {
        throw new Error('Expected landing scenario response to be non-empty.');
    }
}

/**
 * Constructs the backend chat request used during landing scenario capture.
 *
 * The request is limited to text messaging and records only the request host so
 * fixture generation does not depend on browser-only state.
 */
export const buildChatRequest = (
    scenario: LandingScenarioPromptConfig,
    options: LandingScenarioRequestOptions
): PostChatRequest => {
    const submittedPrompt = scenario.submittedPrompt ?? scenario.question;

    return {
        surface: 'web',
        modeId: options.modeId,
        trigger: { kind: 'submit' },
        latestUserInput: submittedPrompt,
        conversation: [
            {
                role: 'user',
                content: submittedPrompt,
            },
        ],
        capabilities: {
            canReact: false,
            canGenerateImages: false,
            canUseTts: false,
        },
        surfaceContext: {
            requestHost: new URL(options.backendBaseUrl).host,
        },
    };
};

/**
 * Converts a backend chat response into the public runtime fixture shape.
 *
 * Capture-only fields are stripped, provenance metadata is narrowed to the web
 * display contract, and the chain hash is replaced with the prepared hash.
 */
export const sanitizeLandingScenarioResponse = (
    input: LandingScenarioGenerationInput
): LandingScenarioRuntimePayload => {
    assertScenarioId(input.scenario.id);
    if (input.response.action !== 'message') {
        throw new Error(
            `Expected message action for landing scenario, received ${input.response.action}`
        );
    }

    if (input.response.modality !== 'text') {
        throw new Error(
            `Expected text modality for landing scenario, received ${input.response.modality}`
        );
    }

    return {
        id: input.scenario.id,
        question: input.scenario.question,
        response: {
            action: input.response.action,
            message: input.response.message,
            modality: input.response.modality,
            metadata: {
                responseId: `prepared-landing-${input.scenario.id}`,
                provenance: input.response.metadata.provenance,
                safetyTier: input.response.metadata.safetyTier,
                tradeoffCount: input.response.metadata.tradeoffCount,
                chainHash: canonicalLandingHash(
                    input.scenario.question,
                    input.response.message
                ),
                licenseContext: input.response.metadata.licenseContext,
                modelVersion: input.response.metadata.modelVersion,
                staleAfter: input.response.metadata.staleAfter,
                citations: input.response.metadata.citations,
                ...(input.response.metadata.provenanceAssessment !==
                    undefined && {
                    provenanceAssessment:
                        input.response.metadata.provenanceAssessment,
                }),
                ...(input.response.metadata.execution !== undefined && {
                    execution: input.response.metadata.execution,
                }),
                ...(input.response.metadata.workflow !== undefined && {
                    workflow: input.response.metadata.workflow,
                }),
                ...(input.response.metadata.steerabilityControls !==
                    undefined && {
                    steerabilityControls:
                        input.response.metadata.steerabilityControls,
                }),
                trace_target: input.response.metadata.trace_target,
                trace_final: input.response.metadata.trace_final,
                trace_final_reason_code:
                    input.response.metadata.trace_final_reason_code,
                reviewRuntime: input.response.metadata.reviewRuntime,
                evaluator: input.response.metadata.evaluator,
                totalDurationMs: input.response.metadata.totalDurationMs,
            },
        },
    };
};

/**
 * Adds compact capture provenance around a sanitized landing scenario.
 *
 * The capture block keeps regeneration audit data separate from the runtime
 * response payload that the web UI renders.
 */
export const buildLandingScenarioFixture = (
    input: LandingScenarioGenerationInput
): LandingScenarioFixture => ({
    ...sanitizeLandingScenarioResponse(input),
    capture: {
        generatedAt: input.capturedAt,
        backendBaseUrl: input.backendBaseUrl,
        workflowModeId: input.workflowModeId,
        capturedResponseId: input.capturedResponseId,
        capturedChainHash: input.capturedChainHash,
        ...(input.scenario.submittedPrompt !== undefined && {
            capturedQuestion: input.scenario.submittedPrompt,
        }),
    },
});

/**
 * Emits stable pretty JSON with the trailing newline expected by fixtures.
 */
export const formatJson = (value: unknown): string =>
    `${JSON.stringify(value, null, 4)}\n`;

/**
 * Replaces a generated fixture only after its complete JSON has been written.
 */
export const writeJsonFileAtomically = async (
    filePath: string,
    value: unknown
): Promise<void> => {
    const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
        await writeFile(tempPath, formatJson(value), 'utf8');
        await rename(tempPath, filePath);
    } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
};
