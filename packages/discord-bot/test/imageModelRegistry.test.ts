/**
 * @description: Verifies the Discord image command exposes the same curated model lists as the shared contracts registry.
 * @footnote-scope: test
 * @footnote-module: ImageModelRegistryTests
 * @footnote-risk: low - These tests only check that shared model lists stay aligned.
 * @footnote-ethics: low - Model-choice consistency supports clear user expectations but does not execute generation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    internalImageRenderModels,
    internalImageTextModels,
} from '@footnote/contracts/providers';
import {
    imageRenderModels,
    imageTextModelChoices,
    imageTextModels,
} from '../src/commands/image/types.js';

type CommandOptionWithChoices = {
    description?: string;
    choices?: Array<{ name: string; value: string }>;
};

const restoreProcessEnv = (originalEnv: NodeJS.ProcessEnv): void => {
    for (const key of Object.keys(process.env)) {
        if (!(key in originalEnv)) {
            delete process.env[key];
        }
    }

    for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
            delete process.env[key];
            continue;
        }

        process.env[key] = value;
    }
};

test('Discord curates request-local image prompt choices without narrowing backend validation', () => {
    assert.deepEqual(imageTextModels, [
        'gpt-5.6-luna',
        'gpt-5.6-terra',
        'gpt-5.6-sol',
        'gpt-5.4-nano',
    ]);
    assert.deepEqual(
        imageTextModelChoices.map((choice) => choice.value),
        imageTextModels
    );
    assert.ok(internalImageTextModels.length > imageTextModels.length);
    assert.equal(internalImageTextModels.includes('gpt-4.1-mini'), true);
    assert.deepEqual(imageRenderModels, internalImageRenderModels);
});

test('slash command keeps model presentation separate from raw provider ids', async () => {
    const originalEnv = { ...process.env };
    process.env.DISCORD_TOKEN = 'token';
    process.env.DISCORD_CLIENT_ID = 'client-id';
    process.env.DISCORD_GUILD_IDS = 'guild-id';
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.DISCORD_USER_ID = 'user-id';
    process.env.INCIDENT_PSEUDONYMIZATION_SECRET = 'secret';

    try {
        const moduleUrl = new URL('../src/commands/image.ts', import.meta.url);
        // Add a cache-busting query so each test import re-evaluates the module
        // with the current env-backed config instead of reusing stale values.
        moduleUrl.searchParams.set('test', String(Date.now()));
        const { default: imageCommand } = (await import(
            moduleUrl.href
        )) as typeof import('../src/commands/image.js');
        const commandJson = imageCommand.data.toJSON();
        const imageModelOption = commandJson.options?.find(
            (option) => option.name === 'image_model'
        ) as CommandOptionWithChoices | undefined;
        const textModelOption = commandJson.options?.find(
            (option) => option.name === 'image_prompt_model'
        ) as CommandOptionWithChoices | undefined;

        assert.deepEqual(
            imageModelOption?.choices?.map((choice) => choice.value),
            [...internalImageRenderModels]
        );
        assert.deepEqual(
            textModelOption?.choices?.map((choice) => choice.value),
            [...imageTextModels]
        );
        assert.deepEqual(
            textModelOption?.choices?.map((choice) => choice.name),
            imageTextModelChoices.map((choice) => choice.name)
        );
        assert.equal(
            textModelOption?.description,
            'Image prompt model for this request only; does not change Workflow or response models.'
        );
        assert.equal(
            imageModelOption?.choices?.find(
                (choice) => choice.value === 'gpt-image-1-mini'
            )?.name,
            'GPT Image 1 Mini (deprecated)'
        );
        assert.equal(
            imageModelOption?.choices?.find(
                (choice) => choice.value === 'gpt-image-2'
            )?.name,
            'GPT Image 2'
        );
        assert.ok((imageModelOption?.choices?.length ?? 0) <= 25);
        assert.ok((textModelOption?.choices?.length ?? 0) <= 25);
    } finally {
        restoreProcessEnv(originalEnv);
    }
});
