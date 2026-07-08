/**
 * @description: Loads prepared landing response fixtures from checked-in JSON files so runtime code stays thin.
 * @footnote-scope: web
 * @footnote-module: LandingScenarios
 * @footnote-risk: medium - Incorrect fixture loading would misrepresent the public landing examples.
 * @footnote-ethics: high - Prepared examples shape public understanding of provenance and review.
 */

import type { ChatMessageActionResponse } from '@footnote/contracts/web';
import type { ResponseMetadata } from '@footnote/contracts/policy';
import { PostChatResponseSchema } from '@footnote/contracts/web/schemas';
import landingScenarioFixturesJson from './landingScenarioFixtures.json';

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

export type LandingScenario = {
    id: string;
    question: string;
    response: Omit<ChatMessageActionResponse, 'metadata'> & {
        metadata: LandingScenarioMetadata;
    };
};

export type LandingScenarioCapture = {
    generatedAt: string;
    backendBaseUrl: string;
    workflowModeId: string;
    capturedResponseId: string;
    capturedChainHash: string;
};

export type LandingScenarioFixture = LandingScenario & {
    capture: LandingScenarioCapture;
};

const parseLandingScenarioResponse = (
    value: unknown,
    index: number
): LandingScenario['response'] => {
    const parsedResponse = PostChatResponseSchema.safeParse(value);
    if (!parsedResponse.success) {
        throw new Error(
            `Invalid landing scenario fixture at landingScenarioFixtures[${index}].response: ${parsedResponse.error.message}`
        );
    }

    if (parsedResponse.data.action !== 'message') {
        throw new Error(
            `Invalid landing scenario fixture at landingScenarioFixtures[${index}].response.action.`
        );
    }
    if (parsedResponse.data.modality !== 'text') {
        throw new Error(
            `Invalid landing scenario fixture at landingScenarioFixtures[${index}].response.modality.`
        );
    }

    return parsedResponse.data;
};

const landingScenarioFixtures = landingScenarioFixturesJson.map(
    (fixture, index): LandingScenarioFixture => ({
        id: fixture.id,
        question: fixture.question,
        response: parseLandingScenarioResponse(fixture.response, index),
        capture: fixture.capture,
    })
) satisfies readonly LandingScenarioFixture[];

export const landingScenarios = landingScenarioFixtures.map(
    ({ capture: _capture, ...scenario }) => scenario
) as readonly LandingScenario[];
