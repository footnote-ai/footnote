/**
 * @description: Checks that account commands use trusted interaction identity and private replies.
 * @footnote-scope: test
 * @footnote-module: AccountCommandTests
 * @footnote-risk: high - Adapter regressions could use an untrusted identity or expose link state.
 * @footnote-ethics: high - Account linking must remain private and explicitly confirmed.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('account command uses interaction identity and private start/status/confirm responses', async () => {
    const source = await readFile(
        path.join(
            process.cwd(),
            'packages/discord-bot/src/commands/account.ts'
        ),
        'utf8'
    );
    const definitions = await readFile(
        path.join(
            process.cwd(),
            'packages/discord-bot/src/commands/commandDefinitions.json'
        ),
        'utf8'
    );
    const catalog = await readFile(
        path.join(
            process.cwd(),
            'packages/discord-bot/src/commands/lazyCommands.ts'
        ),
        'utf8'
    );
    assert.match(source, /interaction\.user\.id/);
    assert.match(source, /interaction\.user\.username/);
    assert.match(
        source,
        /startDiscordAccountConnection\(\{\s*discordUserId:\s*interaction\.user\.id,\s*discordUsername:\s*interaction\.user\.username/s
    );
    assert.match(source, /deferReply\(\{ ephemeral: true \}\)/);
    assert.match(source, /startDiscordAccountConnection/);
    assert.match(source, /getDiscordAccountStatus/);
    assert.match(source, /confirmDiscordAccountConnection/);
    assert.match(source, /connection is unavailable/);
    assert.match(source, /It expires in 10 minutes/);
    assert.doesNotMatch(source, /Public chat remains available/);
    assert.match(definitions, /"name": "account"/);
    assert.match(catalog, /account: \(\) => import\('\.\/account\.js'\)/);
});
