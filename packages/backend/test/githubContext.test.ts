/**
 * @description: Verifies bounded, fail-open GitHub context retrieval and sanitization.
 * @footnote-scope: test
 * @footnote-module: GitHubContextIntegrationTests
 * @footnote-risk: medium - Missing coverage could expose untrusted data or break generation continuation.
 * @footnote-ethics: high - Tests protect credential exclusion and advisory-only context handling.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createGitHubContextStepExecutor,
    formatGitHubContext,
    isRepositorySlugInConversation,
    type GitHubContextPayload,
    parseGitHubRepositorySlug,
} from '../src/services/contextIntegrations/github/index.js';

const response = (status: number, body: unknown) => ({
    status,
    json: async () => body,
});
const repository = {
    name: 'repo',
    html_url: 'https://github.com/acme/repo',
    description: 'safe\u0000 description',
    private: false,
};
const list = (kind: string) =>
    Array.from({ length: 7 }, (_, index) => ({
        title: `${kind} ${index}`,
        name: `${kind} ${index}`,
        html_url: `https://github.com/acme/repo/${kind}/${index}`,
        body: `body ${index}`,
    }));
const request = (
    sections: string[] = [
        'repository',
        'issues',
        'pulls',
        'releases',
        'commits',
    ]
) => ({
    request: {
        integrationName: 'github_context',
        requested: true,
        eligible: true,
        input: { repository: 'acme/repo', sections },
    },
    attempt: 1,
    workflowId: 'test',
    workflowName: 'test',
});

const successfulFetch = async (url: string) => {
    if (url.endsWith('/acme/repo')) return response(200, repository);
    if (url.includes('/issues')) return response(200, list('issues'));
    if (url.includes('/pulls')) return response(200, list('pulls'));
    if (url.includes('/releases')) return response(200, list('releases'));
    return response(
        200,
        list('commits').map((item) => ({
            ...item,
            commit: { message: item.title },
        }))
    );
};

test('GitHub context validates exact owner/repo slugs and user conversation scope', () => {
    assert.equal(parseGitHubRepositorySlug('acme/repo'), 'acme/repo');
    assert.equal(parseGitHubRepositorySlug('acme/repo/path'), undefined);
    assert.equal(parseGitHubRepositorySlug('../repo'), undefined);
    assert.equal(
        isRepositorySlugInConversation('acme/repo', ['Use acme/repo please']),
        true
    );
    assert.equal(
        isRepositorySlugInConversation('acme/repo', ['Use other/repo please']),
        false
    );
});

test('GitHub context normalizes all fixed sections, bounds records, and labels text untrusted', async () => {
    const executor = createGitHubContextStepExecutor({
        enabled: true,
        token: null,
        timeoutMs: 5000,
        maxRecordsPerSection: 5,
        privateRepositoryAllowlist: [],
        cacheTtlMs: 60_000,
        staleResultLimitMs: 900_000,
        fetchImpl: successfulFetch,
    });
    const result = await executor(request());
    assert.equal(result.outcome, 'executed');
    assert.equal(result.sources?.length, 21);
    const payload = result.integrationContext?.payload as GitHubContextPayload;
    assert.equal(payload.metadata.status, 'current');
    assert.equal(payload.metadata.returnedCounts.issues, 5);
    assert.equal(payload.records.issues?.length, 5);
    assert.match(
        formatGitHubContext(payload)[0] ?? '',
        /UNTRUSTED GITHUB CONTEXT/
    );
    assert.equal(
        (formatGitHubContext(payload)[0] ?? '').includes(
            String.fromCharCode(0)
        ),
        false
    );
});

test('GitHub context fails open for private access, HTTP failures, malformed bodies, and network errors without serializing token', async () => {
    const privateExecutor = createGitHubContextStepExecutor({
        enabled: true,
        token: 'secret-token',
        timeoutMs: 5000,
        maxRecordsPerSection: 5,
        privateRepositoryAllowlist: [],
        cacheTtlMs: 60_000,
        staleResultLimitMs: 900_000,
        fetchImpl: async () => response(200, { ...repository, private: true }),
    });
    const privateResult = await privateExecutor(request(['repository']));
    assert.equal(privateResult.outcome, 'failed');
    assert.deepEqual(
        (
            privateResult.integrationContext?.payload as {
                metadata: { reasonCodes: string[] };
            }
        ).metadata.reasonCodes,
        ['private_access_denied']
    );
    assert.doesNotMatch(JSON.stringify(privateResult), /secret-token/);

    const timeoutExecutor = createGitHubContextStepExecutor({
        enabled: true,
        token: null,
        timeoutMs: 1,
        maxRecordsPerSection: 5,
        privateRepositoryAllowlist: [],
        cacheTtlMs: 1,
        staleResultLimitMs: 1,
        fetchImpl: async (_url, init) =>
            new Promise((_, reject) =>
                init.signal.addEventListener(
                    'abort',
                    () => reject(new Error('aborted')),
                    { once: true }
                )
            ),
    });
    const timeoutResult = await timeoutExecutor(request(['repository']));
    assert.equal(timeoutResult.outcome, 'failed');
    assert.deepEqual(
        (
            timeoutResult.integrationContext?.payload as {
                metadata: { reasonCodes: string[] };
            }
        ).metadata.reasonCodes,
        ['timeout']
    );

    for (const resultFactory of [
        async () => response(401, {}),
        async () => response(404, {}),
        async () => response(429, {}),
        async () => response(200, { nope: true }),
        async () => {
            throw new Error('network');
        },
    ]) {
        const executor = createGitHubContextStepExecutor({
            enabled: true,
            token: null,
            timeoutMs: 5000,
            maxRecordsPerSection: 5,
            privateRepositoryAllowlist: [],
            cacheTtlMs: 1,
            staleResultLimitMs: 1,
            fetchImpl: resultFactory,
        });
        const result = await executor(request(['repository']));
        assert.equal(result.outcome, 'failed');
    }
});

test('GitHub context sends Authorization only for allowlisted repositories and never for others', async () => {
    const captured: string[] = [];
    const allowlistExecutor = createGitHubContextStepExecutor({
        enabled: true,
        token: 'secret-token',
        timeoutMs: 5000,
        maxRecordsPerSection: 5,
        privateRepositoryAllowlist: ['acme/repo'],
        cacheTtlMs: 60_000,
        staleResultLimitMs: 900_000,
        fetchImpl: async (url, init) => {
            captured.push(init.headers.Authorization ?? '(none)');
            return successfulFetch(url);
        },
    });
    const allowed = await allowlistExecutor(request(['repository']));
    assert.equal(allowed.outcome, 'executed');

    const deniedExecutor = createGitHubContextStepExecutor({
        enabled: true,
        token: 'secret-token',
        timeoutMs: 5000,
        maxRecordsPerSection: 5,
        privateRepositoryAllowlist: ['other/repo'],
        cacheTtlMs: 60_000,
        staleResultLimitMs: 900_000,
        fetchImpl: async (url, init) => {
            captured.push(init.headers.Authorization ?? '(none)');
            return successfulFetch(url);
        },
    });
    const denied = await deniedExecutor(request(['repository']));
    assert.equal(denied.outcome, 'executed');

    assert.equal(captured[0], 'Bearer secret-token');
    assert.equal(captured[1], '(none)');
});

test('GitHub context caches per repository and requested section list', async () => {
    let repoCalls = 0;
    let issuesCalls = 0;
    const fetchImpl = async (url: string) => {
        if (url.endsWith('/acme/repo')) {
            repoCalls += 1;
            return response(200, repository);
        }
        if (url.includes('/issues')) {
            issuesCalls += 1;
            return response(200, list('issues'));
        }
        throw new Error('unexpected section');
    };
    const executor = createGitHubContextStepExecutor({
        enabled: true,
        token: null,
        timeoutMs: 5000,
        maxRecordsPerSection: 5,
        privateRepositoryAllowlist: [],
        cacheTtlMs: 60_000,
        staleResultLimitMs: 900_000,
        fetchImpl,
    });

    const first = await executor(request(['repository', 'issues']));
    assert.equal(first.outcome, 'executed');
    assert.equal(repoCalls, 1);
    assert.equal(issuesCalls, 1);

    const sameSections = await executor(request(['repository', 'issues']));
    assert.equal(sameSections.outcome, 'executed');
    assert.equal(repoCalls, 1, 'matching section set served from cache');
    assert.equal(issuesCalls, 1, 'matching section set served from cache');

    const differentSections = await executor(request(['repository']));
    assert.equal(differentSections.outcome, 'executed');
    assert.equal(repoCalls, 2, 'section-scoped cache key misses on subset');
});

test('GitHub context preserves partial success and uses stale cache only after a live failure', async () => {
    let calls = 0;
    let clock = 0;
    const executor = createGitHubContextStepExecutor({
        enabled: true,
        token: null,
        timeoutMs: 5000,
        maxRecordsPerSection: 5,
        privateRepositoryAllowlist: [],
        cacheTtlMs: 0,
        staleResultLimitMs: 900_000,
        now: () => ++clock,
        fetchImpl: async (url) => {
            calls += 1;
            return calls > 1
                ? Promise.reject(new Error('offline'))
                : successfulFetch(url);
        },
    });
    const first = await executor(request(['repository']));
    assert.equal(first.outcome, 'executed');
    const stale = await executor(request(['repository']));
    assert.equal(stale.outcome, 'executed');
    assert.equal(
        (stale.integrationContext?.payload as { metadata: { status: string } })
            .metadata.status,
        'stale'
    );

    const partialExecutor = createGitHubContextStepExecutor({
        enabled: true,
        token: null,
        timeoutMs: 5000,
        maxRecordsPerSection: 5,
        privateRepositoryAllowlist: [],
        cacheTtlMs: 60_000,
        staleResultLimitMs: 900_000,
        fetchImpl: async (url) =>
            url.includes('/issues') ? response(403, {}) : successfulFetch(url),
    });
    const partial = await partialExecutor(request(['repository', 'issues']));
    assert.equal(partial.outcome, 'executed');
    assert.equal(
        (
            partial.integrationContext?.payload as {
                metadata: { status: string; failedSections: string[] };
            }
        ).metadata.status,
        'partial'
    );
});
