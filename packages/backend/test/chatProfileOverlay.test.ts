/**
 * @description: Verifies built-in persona catalog resolution and overlay loading behavior.
 * @footnote-scope: test
 * @footnote-module: ChatProfileOverlayTests
 * @footnote-risk: medium - Missing coverage could route a Discord persona to the wrong overlay or fallback.
 * @footnote-ethics: high - Persona identity and presentation guidance affect user disclosure and expectations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimeConfig } from '../src/config.js';
import { parseBotProfileConfig } from '../src/config/profile.js';
import {
    resolveChatPersonaProfile,
    resolvePersonaExpression,
    resolvePersonaPresentationGuidance,
    resolveVoicePersona,
} from '../src/services/chatProfileOverlay.js';

const logger = {
    warn: () => undefined,
};

test('a different Discord identity uses its own file instead of the backend inline overlay', () => {
    const previousBots = runtimeConfig.settings.discordBots;
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'persona-overlay-precedence-')
    );
    const overlayPath = path.join(root, 'danny.md');
    fs.writeFileSync(overlayPath, 'DANNY_OPERATOR_OVERLAY');
    runtimeConfig.settings.discordBots = [
        {
            id: 'danny-bot',
            profile: { id: 'danny', displayName: 'Danny', overlayPath },
        },
    ];
    const identity = { discordNodeId: 'danny-bot', botPersonaId: 'danny' };
    try {
        for (const maxOverlayLength of [8000, 2]) {
            const backend = parseBotProfileConfig({
                profileId: 'footnote',
                inlineOverlayText: 'FOOTNOTE_BACKEND_OVERLAY',
                maxOverlayLength,
            });
            const resolved = resolveVoicePersona(backend, logger, identity);
            assert.equal(
                resolved.profile.promptOverlay.text,
                'DANNY_OPERATOR_OVERLAY'
            );
            assert.equal(resolved.profile.promptOverlay.source, 'file');
            assert.equal(resolved.overlaySelection, 'configured');
        }
        const matchingBackend = parseBotProfileConfig({
            profileId: 'danny',
            inlineOverlayText: 'DANNY_INLINE_OVERRIDE',
        });
        assert.equal(
            resolveVoicePersona(matchingBackend, logger, identity).profile
                .promptOverlay.text,
            'DANNY_INLINE_OVERRIDE'
        );
    } finally {
        runtimeConfig.settings.discordBots = previousBots;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Voice admission pins bundled identity and expression defaults without acoustic settings', () => {
    for (const [id, displayName, strength, overlaySelection] of [
        ['footnote', 'Footnote', 'balanced', 'default'],
        ['danny', 'Danny', 'balanced', 'catalog'],
        ['myuri', 'Myuri', 'balanced', 'catalog'],
        ['winter', 'Winter', 'strong', 'catalog'],
    ] as const) {
        const configured = parseBotProfileConfig({
            profileId: id,
            profileDisplayName: displayName,
            speechPresentation: { ttsVoice: 'alloy' },
        });
        const resolved = resolveVoicePersona(configured, logger);
        assert.equal(resolved.profile.id, id);
        assert.equal(resolved.profile.displayName, displayName);
        assert.equal(resolved.expression.strength, strength);
        assert.equal(resolved.expression.source, 'persona_default');
        assert.equal(resolved.overlaySelection, overlaySelection);
        assert.equal(resolved.profile.speechPresentation, undefined);
        if (id !== 'footnote') assert.ok(resolved.profile.promptOverlay.text);
        configured.displayName = 'Changed after admission';
        assert.equal(resolved.profile.displayName, displayName);
        assert.ok(Object.isFrozen(resolved.profile.promptOverlay));
        assert.ok(Object.isFrozen(resolved.profile.mentionAliases));
        assert.ok(Object.isFrozen(resolved.expression));
    }
});

test('Voice selects the invoking Discord node from existing server configuration', () => {
    const previous = runtimeConfig.settings.discordBots;
    runtimeConfig.settings.discordBots = [
        {
            id: 'danny-bot',
            profile: {
                id: 'danny',
                displayName: 'Danny bot',
                personaExpressionStrength: 'subtle',
            },
        },
        {
            id: 'winter-bot',
            profile: { id: 'winter', displayName: 'Winter bot' },
        },
    ];
    try {
        const backend = parseBotProfileConfig({ profileId: 'footnote' });
        const danny = resolveVoicePersona(backend, logger, {
            discordNodeId: 'danny-bot',
            botPersonaId: 'danny',
        });
        const winter = resolveVoicePersona(backend, logger, {
            discordNodeId: 'winter-bot',
            botPersonaId: 'winter',
        });
        assert.equal(danny.profile.id, 'danny');
        assert.equal(danny.profile.displayName, 'Danny bot');
        assert.equal(danny.expression.strength, 'subtle');
        assert.equal(winter.profile.id, 'winter');
        assert.equal(winter.expression.strength, 'strong');
        assert.equal(
            resolveVoicePersona(backend, logger, {
                discordNodeId: 'winter-bot',
                botPersonaId: 'winter',
                personaExpressionProfileStrength: 'balanced',
            }).expression.strength,
            'balanced'
        );
        const chatProfile = resolveChatPersonaProfile(
            { surface: 'discord', botPersonaId: 'danny' },
            logger
        );
        assert.equal(chatProfile.displayName, 'Danny bot');
        assert.equal(
            resolvePersonaExpression({}, chatProfile).strength,
            'subtle'
        );
        assert.throws(
            () =>
                resolveVoicePersona(backend, logger, {
                    discordNodeId: 'unknown',
                    botPersonaId: 'winter',
                }),
            /Configured Voice persona/
        );
        assert.throws(
            () =>
                resolveVoicePersona(backend, logger, {
                    discordNodeId: 'danny-bot',
                    botPersonaId: 'winter',
                }),
            /Configured Voice persona/
        );
        assert.throws(
            () =>
                resolveVoicePersona(backend, logger, {
                    botPersonaId: 'unregistered-custom',
                }),
            /Configured Voice persona/
        );
    } finally {
        runtimeConfig.settings.discordBots = previous;
    }
});

test('matching Discord identity preserves the operator profile and overlay', () => {
    const previous = { ...runtimeConfig.profile };
    try {
        Object.assign(runtimeConfig.profile, {
            id: 'operator',
            displayName: 'Operator identity',
            mentionAliases: ['operator-bot'],
            promptOverlay: {
                source: 'inline',
                text: 'PRIVATE_OPERATOR_OVERLAY',
                path: null,
                length: 24,
            },
        });
        const profile = resolveChatPersonaProfile(
            { surface: 'discord', botPersonaId: 'operator' },
            logger
        );
        assert.equal(profile.id, 'operator');
        assert.equal(profile.displayName, 'Operator identity');
        assert.equal(profile.promptOverlay.text, 'PRIVATE_OPERATOR_OVERLAY');
        assert.deepEqual(profile.mentionAliases, ['operator-bot']);
    } finally {
        Object.assign(runtimeConfig.profile, previous);
    }
});

test('duplicate configured persona IDs preserve ordinary chat fallback while Voice requires a node identity', () => {
    const previous = runtimeConfig.settings.discordBots;
    runtimeConfig.settings.discordBots = [
        { id: 'one', profile: { id: 'danny', displayName: 'First Danny' } },
        { id: 'two', profile: { id: 'danny', displayName: 'Second Danny' } },
    ];
    try {
        assert.equal(
            resolveChatPersonaProfile(
                { surface: 'discord', botPersonaId: 'danny' },
                logger
            ).displayName,
            'Danny'
        );
        const backend = parseBotProfileConfig({ profileId: 'footnote' });
        assert.throws(
            () =>
                resolveVoicePersona(backend, logger, { botPersonaId: 'danny' }),
            /Configured Voice persona identity/
        );
        assert.equal(
            resolveVoicePersona(backend, logger, {
                botPersonaId: 'danny',
                discordNodeId: 'two',
            }).profile.displayName,
            'Second Danny'
        );
    } finally {
        runtimeConfig.settings.discordBots = previous;
    }
});

test('Voice preserves custom and built-in operator overlays and expression overrides', () => {
    for (const id of ['operator', 'footnote', 'danny', 'myuri', 'winter']) {
        const configured = parseBotProfileConfig({
            profileId: id,
            profileDisplayName: 'Operator name',
            inlineOverlayText: 'PRIVATE_OPERATOR_OVERLAY',
            personaExpressionStrength: 'subtle',
        });
        const resolved = resolveVoicePersona(configured, logger);
        assert.equal(resolved.profile.id, id);
        assert.equal(resolved.profile.displayName, 'Operator name');
        assert.equal(
            resolved.profile.promptOverlay.text,
            'PRIVATE_OPERATOR_OVERLAY'
        );
        assert.equal(resolved.overlaySelection, 'configured');
        assert.equal(resolved.expression.strength, 'subtle');
        assert.equal(resolved.expression.source, 'profile');
        assert.match(resolved.expression.guidance, /TRACE values/);
        configured.promptOverlay.text = 'Changed overlay';
        assert.equal(
            resolved.profile.promptOverlay.text,
            'PRIVATE_OPERATOR_OVERLAY'
        );
    }
});

test('Voice rejects unknown identity or unusable required overlays without substituting Footnote', () => {
    const previousRoot = runtimeConfig.runtime.projectRoot;
    for (const input of [
        { profileId: 'unknown' },
        { profileId: 'winter', overlayPath: 'missing-private-overlay.md' },
        {
            profileId: 'footnote',
            inlineOverlayText: 'PRIVATE_TOO_LONG',
            maxOverlayLength: 2,
        },
    ]) {
        assert.throws(
            () => resolveVoicePersona(parseBotProfileConfig(input), logger),
            /^Error: Configured Voice persona overlay is unavailable\.$/
        );
    }
    try {
        runtimeConfig.runtime.projectRoot = 'missing-catalog-root';
        assert.throws(
            () =>
                resolveVoicePersona(
                    parseBotProfileConfig({ profileId: 'winter' }),
                    logger
                ),
            /Configured Voice persona overlay is unavailable/
        );
    } finally {
        runtimeConfig.runtime.projectRoot = previousRoot;
    }
});

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
    assert.match(
        profile.promptOverlay.text ?? '',
        /The active persona is Winter, sharp/
    );
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
    const profileResolution = resolvePersonaExpression(
        { personaExpressionProfileStrength: 'strong' },
        winter,
        'balanced'
    );
    assert.equal(profileResolution.strength, 'strong');
    assert.equal(profileResolution.source, 'profile');
    const requestResolution = resolvePersonaExpression(
        {
            personaExpressionProfileStrength: 'strong',
            personaExpressionStrength: 'subtle',
        },
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
        resolvePersonaExpression({}, winter, 'invalid').source,
        'persona_default'
    );
    for (const personaId of ['footnote', 'danny', 'myuri']) {
        const profile = resolveChatPersonaProfile(
            { surface: 'discord', botPersonaId: personaId },
            logger
        );
        assert.equal(
            resolvePersonaExpression({}, profile, 'invalid').strength,
            'balanced'
        );
    }
});
