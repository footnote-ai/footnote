/**
 * @description: Loads the single prepared embed answer from a schema-checked runtime capture.
 * @footnote-scope: web
 * @footnote-module: EmbedScenario
 * @footnote-risk: medium - Invalid fixture data could break the public embed or misstate response metadata.
 * @footnote-ethics: high - The prepared answer and its provenance must remain the real captured response.
 */
import type { ChatMessageActionResponse } from '@footnote/contracts/web';
import { PostChatResponseSchema } from '@footnote/contracts/web/schemas';
import embedScenarioFixtureJson from './embedScenario.json';

type EmbedScenario = {
    question: string;
    response: ChatMessageActionResponse;
};

const parseEmbedResponse = (value: unknown): ChatMessageActionResponse => {
    const parsedResponse = PostChatResponseSchema.safeParse(value);
    if (!parsedResponse.success) {
        throw new Error(
            'Invalid embed scenario response: ' + parsedResponse.error.message
        );
    }
    if (
        parsedResponse.data.action !== 'message' ||
        parsedResponse.data.modality !== 'text'
    ) {
        throw new Error('The embed scenario must be a text message response.');
    }

    return parsedResponse.data;
};

// The response metadata stays intact; the transient publication capability is not part of the public fixture.
export const embedScenario: EmbedScenario = {
    question: embedScenarioFixtureJson.question,
    response: parseEmbedResponse(embedScenarioFixtureJson.response),
};
