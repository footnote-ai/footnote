/**
 * @description: Covers backend-owned participation arbitration from shared Discord addressing facts.
 * @footnote-scope: test
 * @footnote-module: ChatParticipationPolicyTests
 * @footnote-risk: high - Missing cases can reintroduce process-local participation decisions.
 * @footnote-ethics: high - These tests protect which persona is allowed to answer a user.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { ChatAddressingEvidence } from '@footnote/contracts/web';
import type { GenerationRuntime } from '@footnote/agent-runtime';
import { createChatOrchestrator } from '../src/services/chatOrchestrator.js';
import { createMetadata } from './fixtures/responseMetadataFixture.js';
import { runtimeConfig } from '../src/config.js';
import {
    resolveChatParticipation,
    resolveLocalChatParticipation,
} from '../src/services/chatParticipationPolicy.js';

const createAddressing = (
    participants: ChatAddressingEvidence['participants'],
    resolution: ChatAddressingEvidence['resolution'] = 'complete'
): ChatAddressingEvidence => ({
    participants,
    resolution,
    assistantMentioned: false,
    replyToAssistant: false,
    otherParticipantMentioned: false,
    replyToOtherParticipant: false,
});

const persona = (
    personaId: string,
    relation: 'explicit_mention' | 'reply' | 'plaintext_reference'
): ChatAddressingEvidence['participants'][number] => ({
    kind: 'persona',
    relation,
    personaId,
    displayName: personaId,
});

const external = (
    relation: 'explicit_mention' | 'reply' | 'plaintext_reference'
): ChatAddressingEvidence['participants'][number] => ({
    kind: 'external_participant',
    relation,
    displayName: 'Jordan',
});

test('selects only the explicitly mentioned persona from the live regression facts', () => {
    const decision = resolveChatParticipation(
        createAddressing([
            persona('winter', 'explicit_mention'),
            persona('myuri', 'plaintext_reference'),
            persona('danny', 'plaintext_reference'),
            persona('footnote', 'plaintext_reference'),
        ])
    );

    assert.deepEqual(decision, {
        selectedPersonaIds: ['winter'],
        excluded: [
            {
                personaId: 'myuri',
                reasonCode: 'other_participant_addressed',
            },
            {
                personaId: 'danny',
                reasonCode: 'other_participant_addressed',
            },
            {
                personaId: 'footnote',
                reasonCode: 'other_participant_addressed',
            },
        ],
    });
});

test('selects several explicit personas and excludes subject-only personas', () => {
    const decision = resolveChatParticipation(
        createAddressing([
            persona('myuri', 'explicit_mention'),
            persona('winter', 'explicit_mention'),
            persona('danny', 'plaintext_reference'),
        ])
    );

    assert.deepEqual(decision.selectedPersonaIds, ['myuri', 'winter']);
    assert.deepEqual(decision.excluded, [
        {
            personaId: 'danny',
            reasonCode: 'other_participant_addressed',
        },
    ]);
});

test('selects the persona a message replies to', () => {
    const decision = resolveChatParticipation(
        createAddressing([
            persona('winter', 'reply'),
            persona('myuri', 'plaintext_reference'),
        ])
    );

    assert.deepEqual(decision.selectedPersonaIds, ['winter']);
    assert.deepEqual(decision.excluded, [
        {
            personaId: 'myuri',
            reasonCode: 'other_participant_addressed',
        },
    ]);
});

test('does not select a persona mentioned only as the subject of an explicit question', () => {
    const decision = resolveChatParticipation(
        createAddressing([
            persona('myuri', 'explicit_mention'),
            persona('winter', 'plaintext_reference'),
        ])
    );

    assert.deepEqual(decision.selectedPersonaIds, ['myuri']);
    assert.deepEqual(decision.excluded, [
        {
            personaId: 'winter',
            reasonCode: 'other_participant_addressed',
        },
    ]);
});

test('excludes plaintext persona references when an external participant is explicit', () => {
    const decision = resolveChatParticipation(
        createAddressing([
            external('explicit_mention'),
            persona('winter', 'plaintext_reference'),
        ])
    );

    assert.deepEqual(decision, {
        selectedPersonaIds: [],
        excluded: [
            {
                personaId: 'winter',
                reasonCode: 'other_participant_addressed',
            },
        ],
    });
});

test('preserves spontaneous alias candidates when nobody is explicitly addressed', () => {
    const decision = resolveChatParticipation(
        createAddressing([persona('winter', 'plaintext_reference')])
    );

    assert.deepEqual(decision, {
        selectedPersonaIds: ['winter'],
        excluded: [],
    });
});

test('allows safely resolved explicit personas but not aliases during degraded addressing', () => {
    const decision = resolveChatParticipation(
        createAddressing(
            [
                persona('winter', 'explicit_mention'),
                persona('myuri', 'plaintext_reference'),
            ],
            'degraded'
        )
    );

    assert.deepEqual(decision, {
        selectedPersonaIds: ['winter'],
        excluded: [
            {
                personaId: 'myuri',
                reasonCode: 'degraded_explicit_only',
            },
        ],
    });
});

test('produces identical canonical sets for every local process', () => {
    const decision = resolveChatParticipation(
        createAddressing([
            persona('winter', 'explicit_mention'),
            persona('myuri', 'plaintext_reference'),
            persona('danny', 'plaintext_reference'),
            persona('footnote', 'plaintext_reference'),
        ])
    );

    const localResults = ['winter', 'myuri', 'danny', 'footnote'].map(
        (personaId) => ({
            personaId,
            ...resolveLocalChatParticipation({ decision, personaId }),
        })
    );

    assert.deepEqual(decision.selectedPersonaIds, ['winter']);
    assert.deepEqual(
        localResults.map((result) => result.selected),
        [true, false, false, false]
    );
});

test('does not use process-local compatibility booleans as policy authority', () => {
    const decision = resolveChatParticipation({
        ...createAddressing([
            persona('winter', 'explicit_mention'),
            persona('myuri', 'plaintext_reference'),
        ]),
        assistantMentioned: true,
        replyToAssistant: true,
        otherParticipantMentioned: false,
        replyToOtherParticipant: false,
    });

    assert.deepEqual(decision.selectedPersonaIds, ['winter']);
    assert.deepEqual(decision.excluded, [
        {
            personaId: 'myuri',
            reasonCode: 'other_participant_addressed',
        },
    ]);
});

test('does not invoke the planner or generation for an excluded persona', async () => {
    let generationCalls = 0;
    const generationRuntime: GenerationRuntime = {
        kind: 'test-runtime',
        generate: async () => {
            generationCalls += 1;
            throw new Error('excluded persona should not reach the runtime');
        },
    };
    const orchestrator = createChatOrchestrator({
        generationRuntime,
        storeTrace: async () => undefined,
        buildResponseMetadata: () => createMetadata(),
        defaultModel: runtimeConfig.modelProfiles.defaultProfileId,
        recordUsage: () => undefined,
    });

    const response = await orchestrator.runChat({
        surface: 'discord',
        botPersonaId: 'myuri',
        trigger: {
            kind: 'alias_candidate',
            addressing: createAddressing([
                persona('winter', 'explicit_mention'),
                persona('myuri', 'plaintext_reference'),
            ]),
        },
        latestUserInput: '@Winter What do you think about Myuri?',
        conversation: [
            {
                role: 'user',
                content: '@Winter What do you think about Myuri?',
            },
        ],
    });

    assert.deepEqual(response, {
        action: 'ignore',
        metadata: null,
    });
    assert.equal(generationCalls, 0);
});
