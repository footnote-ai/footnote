/**
 * @description: Verifies shared TTS and Realtime speech-selection precedence and metadata.
 * @footnote-scope: test
 * @footnote-module: SpeechPresentationTests
 * @footnote-risk: medium - Precedence drift can select the wrong speech implementation.
 * @footnote-ethics: medium - Selection metadata must distinguish explicit and operator choices.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    resolveSpeechSelection,
    selectVoiceProgressPhrase,
} from '../src/services/speechPresentation.js';

const profile = {
    id: 'winter',
    displayName: 'Winter',
    mentionAliases: [],
    promptOverlay: {
        source: 'none' as const,
        text: null,
        path: null,
        length: 0,
    },
    speechPresentation: {
        ttsModel: 'gpt-4o-mini-tts',
        ttsVoice: 'echo',
        ttsDelivery: 'dry and understated',
    },
};

test('explicit TTS selection wins and records per-setting sources', () => {
    assert.deepEqual(
        resolveSpeechSelection({
            profile,
            provider: 'openai',
            modality: 'tts',
            request: { voice: 'alloy' },
            fallback: { model: 'fallback-model', voice: 'fallback-voice' },
        }),
        {
            profileId: 'winter',
            modality: 'tts',
            provider: 'openai',
            model: 'gpt-4o-mini-tts',
            voice: 'alloy',
            delivery: 'dry and understated',
            requestedVoice: 'alloy',
            selectionSource: {
                model: 'operator_profile',
                voice: 'request_or_session',
                delivery: 'operator_profile',
            },
            fallbackReason: null,
        }
    );
});

test('deployment fallback is retained when no profile override exists', () => {
    const selection = resolveSpeechSelection({
        profile: { ...profile, speechPresentation: {} },
        provider: 'openai',
        modality: 'realtime',
        fallback: { model: 'gpt-realtime-mini', voice: 'echo' },
    });

    assert.equal(selection.model, 'gpt-realtime-mini');
    assert.equal(selection.selectionSource.model, 'deployment_fallback');
    assert.equal(selection.delivery, null);
});

test('bundled persona voice defaults retain their selection source', () => {
    const selection = resolveSpeechSelection({
        profile: { ...profile, speechPresentation: {} },
        provider: 'openrouter',
        modality: 'tts',
        fallback: {
            model: 'microsoft/mai-voice-2.1-flash',
            voice: 'en-US-Harper:MAI-Voice-2.1-Flash',
            voiceSource: 'bundled_persona_default',
        },
    });

    assert.equal(selection.selectionSource.model, 'deployment_fallback');
    assert.equal(selection.selectionSource.voice, 'bundled_persona_default');
});

test('voice progress phrase selection follows the pinned persona and expression strength', () => {
    const selections = [
        {
            profileId: 'footnote',
            expressionStrength: 'subtle' as const,
            expected: 'I’ll take a moment with that.',
        },
        {
            profileId: 'danny',
            expressionStrength: 'balanced' as const,
            expected: 'I’ll take a moment and work through this.',
        },
        {
            profileId: 'myuri',
            expressionStrength: 'strong' as const,
            expected: 'A few threads to sort out—give me a moment.',
        },
        {
            profileId: 'winter',
            expressionStrength: 'strong' as const,
            expected: 'I’ll think that through carefully.',
        },
    ];

    for (const selection of selections) {
        assert.equal(
            selectVoiceProgressPhrase({
                ...selection,
                randomInt: () => 0,
            }),
            selection.expected
        );
    }

    assert.notEqual(
        selectVoiceProgressPhrase({
            profileId: 'myuri',
            expressionStrength: 'subtle',
            randomInt: () => 0,
        }),
        selectVoiceProgressPhrase({
            profileId: 'myuri',
            expressionStrength: 'strong',
            randomInt: () => 0,
        })
    );
});

test('custom profile names cannot resolve inherited phrase pools', () => {
    const phrase = selectVoiceProgressPhrase({
        profileId: 'constructor',
        expressionStrength: 'balanced',
        randomInt(max) {
            assert.equal(max, 2);
            return 0;
        },
    });

    assert.equal(phrase, 'One moment while I work through that.');
});

test('voice progress phrase overrides, including custom profiles, remain application-selected', () => {
    let requestedPoolSize = 0;
    const phrase = selectVoiceProgressPhrase({
        profileId: 'custom-profile',
        expressionStrength: 'balanced',
        operatorPhrases: [
            'Please give me a moment.',
            'I’m working through that now.',
        ],
        randomInt(max) {
            requestedPoolSize = max;
            return max - 1;
        },
    });

    assert.equal(phrase, 'I’m working through that now.');
    assert.equal(requestedPoolSize, 2);
});
