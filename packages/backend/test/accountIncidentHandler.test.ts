/**
 * @description: Exercises explicit incident association and reporter-safe account access over HTTP.
 * @footnote-scope: test
 * @footnote-module: AccountIncidentHandlerTests
 * @footnote-risk: high - Missing coverage could expose reports across accounts.
 * @footnote-ethics: high - These checks protect reporter privacy and choice.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { PostIncidentReportRequest } from '@footnote/contracts/web';
import { createAccountIncidentHandlers } from '../src/handlers/accountIncidents.js';
import { createAccountDiscordConnectionHandlers } from '../src/handlers/accountDiscordConnection.js';
import { createAccountMemoryHandlers } from '../src/handlers/accountMemories.js';
import { createAccountAuthService } from '../src/services/accountAuth.js';
import { createIncidentService } from '../src/services/incidents.js';
import type { OidcAccountClient } from '../src/services/oidcClient.js';
import { createInMemoryAccountStore } from '../src/storage/accounts/sqliteAccountStore.js';
import { SqliteIncidentStore } from '../src/storage/incidents/sqliteIncidentStore.js';

const SECRET = 'account-incident-test-secret';

test('reports stay anonymous until explicitly claimed and remain account-scoped', async (t) => {
    const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'account-incident-')
    );
    const incidentStore = new SqliteIncidentStore({
        dbPath: path.join(tempRoot, 'incidents.db'),
        pseudonymizationSecret: SECRET,
    });
    let subject = 'reporter';
    let tokenIndex = 0;
    const provider: OidcAccountClient = {
        startAuthorization: async () => ({
            authorizationUrl: 'https://identity.example/authorize',
            state: 'state',
            nonce: 'nonce',
            codeVerifier: 'verifier',
        }),
        exchangeCallback: async () => ({
            issuer: 'https://identity.example/',
            subject,
            displayName: null,
        }),
    };
    const accountStore = createInMemoryAccountStore();
    const accountAuthService = createAccountAuthService({
        provider,
        accountStore,
        randomToken: () => `test-token-${++tokenIndex}`,
    });
    const incidentService = createIncidentService({ incidentStore });
    const handlers = createAccountIncidentHandlers({
        accountAuthService,
        accountStore,
        incidentService,
        logRequest: () => undefined,
    });
    const memoryHandlers = createAccountMemoryHandlers({
        accountAuthService,
        accountStore,
        logRequest: () => undefined,
    });
    const discordHandlers = createAccountDiscordConnectionHandlers({
        accountAuthService,
        accountStore,
        logRequest: () => undefined,
    });
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (pathname === '/api/account/discord-connection') {
            if (req.method === 'GET') {
                void discordHandlers.handleAccountDiscordStatusRequest(
                    req,
                    res
                );
            } else if (req.method === 'DELETE') {
                void discordHandlers.handleAccountDiscordDisconnectRequest(
                    req,
                    res
                );
            } else {
                res.statusCode = 404;
                res.end();
            }
        } else if (pathname === '/api/account/incidents') {
            void handlers.handleAccountIncidentsRequest(req, res);
        } else if (pathname === '/api/account/incidents/claim') {
            void handlers.handleAccountIncidentClaimRequest(req, res);
        } else if (pathname === '/api/account/export') {
            void handlers.handleAccountExportRequest(req, res);
        } else if (
            pathname === '/api/account/memories' &&
            req.method === 'GET'
        ) {
            void memoryHandlers.handleAccountMemoriesRequest(req, res);
        } else if (
            pathname === '/api/account/memories' &&
            req.method === 'POST'
        ) {
            void memoryHandlers.handleAccountMemoryCreateRequest(req, res);
        } else if (
            pathname.startsWith('/api/account/memories/') &&
            req.method === 'DELETE'
        ) {
            void memoryHandlers.handleAccountMemoryDeleteRequest(req, res);
        } else {
            res.statusCode = 404;
            res.end();
        }
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    t.after(async () => {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
        incidentStore.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    const createSession = async (nextSubject: string) => {
        subject = nextSubject;
        const login = await accountAuthService.startLogin();
        assert.equal(login.ok, true);
        if (!login.ok) throw new Error('Test login did not start');
        const result = await accountAuthService.completeLogin(
            login.transactionId,
            'code=ok'
        );
        assert.equal(result.ok, true);
        if (!result.ok) throw new Error('Test login did not complete');
        return result.session;
    };
    const reporter = await createSession('reporter');
    const otherAccount = await createSession('other-account');
    accountStore.linkDiscordUserToAccount(
        'connected-discord-user',
        reporter.accountId
    );
    accountStore.linkDiscordUserToAccount(
        'other-discord-user',
        otherAccount.accountId
    );
    const request: PostIncidentReportRequest = {
        reporterUserId: 'same-observed-discord-id',
        tags: ['same-observed-discord-id'],
        description: 'private report description',
        contact: 'private-contact@example.com',
        consentedAt: new Date().toISOString(),
    };
    const reported = await incidentService.reportIncident(request);
    assert.equal(
        reported.incident.auditEvents[0]?.notes,
        'description provided; contact provided; tags provided'
    );
    const accountHeaders = (session: typeof reporter) => ({
        cookie: `footnote_account_session=${session.sessionId}`,
    });
    assert.equal((await fetch(`${baseUrl}/api/account/memories`)).status, 401);
    assert.equal(
        (
            await fetch(`${baseUrl}/api/account/memories`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ text: 'anonymous memory' }),
            })
        ).status,
        401
    );
    assert.equal(
        (
            await fetch(
                `${baseUrl}/api/account/memories/00000000-0000-4000-8000-000000000000`,
                { method: 'DELETE' }
            )
        ).status,
        401
    );
    const initialMemories = await fetch(`${baseUrl}/api/account/memories`, {
        headers: accountHeaders(reporter),
    });
    assert.equal(initialMemories.status, 200);
    assert.deepEqual(await initialMemories.json(), { memories: [] });
    const noCsrfMemory = await fetch(`${baseUrl}/api/account/memories`, {
        method: 'POST',
        headers: {
            ...accountHeaders(reporter),
            'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'keep private' }),
    });
    assert.equal(noCsrfMemory.status, 403);
    const addedMemory = await fetch(`${baseUrl}/api/account/memories`, {
        method: 'POST',
        headers: {
            ...accountHeaders(reporter),
            'content-type': 'application/json',
            'x-auth-csrf': reporter.csrfToken,
        },
        body: JSON.stringify({ text: 'concise answers' }),
    });
    assert.equal(addedMemory.status, 201);
    const saved = (await addedMemory.json()) as {
        memory: { id: string; text: string };
    };
    assert.equal(
        (
            await fetch(`${baseUrl}/api/account/memories/${saved.memory.id}`, {
                method: 'DELETE',
                headers: accountHeaders(reporter),
            })
        ).status,
        403
    );
    const ownerMemories = await fetch(`${baseUrl}/api/account/memories`, {
        headers: accountHeaders(reporter),
    });
    assert.deepEqual(await ownerMemories.json(), {
        memories: [saved.memory],
    });
    const multibyteMemory = await fetch(`${baseUrl}/api/account/memories`, {
        method: 'POST',
        headers: {
            ...accountHeaders(reporter),
            'content-type': 'application/json',
            'x-auth-csrf': reporter.csrfToken,
        },
        body: JSON.stringify({ text: '界'.repeat(2000) }),
    });
    assert.equal(multibyteMemory.status, 201);
    const multibyteSaved = (await multibyteMemory.json()) as {
        memory: { id: string };
    };
    assert.equal(
        (
            await fetch(
                `${baseUrl}/api/account/memories/${multibyteSaved.memory.id}`,
                {
                    method: 'DELETE',
                    headers: {
                        ...accountHeaders(reporter),
                        'x-auth-csrf': reporter.csrfToken,
                    },
                }
            )
        ).status,
        200
    );
    const foreignMemories = await fetch(`${baseUrl}/api/account/memories`, {
        headers: accountHeaders(otherAccount),
    });
    assert.deepEqual(await foreignMemories.json(), { memories: [] });
    const forgetForeign = await fetch(
        `${baseUrl}/api/account/memories/${saved.memory.id}`,
        {
            method: 'DELETE',
            headers: {
                ...accountHeaders(otherAccount),
                'x-auth-csrf': otherAccount.csrfToken,
            },
        }
    );
    assert.equal(forgetForeign.status, 404);
    const forgetOwned = await fetch(
        `${baseUrl}/api/account/memories/${saved.memory.id}`,
        {
            method: 'DELETE',
            headers: {
                ...accountHeaders(reporter),
                'x-auth-csrf': reporter.csrfToken,
            },
        }
    );
    assert.equal(forgetOwned.status, 200);
    for (const id of [
        saved.memory.id,
        '00000000-0000-4000-8000-000000000000',
    ]) {
        const retry = await fetch(`${baseUrl}/api/account/memories/${id}`, {
            method: 'DELETE',
            headers: {
                ...accountHeaders(reporter),
                'x-auth-csrf': reporter.csrfToken,
            },
        });
        assert.equal(retry.status, 404);
    }

    const initiallyEmpty = await fetch(`${baseUrl}/api/account/incidents`, {
        headers: accountHeaders(reporter),
    });
    assert.equal(initiallyEmpty.status, 200);
    assert.deepEqual(await initiallyEmpty.json(), { incidents: [] });

    const missingCsrf = await fetch(`${baseUrl}/api/account/incidents/claim`, {
        method: 'POST',
        headers: {
            ...accountHeaders(reporter),
            'content-type': 'application/json',
        },
        body: JSON.stringify({ claimCode: reported.claimCode }),
    });
    assert.equal(missingCsrf.status, 403);

    const claim = async (session: typeof reporter, claimCode: string) =>
        fetch(`${baseUrl}/api/account/incidents/claim`, {
            method: 'POST',
            headers: {
                ...accountHeaders(session),
                'x-auth-csrf': session.csrfToken,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ claimCode }),
        });

    assert.equal((await claim(reporter, reported.claimCode)).status, 200);
    assert.equal((await claim(reporter, reported.claimCode)).status, 200);
    const foreignClaim = await claim(otherAccount, reported.claimCode);
    const invalidClaim = await claim(otherAccount, 'A'.repeat(43));
    assert.equal(foreignClaim.status, 404);
    assert.equal(await foreignClaim.text(), await invalidClaim.text());

    const ownerList = await fetch(`${baseUrl}/api/account/incidents`, {
        headers: accountHeaders(reporter),
    });
    const listBody = (await ownerList.json()) as {
        incidents: Array<Record<string, unknown>>;
    };
    assert.equal(listBody.incidents.length, 1);
    assert.deepEqual(Object.keys(listBody.incidents[0] ?? {}).sort(), [
        'createdAt',
        'incidentId',
        'status',
        'updatedAt',
    ]);
    const ownerListText = JSON.stringify(listBody);
    assert.ok(!ownerListText.includes('private report description'));
    assert.ok(!ownerListText.includes('private-contact@example.com'));
    assert.ok(!ownerListText.includes('auditEvents'));

    const foreignList = await fetch(`${baseUrl}/api/account/incidents`, {
        headers: accountHeaders(otherAccount),
    });
    assert.deepEqual(await foreignList.json(), { incidents: [] });

    const anonymousExport = await fetch(`${baseUrl}/api/account/export`);
    assert.equal(anonymousExport.status, 401);

    const exportMemoryResponse = await fetch(
        `${baseUrl}/api/account/memories`,
        {
            method: 'POST',
            headers: {
                ...accountHeaders(reporter),
                'x-auth-csrf': reporter.csrfToken,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ text: 'exported preference' }),
        }
    );
    assert.equal(exportMemoryResponse.status, 201);

    const ownerExport = await fetch(`${baseUrl}/api/account/export`, {
        headers: accountHeaders(reporter),
    });
    assert.equal(ownerExport.status, 200);
    assert.match(
        ownerExport.headers.get('content-disposition') ?? '',
        /attachment; filename="footnote-account-export\.json"/
    );
    const exportBody = (await ownerExport.json()) as {
        data: {
            account: { category: string; id: string };
            externalIdentityMappings: {
                category: string;
                records: Array<{ issuer: string; subject: string }>;
            };
            discordMappings: {
                category: string;
                records: Array<{ discordUserId: string }>;
            };
            incidentAssociations: {
                category: string;
                records: Array<{
                    associatedAt: string;
                    incident: Record<string, unknown>;
                }>;
            };
            memories: {
                category: string;
                records: Array<{ id: string; text: string }>;
            };
        };
    };
    assert.equal(exportBody.data.account.category, 'account');
    assert.equal(exportBody.data.account.id, reporter.accountId);
    assert.equal(exportBody.data.memories.category, 'user_memories');
    assert.equal(
        exportBody.data.memories.records[0]?.text,
        'exported preference'
    );

    for (let index = 0; index < 49; index += 1) {
        assert.ok(
            accountStore.addMemory(reporter.accountId, `memory ${index}`)
        );
    }
    const overLimit = await fetch(`${baseUrl}/api/account/memories`, {
        method: 'POST',
        headers: {
            ...accountHeaders(reporter),
            'x-auth-csrf': reporter.csrfToken,
            'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'one too many' }),
    });
    assert.equal(overLimit.status, 409);
    assert.deepEqual(
        exportBody.data.externalIdentityMappings.records.map(
            ({ subject: exportedSubject }) => exportedSubject
        ),
        ['reporter']
    );
    assert.equal(
        exportBody.data.externalIdentityMappings.category,
        'external_identity_mappings'
    );
    assert.equal(exportBody.data.discordMappings.category, 'discord_mappings');
    assert.equal(exportBody.data.discordMappings.records.length, 1);
    assert.equal(
        exportBody.data.discordMappings.records[0]?.discordUserId,
        'connected-discord-user'
    );
    assert.equal(
        exportBody.data.incidentAssociations.category,
        'incident_associations'
    );
    assert.equal(exportBody.data.incidentAssociations.records.length, 1);
    assert.ok(
        Number.isFinite(
            Date.parse(
                exportBody.data.incidentAssociations.records[0]?.associatedAt ??
                    ''
            )
        )
    );
    assert.deepEqual(
        Object.keys(
            exportBody.data.incidentAssociations.records[0]?.incident ?? {}
        ).sort(),
        ['createdAt', 'incidentId', 'status', 'updatedAt']
    );
    const exportText = JSON.stringify(exportBody);
    for (const excluded of [
        'other-account',
        'private report description',
        'private-contact@example.com',
        'capability_hash',
        'claimCode',
        'auditEvents',
        'remediationNotes',
    ]) {
        assert.ok(!exportText.includes(excluded), `export leaked ${excluded}`);
    }
    const foreignExport = await fetch(`${baseUrl}/api/account/export`, {
        headers: accountHeaders(otherAccount),
    });
    const foreignExportBody = (await foreignExport.json()) as {
        data: { incidentAssociations: { records: unknown[] } };
    };
    assert.equal(foreignExport.status, 200);
    assert.equal(foreignExportBody.data.incidentAssociations.records.length, 0);

    const anonymousDiscordStatus = await fetch(
        `${baseUrl}/api/account/discord-connection`
    );
    assert.equal(anonymousDiscordStatus.status, 401);
    const discordStatus = await fetch(
        `${baseUrl}/api/account/discord-connection`,
        { headers: accountHeaders(reporter) }
    );
    const discordStatusText = await discordStatus.text();
    assert.deepEqual(JSON.parse(discordStatusText), { connected: true });
    assert.ok(!discordStatusText.includes('connected-discord-user'));
    const noCsrfDisconnect = await fetch(
        `${baseUrl}/api/account/discord-connection`,
        { method: 'DELETE', headers: accountHeaders(reporter) }
    );
    assert.equal(noCsrfDisconnect.status, 403);
    const pendingDiscord = accountAuthService.startDiscordConnection(
        'pending-discord-user'
    );
    assert.ok(pendingDiscord);
    const pendingConnection = accountAuthService.exchangeDiscordCapability(
        pendingDiscord.capability
    );
    assert.ok(pendingConnection);
    const pendingCode = accountAuthService.approveDiscordConnection(
        pendingConnection,
        reporter.accountId,
        reporter.sessionId
    );
    assert.ok(pendingCode);
    const disconnected = await fetch(
        `${baseUrl}/api/account/discord-connection`,
        {
            method: 'DELETE',
            headers: {
                ...accountHeaders(reporter),
                'x-auth-csrf': reporter.csrfToken,
            },
        }
    );
    assert.equal(disconnected.status, 204);
    assert.equal(
        accountAuthService.confirmDiscordConnection(
            'pending-discord-user',
            pendingCode
        ),
        'invalid'
    );
    const statusAfterDisconnect = await fetch(
        `${baseUrl}/api/account/discord-connection`,
        { headers: accountHeaders(reporter) }
    );
    assert.deepEqual(await statusAfterDisconnect.json(), { connected: false });
    assert.equal(
        accountStore.findAccountByDiscordUserId('connected-discord-user'),
        null
    );
    assert.equal(
        accountStore.findAccountByDiscordUserId('other-discord-user')?.id,
        otherAccount.accountId
    );
    const otherAccountDiscordStatus = await fetch(
        `${baseUrl}/api/account/discord-connection`,
        { headers: accountHeaders(otherAccount) }
    );
    assert.deepEqual(await otherAccountDiscordStatus.json(), {
        connected: true,
    });
});
