/**
 * @description: Verifies GitHub context config parsing, hard caps, and allowlist normalization.
 * @footnote-scope: test
 * @footnote-module: BackendGitHubConfigTests
 * @footnote-risk: medium - Misparsed GitHub context config can silently disable or overreach private access.
 * @footnote-ethics: high - Allowlist and token parsing affect private repository access boundaries.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServiceSections } from '../src/config/sections/services.js';

test('GitHub context config defaults to disabled with safe bounded limits', () => {
    const warnings: string[] = [];
    const { chatWorkflow } = buildServiceSections({}, (message) =>
        warnings.push(message)
    );

    const github = chatWorkflow.contextIntegrations.github;
    assert.equal(github.enabled, false);
    assert.equal(github.token, null);
    assert.equal(github.timeoutMs, 5000);
    assert.equal(github.maxRecordsPerSection, 5);
    assert.deepEqual(github.privateRepositoryAllowlist, []);
    assert.equal(github.cacheTtlMs, 60000);
    assert.equal(github.staleResultLimitMs, 900000);
});

test('GitHub context config enforces hard caps on timeout and records per section', () => {
    const warnings: string[] = [];
    const { chatWorkflow } = buildServiceSections(
        {
            CHAT_CONTEXT_GITHUB_TIMEOUT_MS: '999999',
            CHAT_CONTEXT_GITHUB_MAX_RECORDS_PER_SECTION: '999999',
        },
        (message) => warnings.push(message)
    );

    const github = chatWorkflow.contextIntegrations.github;
    assert.equal(github.timeoutMs, 5000);
    assert.equal(github.maxRecordsPerSection, 5);
});

test('GitHub context config falls back on invalid integer values', () => {
    const warnings: string[] = [];
    const { chatWorkflow } = buildServiceSections(
        {
            CHAT_CONTEXT_GITHUB_TIMEOUT_MS: 'not-a-number',
            CHAT_CONTEXT_GITHUB_CACHE_TTL_MS: '-10',
            CHAT_CONTEXT_GITHUB_STALE_RESULT_LIMIT_MS: 'abc',
        },
        (message) => warnings.push(message)
    );

    const github = chatWorkflow.contextIntegrations.github;
    assert.equal(github.timeoutMs, 5000);
    assert.equal(github.cacheTtlMs, 60000);
    assert.equal(github.staleResultLimitMs, 900000);
});

test('GitHub context config trims, drops empty entries, and lowercases the allowlist', () => {
    const warnings: string[] = [];
    const { chatWorkflow } = buildServiceSections(
        {
            CHAT_CONTEXT_GITHUB_PRIVATE_REPOSITORY_ALLOWLIST:
                ' Acme/Repo ,  Other/Private , ,',
        },
        (message) => warnings.push(message)
    );

    const github = chatWorkflow.contextIntegrations.github;
    assert.deepEqual(github.privateRepositoryAllowlist, [
        'acme/repo',
        'other/private',
    ]);
});
