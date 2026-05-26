/**
 * @description: Verifies canonical settings template rendering, key coverage, target defaults, and parser compatibility.
 * @footnote-scope: test
 * @footnote-module: SettingsTemplateTests
 * @footnote-risk: medium - Missing tests can allow template drift that breaks setup/bootstrap flows.
 * @footnote-ethics: medium - Template correctness supports transparent operator control over runtime behavior.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    envPathSourceEntries,
    renderSettingsTemplateYaml,
    resolveTemplateTarget,
    settingsSpecEntries,
} from '../src/index.js';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml') as { load: (input: string) => unknown };

const parseYamlObject = (raw: string): Record<string, unknown> => {
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(
            'Expected rendered template YAML root to be an object.'
        );
    }
    return parsed as Record<string, unknown>;
};

const getNestedValue = (
    root: Record<string, unknown>,
    path: readonly string[]
): unknown => {
    let cursor: unknown = root;
    for (const segment of path) {
        if (
            !cursor ||
            typeof cursor !== 'object' ||
            Array.isArray(cursor) ||
            !(segment in cursor)
        ) {
            return undefined;
        }
        cursor = (cursor as Record<string, unknown>)[segment];
    }
    return cursor;
};

const escapeForRegex = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('resolveTemplateTarget returns fly only when FLY_APP_NAME is non-empty', () => {
    assert.equal(resolveTemplateTarget({}), 'local');
    assert.equal(resolveTemplateTarget({ FLY_APP_NAME: '' }), 'local');
    assert.equal(resolveTemplateTarget({ FLY_APP_NAME: '   ' }), 'local');
    assert.equal(resolveTemplateTarget({ FLY_APP_NAME: 'footnote' }), 'fly');
});

test('template includes all settings_yaml keys', () => {
    const rendered = renderSettingsTemplateYaml({
        target: 'local',
        env: {},
    });
    const parsed = parseYamlObject(rendered);

    for (const entry of settingsSpecEntries) {
        assert.equal(
            getNestedValue(parsed, entry.path) !== undefined,
            true,
            `Expected key path ${entry.path.join('.')} in rendered template.`
        );
    }
});

test('template excludes secret_env and bootstrap_env paths', () => {
    const rendered = renderSettingsTemplateYaml({
        target: 'local',
        env: {},
    });
    const parsed = parseYamlObject(rendered);

    for (const entry of envPathSourceEntries) {
        if (entry.source === 'settings_yaml') {
            continue;
        }
        assert.equal(
            getNestedValue(parsed, entry.path) !== undefined,
            false,
            `Did not expect ${entry.path.join('.')} in template.`
        );
    }
});

test('local target renders local concrete defaults for derived keys', () => {
    const rendered = renderSettingsTemplateYaml({
        target: 'local',
        env: {},
    });
    const parsed = parseYamlObject(rendered);

    const urls = parsed.urls as Record<string, unknown>;
    assert.equal(urls['backend-base-url'], 'http://localhost:3000');
    assert.equal(urls['web-base-url'], 'http://localhost:8080');
});

test('fly target renders fly concrete defaults for derived keys', () => {
    const rendered = renderSettingsTemplateYaml({
        target: 'fly',
        env: {
            FLY_APP_NAME: 'footnote-app',
        },
    });
    const parsed = parseYamlObject(rendered);

    const urls = parsed.urls as Record<string, unknown>;
    assert.equal(
        urls['backend-base-url'],
        'http://footnote-backend.internal:3000'
    );
    assert.equal(urls['web-base-url'], 'https://footnote-app.fly.dev');
});

test('template preserves literal JSON defaults for settings_yaml keys', () => {
    const rendered = renderSettingsTemplateYaml({
        target: 'local',
        env: {},
    });
    const parsed = parseYamlObject(rendered);

    const image = parsed.image as Record<string, unknown>;
    assert.deepEqual(image['image-model-multipliers'], {
        'gpt-image-1-mini': 1,
        'gpt-image-1': 2,
        'gpt-image-1.5': 2,
    });
});

test('every settings key has a one-line comment directly above it', () => {
    const rendered = renderSettingsTemplateYaml({
        target: 'local',
        env: {},
    });
    const lines = rendered.split('\n');

    for (const entry of settingsSpecEntries) {
        const key = entry.path[entry.path.length - 1] ?? '';
        const indent = ' '.repeat(Math.max(0, (entry.path.length - 1) * 4));
        const keyPrefix = `${indent}${key}:`;
        const keyLinePattern = new RegExp(
            `^${escapeForRegex(indent)}${escapeForRegex(key)}:(?:\\s|$)`
        );
        const keyLineIndex = lines.findIndex(
            (line) =>
                line.startsWith(keyPrefix) &&
                line.length >= indent.length &&
                line.slice(0, indent.length) === indent &&
                keyLinePattern.test(line)
        );
        if (keyLineIndex <= 0) {
            assert.fail(`Expected key line for path ${entry.path.join('.')}.`);
            continue;
        }

        const previous = lines[keyLineIndex - 1]?.trim() ?? '';

        assert.equal(
            previous.startsWith('# '),
            true,
            `Expected comment before key line: ${entry.path.join('.')}`
        );
    }
});

test('top-level section order follows operator flow roots first', () => {
    const rendered = renderSettingsTemplateYaml({
        target: 'local',
        env: {},
    });
    const parsed = parseYamlObject(rendered);
    const topLevelKeys = Object.keys(parsed);

    const expectedPrefix = ['version', 'server', 'web', 'urls', 'openai'];
    assert.deepEqual(
        topLevelKeys.slice(0, expectedPrefix.length),
        expectedPrefix
    );

    assert.equal(topLevelKeys[topLevelKeys.length - 1], 'discord-bots');
});
