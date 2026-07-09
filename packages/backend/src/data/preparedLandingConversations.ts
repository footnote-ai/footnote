/**
 * @description: Validates curated landing examples used to seed reserved public conversation rows.
 * @footnote-scope: utility
 * @footnote-module: PreparedLandingConversations
 * @footnote-risk: medium - Bad seed validation could publish stale or malformed prepared examples.
 * @footnote-ethics: high - Prepared examples shape public expectations about provenance and review.
 */

import { createRequire } from 'node:module';
import { PostChatResponseSchema } from '@footnote/contracts/web/schemas';
import type { ReservedLandingConversationSeed } from '../storage/traces/traceStore.js';

type LandingScenarioFixture = {
    id: string;
    question: string;
    response: unknown;
};

const require = createRequire(import.meta.url);
const landingScenarioFixturesJson = require('./landingScenarioFixtures.json') as
    readonly LandingScenarioFixture[];

const SCENARIO_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const assertScenarioId = (scenarioId: string, index: number): void => {
    if (!SCENARIO_ID_PATTERN.test(scenarioId)) {
        throw new Error(
            `Invalid prepared landing scenario id at index ${index}: ${scenarioId}`
        );
    }
};

export const loadPreparedLandingConversationSeeds =
    (): readonly ReservedLandingConversationSeed[] =>
        landingScenarioFixturesJson.map((fixture, index) => {
            assertScenarioId(fixture.id, index);

            const parsedResponse = PostChatResponseSchema.safeParse(
                fixture.response
            );
            if (!parsedResponse.success) {
                throw new Error(
                    `Invalid prepared landing response for ${fixture.id}: ${parsedResponse.error.message}`
                );
            }
            if (parsedResponse.data.action !== 'message') {
                throw new Error(
                    `Prepared landing response for ${fixture.id} must be a message action.`
                );
            }
            if (parsedResponse.data.modality !== 'text') {
                throw new Error(
                    `Prepared landing response for ${fixture.id} must use text modality.`
                );
            }

            return {
                threadId: `reserved-landing-${fixture.id}`,
                scenarioId: fixture.id,
                question: fixture.question,
                response: parsedResponse.data,
                displayOrder: index,
            };
        });
