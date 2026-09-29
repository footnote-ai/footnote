/**
 * @description: Integration tests to ensure incidents and audit events are persisted with pseudonymized Discord identifiers (namespaced HMAC) and no raw IDs leak into storage.
 * @footnote-scope: test
 * @footnote-module: IncidentStoreTests
 * @footnote-risk: low - Missing coverage could allow raw IDs to be stored in production.
 * @footnote-ethics: high - Confirms privacy guarantees for incident audit trails.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { SqliteIncidentStore } from '../src/storage/incidents/sqliteIncidentStore.js';
import { hmacId } from '../src/utils/pseudonymization.js';

const SECRET = 'integration-secret';

test('SqliteIncidentStore pseudonymizes pointers and audit actors', async () => {
    const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'incident-store-')
    );
    const dbPath = path.join(tempRoot, 'incidents.db');
    const store = new SqliteIncidentStore({
        dbPath,
        pseudonymizationSecret: SECRET,
    });

    const rawPointers = {
        guildId: '123456789012345678',
        channelId: '234567890123456789',
        messageId: '345678901234567890',
    };

    try {
        const incident = await store.createIncident({
            pointers: rawPointers,
            tags: ['a', 'b'],
            consentedAt: new Date().toISOString(),
        });
        assert.ok(
            incident.pointers.guildId && incident.pointers.guildId.length === 64
        );
        assert.equal(
            incident.pointers.guildId,
            hmacId(SECRET, rawPointers.guildId, 'guild')
        );
        assert.equal(
            incident.pointers.channelId,
            hmacId(SECRET, rawPointers.channelId, 'channel')
        );
        assert.equal(
            incident.pointers.messageId,
            hmacId(SECRET, rawPointers.messageId, 'message')
        );
        const db = new Database(dbPath);
        try {
            const stored = db
                .prepare('SELECT pointers_json FROM incidents WHERE id = ?')
                .get(incident.id) as
                | {
                      pointers_json: string;
                  }
                | undefined;
            assert.ok(
                stored?.pointers_json,
                'Stored incident record should include pointers JSON'
            );
            const parsed = JSON.parse(stored.pointers_json) as Record<
                string,
                unknown
            >;
            const storedJson = JSON.stringify(parsed);

            assert.equal(parsed.guildId, incident.pointers.guildId);
            assert.equal(parsed.channelId, incident.pointers.channelId);
            assert.equal(parsed.messageId, incident.pointers.messageId);
            assert.ok(
                !storedJson.includes(rawPointers.guildId),
                'Raw guild ID should not be stored'
            );
            assert.ok(
                !storedJson.includes(rawPointers.channelId),
                'Raw channel ID should not be stored'
            );
            assert.ok(
                !storedJson.includes(rawPointers.messageId),
                'Raw message ID should not be stored'
            );
        } finally {
            db.close();
        }

        const audit = await store.appendAuditEvent(incident.id, {
            actorHash: '999999999999999999',
            action: 'incident.note_added',
            notes: 'actor id should be hashed',
        });

        assert.equal(
            audit.actorHash,
            hmacId(SECRET, '999999999999999999', 'user')
        );

        const db2 = new Database(dbPath);
        try {
            const storedAudit = db2
                .prepare(
                    'SELECT actor_hash FROM incident_audit_events WHERE id = ?'
                )
                .get(audit.id) as
                | {
                      actor_hash: string | null;
                  }
                | undefined;
            assert.ok(storedAudit, 'Stored audit event should exist');
            assert.equal(storedAudit.actor_hash, audit.actorHash);
            assert.ok(
                !String(storedAudit.actor_hash).includes('999999999999999999'),
                'Raw actor ID should not persist'
            );
        } finally {
            db2.close();
        }
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('SqliteIncidentStore rolls back status changes when the audit append fails', async () => {
    const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'incident-store-')
    );
    const dbPath = path.join(tempRoot, 'incidents.db');
    const store = new SqliteIncidentStore({
        dbPath,
        pseudonymizationSecret: SECRET,
    });

    try {
        const incident = await store.createIncident({
            consentedAt: new Date().toISOString(),
        });
        const mutableStore = store as unknown as {
            insertAuditEvent: { run: (values: unknown) => unknown };
        };
        const originalInsertAuditEvent = mutableStore.insertAuditEvent;
        mutableStore.insertAuditEvent = {
            run: () => {
                throw new Error('forced audit write failure');
            },
        };

        try {
            await assert.rejects(
                () =>
                    store.updateStatusWithAudit({
                        incidentId: incident.id,
                        status: 'under_review',
                        auditEvent: {
                            actorHash: '999999999999999999',
                            action: 'incident.status_changed',
                            notes: 'reviewing now',
                        },
                    }),
                /forced audit write failure/
            );
        } finally {
            mutableStore.insertAuditEvent = originalInsertAuditEvent;
        }

        const rolledBackIncident = await store.getIncident(incident.id);
        assert.equal(rolledBackIncident?.status, 'new');
        const auditEvents = await store.listAuditEvents(incident.id);
        assert.equal(auditEvents.length, 0);
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('incident claim capabilities expire and associate once without disclosing other accounts', async () => {
    const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'incident-store-')
    );
    const store = new SqliteIncidentStore({
        dbPath: path.join(tempRoot, 'incidents.db'),
        pseudonymizationSecret: SECRET,
    });

    try {
        const incident = await store.createIncidentWithAudit({
            incident: { consentedAt: new Date().toISOString() },
            auditEvent: { action: 'incident.created' },
            association: {
                capabilityHash: 'hashed-capability',
                expiresAt: '2026-10-01T00:00:00.000Z',
            },
        });

        assert.equal(
            await store.associateIncident(
                'hashed-capability',
                'account-a',
                '2026-09-30T00:00:00.000Z'
            ),
            'associated'
        );
        assert.equal(
            await store.associateIncident(
                'hashed-capability',
                'account-a',
                '2026-09-30T00:01:00.000Z'
            ),
            'already-associated'
        );
        assert.equal(
            await store.associateIncident(
                'hashed-capability',
                'account-b',
                '2026-09-30T00:01:00.000Z'
            ),
            'unavailable'
        );
        assert.equal(
            await store.associateIncident(
                'hashed-capability',
                'account-a',
                '2026-10-01T00:00:00.000Z'
            ),
            'already-associated'
        );
        assert.deepEqual(await store.listAssociatedIncidents('account-a'), [
            {
                incidentId: incident.shortId,
                status: 'new',
                createdAt: incident.createdAt,
                updatedAt: incident.updatedAt,
            },
        ]);
        assert.deepEqual(await store.listAssociatedIncidents('account-b'), []);

        const expired = await store.createIncidentWithAudit({
            incident: { consentedAt: new Date().toISOString() },
            auditEvent: { action: 'incident.created' },
            association: {
                capabilityHash: 'expired-capability',
                expiresAt: '2026-09-30T00:00:00.000Z',
            },
        });
        assert.ok(expired.shortId);
        assert.equal(
            await store.associateIncident(
                'expired-capability',
                'account-a',
                '2026-10-01T00:00:00.000Z'
            ),
            'unavailable'
        );
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('deleting account associations removes its claim verifiers but preserves unclaimed and other rows', async () => {
    const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'incident-account-delete-')
    );
    const store = new SqliteIncidentStore({
        dbPath: path.join(tempRoot, 'incidents.db'),
        pseudonymizationSecret: SECRET,
    });
    try {
        for (const [capabilityHash, expiresAt] of [
            ['account-capability', '2026-10-02T00:00:00.000Z'],
            ['other-capability', '2026-10-02T00:00:00.000Z'],
            ['unclaimed-capability', '2026-10-02T00:00:00.000Z'],
        ]) {
            await store.createIncidentWithAudit({
                incident: { consentedAt: new Date().toISOString() },
                auditEvent: { action: 'incident.created' },
                association: { capabilityHash, expiresAt },
            });
        }
        await store.associateIncident(
            'account-capability',
            'account-a',
            '2026-10-01T00:00:00.000Z'
        );
        await store.associateIncident(
            'other-capability',
            'account-b',
            '2026-10-01T00:00:00.000Z'
        );

        await store.redactAndDeleteAccountAssociations('account-a');
        await store.redactAndDeleteAccountAssociations('account-a');

        assert.deepEqual(await store.listAssociatedIncidents('account-a'), []);
        assert.equal(
            await store.associateIncident(
                'account-capability',
                'account-a',
                '2026-10-01T00:00:00.000Z'
            ),
            'unavailable'
        );
        assert.equal(
            await store.associateIncident(
                'unclaimed-capability',
                'account-b',
                '2026-10-01T00:00:00.000Z'
            ),
            'associated'
        );
        assert.equal(
            (await store.listAssociatedIncidents('account-b')).length,
            2
        );
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('account deletion removes reporter details from claimed incidents but leaves unclaimed reports unchanged', async () => {
    const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'incident-account-redaction-')
    );
    const store = new SqliteIncidentStore({
        dbPath: path.join(tempRoot, 'incidents.db'),
        pseudonymizationSecret: SECRET,
    });
    const reporterId = 'reporter-discord-id';
    const consentedAt = '2026-09-28T12:00:00.000Z';
    try {
        const claimed = await store.createIncidentWithAudit({
            incident: {
                reporterId,
                tags: ['safety'],
                description: 'Private reporter details',
                contact: 'reporter@example.test',
                consentedAt,
                pointers: {
                    guildId: '123456789012345678',
                    channelId: '234567890123456789',
                    messageId: '345678901234567890',
                    responseId: 'response-123',
                    chainHash: 'chain-abc',
                    modelVersion: 'model-v1',
                },
            },
            auditEvent: {
                actorHash: reporterId,
                action: 'incident.created',
                notes: 'description provided; contact provided; tags=reporter-discord-id',
            },
            association: {
                capabilityHash: 'claimed-verifier',
                expiresAt: '2026-10-28T12:00:00.000Z',
            },
        });
        await store.associateIncident(
            'claimed-verifier',
            'account-a',
            '2026-09-28T12:01:00.000Z'
        );
        await store.updateStatusWithAudit({
            incidentId: claimed.id,
            status: 'under_review',
            auditEvent: {
                actorHash: 'operator-id',
                action: 'incident.status_changed',
                notes: 'operator review retained',
            },
        });
        await store.updateRemediationWithAudit({
            incidentId: claimed.id,
            remediation: {
                state: 'applied',
                notes: 'moderation action retained',
            },
            auditEvent: {
                actorHash: 'operator-id',
                action: 'incident.remediated',
                notes: 'message marked under review',
            },
        });

        const unclaimed = await store.createIncidentWithAudit({
            incident: {
                reporterId,
                description: 'Unclaimed reporter details',
                contact: 'unclaimed@example.test',
                consentedAt,
            },
            auditEvent: {
                actorHash: reporterId,
                action: 'incident.created',
                notes: 'description provided, contact provided',
            },
        });

        await store.redactAndDeleteAccountAssociations('account-a');

        const redacted = await store.getIncident(claimed.id);
        assert.ok(redacted);
        assert.equal(redacted.reporterHash, null);
        assert.equal(redacted.description, null);
        assert.equal(redacted.contact, null);
        assert.equal(redacted.status, 'under_review');
        assert.equal(redacted.consentedAt, consentedAt);
        assert.equal(redacted.remediationState, 'applied');
        assert.equal(redacted.remediationNotes, 'moderation action retained');
        assert.deepEqual(redacted.tags, ['safety']);
        assert.deepEqual(redacted.pointers, claimed.pointers);

        const claimedAudit = await store.listAuditEvents(claimed.id);
        assert.equal(claimedAudit.length, 3);
        assert.equal(claimedAudit[0]?.action, 'incident.created');
        assert.equal(claimedAudit[0]?.actorHash, null);
        assert.equal(
            claimedAudit[0]?.notes,
            'description provided; contact provided'
        );
        assert.equal(
            claimedAudit[1]?.actorHash,
            hmacId(SECRET, 'operator-id', 'user')
        );
        assert.equal(
            claimedAudit[2]?.actorHash,
            hmacId(SECRET, 'operator-id', 'user')
        );
        assert.deepEqual(await store.listAssociatedIncidents('account-a'), []);
        assert.equal(
            await store.associateIncident(
                'claimed-verifier',
                'account-a',
                '2026-09-28T12:02:00.000Z'
            ),
            'unavailable'
        );

        const untouched = await store.getIncident(unclaimed.id);
        assert.ok(untouched);
        assert.equal(
            untouched.reporterHash,
            hmacId(SECRET, reporterId, 'user')
        );
        assert.equal(untouched.description, 'Unclaimed reporter details');
        assert.equal(untouched.contact, 'unclaimed@example.test');
        const unclaimedAudit = await store.listAuditEvents(unclaimed.id);
        assert.equal(
            unclaimedAudit[0]?.actorHash,
            hmacId(SECRET, reporterId, 'user')
        );
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('account deletion rolls back incident redaction when association removal fails', async () => {
    const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'incident-account-redaction-rollback-')
    );
    const dbPath = path.join(tempRoot, 'incidents.db');
    const store = new SqliteIncidentStore({
        dbPath,
        pseudonymizationSecret: SECRET,
    });
    try {
        const incident = await store.createIncidentWithAudit({
            incident: {
                reporterId: 'reporter-discord-id',
                description: 'Keep until the transaction commits',
                contact: 'reporter@example.test',
                consentedAt: new Date().toISOString(),
            },
            auditEvent: {
                actorHash: 'reporter-discord-id',
                action: 'incident.created',
            },
            association: {
                capabilityHash: 'rollback-verifier',
                expiresAt: '2026-10-28T12:00:00.000Z',
            },
        });
        await store.associateIncident(
            'rollback-verifier',
            'account-a',
            '2026-09-28T12:01:00.000Z'
        );
        const db = new Database(dbPath);
        try {
            db.exec(`
                CREATE TRIGGER fail_account_association_delete
                BEFORE DELETE ON incident_associations
                BEGIN
                    SELECT RAISE(ABORT, 'forced association delete failure');
                END;
            `);
            await assert.rejects(
                () => store.redactAndDeleteAccountAssociations('account-a'),
                /forced association delete failure/
            );
        } finally {
            db.close();
        }

        const retained = await store.getIncident(incident.id);
        assert.equal(
            retained?.description,
            'Keep until the transaction commits'
        );
        assert.equal(retained?.contact, 'reporter@example.test');
        assert.equal(
            retained?.reporterHash,
            hmacId(SECRET, 'reporter-discord-id', 'user')
        );
        assert.equal(
            (await store.listAuditEvents(incident.id))[0]?.actorHash,
            hmacId(SECRET, 'reporter-discord-id', 'user')
        );
        assert.equal(
            (await store.listAssociatedIncidents('account-a')).length,
            1
        );
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});
