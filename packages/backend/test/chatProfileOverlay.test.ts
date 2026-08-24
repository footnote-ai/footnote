/**
 * @description: Verifies built-in persona catalog resolution and overlay loading behavior.
 * @footnote-scope: test
 * @footnote-module: ChatProfileOverlayTests
 * @footnote-risk: medium - Missing coverage could route a Discord persona to the wrong overlay or fallback.
 * @footnote-ethics: high - Persona identity and presentation guidance affect user disclosure and expectations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveChatPersonaProfile,
    resolvePersonaExpression,
    resolvePersonaPresentationGuidance,
} from '../src/services/chatProfileOverlay.js';

const logger = {
    warn: () => undefined,
};

test('resolves every built-in Discord persona through the public profile seam', () => {
    const expectedProfiles = [
        {
            id: 'footnote',
            displayName: 'Footnote',
            overlaySource: 'none',
            overlayPath: null,
        },
        {
            id: 'danny',
            displayName: 'Danny',
            overlaySource: 'file',
            overlayPath: /profile-overlays[\\/]danny\.md$/,
        },
        {
            id: 'myuri',
            displayName: 'Myuri',
            overlaySource: 'file',
            overlayPath: /profile-overlays[\\/]myuri\.md$/,
        },
        {
            id: 'winter',
            displayName: 'Winter',
            overlaySource: 'file',
            overlayPath: /profile-overlays[\\/]winter\.md$/,
        },
    ] as const;

    for (const expected of expectedProfiles) {
        const profile = resolveChatPersonaProfile(
            { surface: 'discord', botPersonaId: expected.id },
            logger
        );

        assert.equal(profile.id, expected.id);
        assert.equal(profile.displayName, expected.displayName);
        assert.equal(profile.promptOverlay.source, expected.overlaySource);
        if (expected.overlayPath) {
            assert.match(
                profile.promptOverlay.path ?? '',
                expected.overlayPath
            );
            assert.ok(profile.promptOverlay.text);
        } else {
            assert.equal(profile.promptOverlay.path, expected.overlayPath);
            assert.equal(profile.promptOverlay.text, null);
        }
    }
});

test('resolves Winter as a first-class Discord persona with its authored overlay', () => {
    const profile = resolveChatPersonaProfile(
        { surface: 'discord', botPersonaId: ' WINTER ' },
        logger
    );

    assert.equal(profile.id, 'winter');
    assert.equal(profile.displayName, 'Winter');
    assert.equal(profile.promptOverlay.source, 'file');
    assert.match(
        profile.promptOverlay.path ?? '',
        /profile-overlays[\\/]winter\.md$/
    );
    assert.match(profile.promptOverlay.text ?? '', /You are Winter: sharp/);
    assert.match(
        profile.promptOverlay.text ?? '',
        /Winter is permissive, not credulous/
    );
    assert.equal(
        resolvePersonaPresentationGuidance('winter'),
        'Use direct, sharp, personable prose with dry wit and minimal ceremony. Avoid unsolicited moral framing, generic reassurance, and performative caution. Let disagreement or constraint show plainly when it is actually relevant.'
    );
});

test('keeps existing built-in and unknown persona fallback behavior', () => {
    for (const personaId of ['footnote', 'danny', 'myuri']) {
        const profile = resolveChatPersonaProfile(
            { surface: 'discord', botPersonaId: personaId },
            logger
        );
        assert.equal(profile.id, personaId);
    }

    const unknownProfile = resolveChatPersonaProfile(
        { surface: 'discord', botPersonaId: 'not-a-persona' },
        logger
    );
    assert.equal(unknownProfile.id, 'footnote');
    assert.equal(unknownProfile.promptOverlay.source, 'none');

    const webProfile = resolveChatPersonaProfile(
        { surface: 'web', botPersonaId: 'winter' },
        logger
    );
    assert.equal(webProfile.id, 'footnote');
});

test('resolves persona expression by request, profile, then persona default', () => {
    const winter = resolveChatPersonaProfile(
        { surface: 'discord', botPersonaId: 'winter' },
        logger
    );
    const requestResolution = resolvePersonaExpression(
        { personaExpressionStrength: 'subtle' },
        winter,
        'strong'
    );
    assert.equal(requestResolution.strength, 'subtle');
    assert.equal(requestResolution.source, 'request');
    assert.match(
        requestResolution.guidance,
        /Persona expression strength: subtle/u
    );
    assert.equal(
        resolvePersonaExpression({}, winter, 'balanced').source,
        'profile'
    );
    assert.equal(
        resolvePersonaExpression({}, winter, 'invalid').strength,
        'strong'
    );
    assert.equal(
        resolvePersonaExpression({}, winter, undefined).source,
        'persona_default'
    );
    for (const personaId of ['footnote', 'danny', 'myuri']) {
        const profile = resolveChatPersonaProfile(
            { surface: 'discord', botPersonaId: personaId },
            logger
        );
        assert.equal(
            resolvePersonaExpression({}, profile, undefined).strength,
            'balanced'
        );
    }
});
