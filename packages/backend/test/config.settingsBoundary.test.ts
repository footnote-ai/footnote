/**
 * @description: Verifies canonical footnote.yaml source-boundary behavior for backend runtime config.
 * @footnote-scope: test
 * @footnote-module: BackendSettingsBoundaryTest
 * @footnote-risk: medium - Missing tests can allow config-source regressions across runtime boundaries.
 * @footnote-ethics: medium - Boundary regressions can blur secret and operator-control semantics.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderSettingsTemplateYaml } from '@footnote/config-spec';
import { buildRuntimeConfig } from '../src/config/buildRuntimeConfig.js';
import { settingsSpecEntries } from '../src/config/settings-spec.js';
import { parseServerSettingsYaml } from '../src/config/settings.js';

const withSettingsFile = (contents: string): string => {
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-settings-boundary-')
    );
    const settingsPath = path.join(tempDir, 'footnote.yaml');
    fs.writeFileSync(settingsPath, contents, 'utf8');
    return settingsPath;
};

test('missing footnote.yaml warns and continues with defaults', () => {
    const warnings: string[] = [];
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-settings-boundary-')
    );
    const missingPath = path.join(tempDir, 'footnote.yaml');

    const config = buildRuntimeConfig(
        {
            NODE_ENV: 'development',
            FOOTNOTE_SETTINGS_PATH: missingPath,
        },
        (message) => warnings.push(message)
    );

    assert.equal(config.rateLimits.web.ip.limit, 3);
    assert.match(
        warnings.join('\n'),
        /Server settings YAML not found at .*footnote\.yaml/i
    );
});

test('settings_yaml env keys in process.env are ignored with warning', () => {
    const warnings: string[] = [];
    const settingsPath = withSettingsFile(
        ['version: 1', 'rate-limits:', '  web-api-rate-limit-ip: 41', ''].join(
            '\n'
        )
    );

    const config = buildRuntimeConfig(
        {
            NODE_ENV: 'test',
            FOOTNOTE_SETTINGS_PATH: settingsPath,
            WEB_API_RATE_LIMIT_IP: '999',
        },
        (message) => warnings.push(message)
    );

    assert.equal(config.rateLimits.web.ip.limit, 41);
    assert.equal(
        warnings.some((message) => /WEB_API_RATE_LIMIT_IP/i.test(message)),
        false
    );
});

test('integer settings reject non-integer numbers', () => {
    const settingsPath = withSettingsFile(
        ['version: 1', 'rate-limits:', '  web-api-rate-limit-ip: 3.5', ''].join(
            '\n'
        )
    );

    assert.throws(() => {
        buildRuntimeConfig(
            {
                NODE_ENV: 'test',
                FOOTNOTE_SETTINGS_PATH: settingsPath,
            },
            () => undefined
        );
    }, /rate-limits\.web-api-rate-limit-ip must be an integer/i);
});

test('secret env key in footnote.yaml fails validation', () => {
    const settingsPath = withSettingsFile(
        [
            'version: 1',
            'trace:',
            '  trace-api-token: should-not-be-here',
            '',
        ].join('\n')
    );

    assert.throws(() => {
        buildRuntimeConfig(
            {
                NODE_ENV: 'test',
                FOOTNOTE_SETTINGS_PATH: settingsPath,
            },
            () => undefined
        );
    }, /maps to secret env key TRACE_API_TOKEN/i);
});

test('bootstrap env key in footnote.yaml fails validation', () => {
    const settingsPath = withSettingsFile(
        ['version: 1', 'runtime:', '  fly-app-name: footnote-server', ''].join(
            '\n'
        )
    );

    assert.throws(() => {
        buildRuntimeConfig(
            {
                NODE_ENV: 'test',
                FOOTNOTE_SETTINGS_PATH: settingsPath,
            },
            () => undefined
        );
    }, /maps to bootstrap env key FLY_APP_NAME/i);
});

test('rejects removed settings.localNodes.configPath shape', () => {
    const settingsPath = withSettingsFile(
        [
            'version: 1',
            'settings:',
            '  localNodes:',
            '    configPath: /data/config/local-discord-nodes.yaml',
            '',
        ].join('\n')
    );

    assert.throws(() => {
        buildRuntimeConfig(
            {
                NODE_ENV: 'test',
                FOOTNOTE_SETTINGS_PATH: settingsPath,
            },
            () => undefined
        );
    }, /settings\.localNodes\.configPath is removed/i);
});

test('canonical discord-bots definitions load from footnote.yaml', () => {
    const settingsPath = withSettingsFile(
        [
            'version: 1',
            'discord-bots:',
            '  - id: main-discord',
            '    enabled: true',
            '    required: false',
            '    credentials:',
            '      discord-token-env: DISCORD_TOKEN',
            '      discord-client-id-env: DISCORD_CLIENT_ID',
            '      discord-guild-ids-env: DISCORD_GUILD_IDS',
            '      discord-user-id-env: DISCORD_USER_ID',
            '      incident-secret-env: INCIDENT_PSEUDONYMIZATION_SECRET',
            '    profile:',
            '      id: main',
            '      display-name: Main',
            '      persona-expression-strength: strong',
            '',
        ].join('\n')
    );

    const config = buildRuntimeConfig(
        {
            NODE_ENV: 'test',
            FOOTNOTE_SETTINGS_PATH: settingsPath,
        },
        () => undefined
    );

    assert.equal(config.settings.discordBots?.length, 1);
    assert.equal(config.settings.discordBots?.[0]?.id, 'main-discord');
    assert.equal(
        config.settings.discordBots?.[0]?.credentials?.discordGuildIdsEnv,
        'DISCORD_GUILD_IDS'
    );
    assert.equal(
        config.settings.discordBots?.[0]?.profile?.personaExpressionStrength,
        'strong'
    );
});

test('discord-bots entries allow omitted credentials/profile blocks', () => {
    const rawYaml = [
        'version: 1',
        'discord-bots:',
        '  - id: bot-with-minimal-shape',
        '    enabled: true',
        '',
    ].join('\n');
    const settingsPath = withSettingsFile(rawYaml);

    const parsed = parseServerSettingsYaml({
        rawText: rawYaml,
        settingsPath,
    });

    assert.equal(parsed.yamlSettings['discord-bots'].length, 1);
    assert.equal(
        parsed.yamlSettings['discord-bots'][0]?.id,
        'bot-with-minimal-shape'
    );
    assert.equal(
        parsed.yamlSettings['discord-bots'][0]?.credentials?.discordTokenEnv,
        undefined
    );
    assert.equal(
        parsed.yamlSettings['discord-bots'][0]?.profile?.id,
        undefined
    );
});

test('parseServerSettingsYaml accepts deployment metadata without runtime env projection', () => {
    const rawYaml = [
        'version: 1',
        'deployment:',
        '  target: fly',
        '  fly-app: footnote',
        '',
    ].join('\n');
    const settingsPath = withSettingsFile(rawYaml);
    const parsed = parseServerSettingsYaml({
        rawText: rawYaml,
        settingsPath,
    });

    assert.deepEqual(parsed.yamlSettings.deployment, {
        target: 'fly',
        flyApp: 'footnote',
    });
    assert.equal(parsed.yamlEnv.FLY_APP_NAME, undefined);
});

test('parseServerSettingsYaml rejects invalid deployment target', () => {
    const rawYaml = ['version: 1', 'deployment:', '  target: docker', ''].join(
        '\n'
    );

    assert.throws(
        () =>
            parseServerSettingsYaml({
                rawText: rawYaml,
                settingsPath: withSettingsFile(rawYaml),
            }),
        /deployment\.target must be "local" or "fly"/i
    );
});

test('parseServerSettingsYaml rejects unsupported deployment keys', () => {
    const rawYaml = [
        'version: 1',
        'deployment:',
        '  target: fly',
        '  region: ord',
        '',
    ].join('\n');

    assert.throws(
        () =>
            parseServerSettingsYaml({
                rawText: rawYaml,
                settingsPath: withSettingsFile(rawYaml),
            }),
        /deployment contains unsupported key "region"/i
    );
});

test('invalid present YAML fails startup', () => {
    const settingsPath = withSettingsFile('version: [1\n');

    assert.throws(() => {
        buildRuntimeConfig(
            {
                NODE_ENV: 'test',
                FOOTNOTE_SETTINGS_PATH: settingsPath,
            },
            () => undefined
        );
    }, /YAMLException|unexpected end/i);
});

test('parseServerSettingsYaml helper stays aligned with startup settings parsing behavior', () => {
    const rawYaml = [
        'version: 1',
        'rate-limits:',
        '  web-api-rate-limit-ip: 41',
        '',
    ].join('\n');
    const settingsPath = withSettingsFile(rawYaml);
    const parsed = parseServerSettingsYaml({
        rawText: rawYaml,
        settingsPath,
    });

    const config = buildRuntimeConfig(
        {
            NODE_ENV: 'test',
            FOOTNOTE_SETTINGS_PATH: settingsPath,
        },
        () => undefined
    );

    assert.equal(parsed.yamlSettings.version, 1);
    assert.equal(
        parsed.yamlSettings.settingsEnv['rate-limits.web-api-rate-limit-ip'],
        41
    );
    assert.equal(parsed.yamlEnv.WEB_API_RATE_LIMIT_IP, '41');
    assert.equal(config.rateLimits.web.ip.limit, 41);
});

test('parseServerSettingsYaml allows dot-separated model ids in image-model-multipliers', () => {
    const rawYaml = [
        'version: 1',
        'image:',
        '  image-model-multipliers:',
        '    gpt-image-1: 2',
        '    gpt-image-1-mini: 1',
        '    gpt-image-1.5: 2',
        '',
    ].join('\n');
    const settingsPath = withSettingsFile(rawYaml);
    const parsed = parseServerSettingsYaml({
        rawText: rawYaml,
        settingsPath,
    });

    const multipliersValue =
        parsed.yamlSettings.settingsEnv['image.image-model-multipliers'];
    assert.equal(typeof multipliersValue, 'string');
    if (typeof multipliersValue !== 'string') {
        assert.fail(
            'image.image-model-multipliers should serialize as JSON string'
        );
    }
    assert.deepEqual(JSON.parse(multipliersValue), {
        'gpt-image-1': 2,
        'gpt-image-1-mini': 1,
        'gpt-image-1.5': 2,
    });
    assert.deepEqual(
        JSON.parse(parsed.yamlEnv.IMAGE_MODEL_MULTIPLIERS ?? '{}'),
        {
            'gpt-image-1': 2,
            'gpt-image-1-mini': 1,
            'gpt-image-1.5': 2,
        }
    );
});

test('rendered canonical template parses through backend settings validator', () => {
    const rawYaml = renderSettingsTemplateYaml({
        target: 'local',
        env: {},
        lineEnding: '\n',
    });
    const settingsPath = withSettingsFile(rawYaml);
    const parsed = parseServerSettingsYaml({
        rawText: rawYaml,
        settingsPath,
    });

    assert.equal(parsed.yamlSettings.version, 1);
    assert.equal(parsed.yamlSettings['discord-bots'].length, 0);
    assert.equal(
        Object.keys(parsed.yamlSettings.settingsEnv).length,
        settingsSpecEntries.length
    );
});
