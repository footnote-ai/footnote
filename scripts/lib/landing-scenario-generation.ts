/**
 * @description: Shared landing-scenario generation helpers for live capture, sanitization, and fixture emission.
 * @footnote-scope: utility
 * @footnote-module: LandingScenarioGeneration
 * @footnote-risk: medium - Incorrect fixture generation would leak unstable capture details into public landing examples.
 * @footnote-ethics: high - Prepared examples influence how users understand transparency, provenance, and review.
 */

import crypto from 'node:crypto';

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
        id: 'what-is-footnote',
        question: 'What is Footnote?',
    },
    {
        id: 'what-does-footnote-do-differently',
        question: 'What does Footnote do differently from other AI tools?',
    },
    {
        id: 'why-show-work-if-answer-can-be-wrong',
        question:
            'Why does showing the work matter if the answer can still be wrong?',
    },
    {
        id: 'what-should-people-know-about-ai-answer',
        question: 'What should people be able to know about an AI answer?',
    },
] as const satisfies readonly LandingScenarioPromptConfig[];

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

/**
 * Constructs the backend chat request used during landing scenario capture.
 *
 * The request is limited to text messaging and records only the request host so
 * fixture generation does not depend on browser-only state.
 */
export const buildChatRequest = (
    scenario: LandingScenarioPromptConfig,
    options: LandingScenarioRequestOptions
): PostChatRequest => ({
    surface: 'web',
    modeId: options.modeId,
    trigger: { kind: 'submit' },
    latestUserInput: scenario.question,
    conversation: [
        {
            role: 'user',
            content: scenario.question,
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
});

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
            ...input.response,
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
    },
});

/**
 * Emits stable pretty JSON with the trailing newline expected by fixtures.
 */
export const formatJson = (value: unknown): string =>
    `${JSON.stringify(value, null, 4)}\n`;
