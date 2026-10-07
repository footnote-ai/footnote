/**
 * @description: Guides an authenticated setup session through managed TrustGraph testing and repository-context loading.
 * The browser selects only deployment-approved targets and receives paths, sizes, and load results, never credentials or file contents.
 * @footnote-scope: web
 * @footnote-module: RepositoryContextSetup
 * @footnote-risk: high - Setup UI requests control when approved repository files are sent to an outside service.
 * @footnote-ethics: high - Clear previews and honest connection/load states protect operator choice and privacy.
 */

import { useEffect, useState } from 'react';
import type {
    GetSetupRepositoryContextConnectionStateResponse,
    GetSetupRepositoryContextPreviewResponse,
    PostSetupRepositoryContextConnectionTestResponse,
    PostSetupRepositoryContextLoadResponse,
} from '@footnote/contracts/web';

const SETUP_CSRF_HEADER_NAME = 'x-setup-csrf';

type ResourceState<T> =
    | { status: 'loading' }
    | { status: 'ready'; value: T }
    | { status: 'error'; message: string };

type ActionState =
    | { status: 'idle' }
    | { status: 'running' }
    | { status: 'error'; message: string }
    | { status: 'done' };

type LoadState =
    | { status: 'idle' }
    | { status: 'running' }
    | { status: 'error'; message: string }
    | { status: 'done'; result: PostSetupRepositoryContextLoadResponse };

const readErrorMessage = async (response: Response): Promise<string> => {
    try {
        const payload = (await response.json()) as { error?: unknown };
        if (typeof payload.error === 'string' && payload.error.length > 0) {
            return payload.error;
        }
    } catch {
        // Fall through to a status-only message when the response is not JSON.
    }
    return `Request failed with status ${response.status}`;
};

const formatBytes = (bytes: number): string =>
    bytes < 1_000
        ? `${bytes} bytes`
        : `${(bytes / 1_000).toFixed(1)} KB (${bytes.toLocaleString('en-US')} bytes)`;

const RepositoryContextSetup = ({
    csrfToken,
}: {
    csrfToken: string;
}): JSX.Element => {
    const [connection, setConnection] = useState<
        ResourceState<GetSetupRepositoryContextConnectionStateResponse>
    >({ status: 'loading' });
    const [preview, setPreview] = useState<
        ResourceState<GetSetupRepositoryContextPreviewResponse>
    >({ status: 'loading' });
    const [connectionRetryKey, setConnectionRetryKey] = useState(0);
    const [previewRetryKey, setPreviewRetryKey] = useState(0);
    const [targetId, setTargetId] = useState('');
    const [testedTargetId, setTestedTargetId] = useState<string | undefined>();
    const [testState, setTestState] = useState<ActionState>({
        status: 'idle',
    });
    const [loadState, setLoadState] = useState<LoadState>({
        status: 'idle',
    });

    useEffect(() => {
        let cancelled = false;
        setConnection({ status: 'loading' });
        void (async () => {
            const response = await fetch(
                '/api/setup/repository-context/connection'
            );
            if (!response.ok) {
                throw new Error(await readErrorMessage(response));
            }
            const value =
                (await response.json()) as GetSetupRepositoryContextConnectionStateResponse;
            if (!cancelled) {
                setConnection({ status: 'ready', value });
                setTargetId((current) =>
                    value.targets.some((target) => target.id === current)
                        ? current
                        : (value.targets[0]?.id ?? '')
                );
            }
        })().catch((error: unknown) => {
            if (!cancelled) {
                setConnection({
                    status: 'error',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'TrustGraph connection state could not be loaded.',
                });
            }
        });
        return () => {
            cancelled = true;
        };
    }, [connectionRetryKey]);

    useEffect(() => {
        let cancelled = false;
        setPreview({ status: 'loading' });
        void (async () => {
            const response = await fetch(
                '/api/setup/repository-context/preview'
            );
            if (!response.ok) {
                throw new Error(await readErrorMessage(response));
            }
            const value =
                (await response.json()) as GetSetupRepositoryContextPreviewResponse;
            if (!cancelled) {
                setPreview({ status: 'ready', value });
            }
        })().catch((error: unknown) => {
            if (!cancelled) {
                setPreview({
                    status: 'error',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'The approved repository context preview could not be loaded.',
                });
            }
        });
        return () => {
            cancelled = true;
        };
    }, [previewRetryKey]);

    const selectedTarget =
        connection.status === 'ready'
            ? connection.value.targets.find((target) => target.id === targetId)
            : undefined;

    const handleTestConnection = async (): Promise<void> => {
        if (!selectedTarget) return;
        setTestedTargetId(undefined);
        setTestState({ status: 'running' });
        try {
            const response = await fetch(
                '/api/setup/repository-context/connection/test',
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        [SETUP_CSRF_HEADER_NAME]: csrfToken,
                    },
                    body: JSON.stringify({ targetId: selectedTarget.id }),
                }
            );
            if (!response.ok) {
                throw new Error(await readErrorMessage(response));
            }
            const result =
                (await response.json()) as PostSetupRepositoryContextConnectionTestResponse;
            setTestedTargetId(result.targetId);
            setTestState({ status: 'done' });
        } catch (error) {
            setTestState({
                status: 'error',
                message:
                    error instanceof Error
                        ? error.message
                        : 'TrustGraph connection test failed.',
            });
        }
    };

    const handleLoadContext = async (): Promise<void> => {
        if (!selectedTarget || testedTargetId !== selectedTarget.id) return;
        setLoadState({ status: 'running' });
        try {
            const response = await fetch('/api/setup/repository-context/load', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    [SETUP_CSRF_HEADER_NAME]: csrfToken,
                },
                body: JSON.stringify({ targetId: selectedTarget.id }),
            });
            if (!response.ok) {
                throw new Error(await readErrorMessage(response));
            }
            const result =
                (await response.json()) as PostSetupRepositoryContextLoadResponse;
            setLoadState({ status: 'done', result });
        } catch (error) {
            setLoadState({
                status: 'error',
                message:
                    error instanceof Error
                        ? error.message
                        : 'Repository context load failed.',
            });
        }
    };

    return (
        <section
            className="setup-context"
            aria-labelledby="repository-context-heading"
        >
            <h2 id="repository-context-heading">Repository context</h2>
            <p>
                Review the files approved for this deployment before loading
                them into TrustGraph. File contents and connection credentials
                are not shown here.
            </p>

            <section
                className="setup-context__step"
                aria-labelledby="setup-context-connection-heading"
            >
                <h3 id="setup-context-connection-heading">
                    Connect TrustGraph
                </h3>
                {connection.status === 'loading' && (
                    <p role="status">Checking the configured connection…</p>
                )}
                {connection.status === 'error' && (
                    <div>
                        <p className="setup-error">{connection.message}</p>
                        <button
                            type="button"
                            onClick={() =>
                                setConnectionRetryKey((prior) => prior + 1)
                            }
                        >
                            Retry connection check
                        </button>
                    </div>
                )}
                {connection.status === 'ready' &&
                    !connection.value.configured && (
                        <p>
                            TrustGraph is not configured on this deployment. You
                            can review the approved files now; an operator must
                            configure TrustGraph before loading them.
                        </p>
                    )}
                {connection.status === 'ready' &&
                    connection.value.configured && (
                        <>
                            <label htmlFor="setup-trustgraph-target">
                                TrustGraph target
                            </label>
                            <select
                                id="setup-trustgraph-target"
                                value={targetId}
                                disabled={
                                    testState.status === 'running' ||
                                    loadState.status === 'running'
                                }
                                onChange={(event) => {
                                    setTargetId(event.target.value);
                                    setTestedTargetId(undefined);
                                    setTestState({ status: 'idle' });
                                    setLoadState({ status: 'idle' });
                                }}
                            >
                                {connection.value.targets.map((target) => (
                                    <option key={target.id} value={target.id}>
                                        {target.id}
                                    </option>
                                ))}
                            </select>
                            {selectedTarget && (
                                <p className="setup-note">
                                    {selectedTarget.collection} ·{' '}
                                    {selectedTarget.workspace}
                                </p>
                            )}
                            <div className="setup-actions">
                                <button
                                    type="button"
                                    disabled={
                                        testState.status === 'running' ||
                                        !selectedTarget
                                    }
                                    onClick={() => void handleTestConnection()}
                                >
                                    {testState.status === 'running'
                                        ? 'Testing connection…'
                                        : 'Test connection'}
                                </button>
                            </div>
                            {testState.status === 'done' && (
                                <p className="setup-note" role="status">
                                    Connection tested.
                                </p>
                            )}
                            {testState.status === 'error' && (
                                <p className="setup-error" role="alert">
                                    {testState.message}
                                </p>
                            )}
                        </>
                    )}
            </section>

            <section
                className="setup-context__step"
                aria-labelledby="setup-context-preview-heading"
            >
                <h3 id="setup-context-preview-heading">
                    Review selected files
                </h3>
                {preview.status === 'loading' && (
                    <p role="status">Loading the approved file preview…</p>
                )}
                {preview.status === 'error' && (
                    <div>
                        <p className="setup-error">{preview.message}</p>
                        <button
                            type="button"
                            onClick={() =>
                                setPreviewRetryKey((prior) => prior + 1)
                            }
                        >
                            Retry preview
                        </button>
                    </div>
                )}
                {preview.status === 'ready' && (
                    <>
                        <p>
                            {preview.value.fileCount}{' '}
                            {preview.value.fileCount === 1 ? 'file' : 'files'}
                            {' · '}
                            {formatBytes(preview.value.totalBytes)}
                        </p>
                        {preview.value.files.length > 0 ? (
                            <ul className="setup-context__files">
                                {preview.value.files.map((file) => (
                                    <li key={file.path}>
                                        <code>{file.path}</code>
                                        <span>
                                            {formatBytes(file.sizeBytes)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="setup-note">
                                No files are currently approved for repository
                                context.
                            </p>
                        )}
                        {preview.value.skipped.length > 0 && (
                            <details>
                                <summary>
                                    {preview.value.skipped.length} skipped{' '}
                                    {preview.value.skipped.length === 1
                                        ? 'file'
                                        : 'files'}
                                </summary>
                                <ul className="setup-context__skipped">
                                    {preview.value.skipped.map((file) => (
                                        <li key={file.path}>
                                            <code>{file.path}</code> —{' '}
                                            {file.reason}
                                        </li>
                                    ))}
                                </ul>
                            </details>
                        )}
                        <div className="setup-actions">
                            <button
                                type="button"
                                onClick={() =>
                                    setPreviewRetryKey((prior) => prior + 1)
                                }
                            >
                                Refresh preview
                            </button>
                        </div>
                        {connection.status === 'ready' &&
                            connection.value.configured && (
                                <div className="setup-actions">
                                    <button
                                        type="button"
                                        disabled={
                                            !selectedTarget ||
                                            testedTargetId !==
                                                selectedTarget.id ||
                                            loadState.status === 'running' ||
                                            loadState.status === 'done' ||
                                            preview.value.fileCount === 0
                                        }
                                        onClick={() => void handleLoadContext()}
                                    >
                                        {loadState.status === 'running'
                                            ? 'Loading context…'
                                            : 'Load context'}
                                    </button>
                                </div>
                            )}
                    </>
                )}
                {testState.status === 'done' &&
                    preview.status === 'ready' &&
                    preview.value.fileCount === 0 && (
                        <p className="setup-note">
                            There are no approved files to load.
                        </p>
                    )}
                {loadState.status === 'error' && (
                    <p className="setup-error" role="alert">
                        {loadState.message}
                    </p>
                )}
                {loadState.status === 'done' && (
                    <div className="setup-context__result" role="status">
                        <h4>
                            {loadState.result.counts.failed === 0
                                ? 'Repository context loaded.'
                                : 'Repository context load finished with failures.'}
                        </h4>
                        <dl>
                            <div>
                                <dt>Added</dt>
                                <dd>{loadState.result.counts.added}</dd>
                            </div>
                            <div>
                                <dt>Changed</dt>
                                <dd>{loadState.result.counts.changed}</dd>
                            </div>
                            <div>
                                <dt>Unchanged</dt>
                                <dd>{loadState.result.counts.unchanged}</dd>
                            </div>
                            <div>
                                <dt>Skipped</dt>
                                <dd>{loadState.result.counts.skipped}</dd>
                            </div>
                            <div>
                                <dt>Failed</dt>
                                <dd>{loadState.result.counts.failed}</dd>
                            </div>
                        </dl>
                        {loadState.result.items.length > 0 && (
                            <ul className="setup-context__files">
                                {loadState.result.items.map((item) => (
                                    <li key={`${item.path}-${item.status}`}>
                                        <span>
                                            <code>{item.path}</code> —{' '}
                                            {item.status}
                                        </span>
                                        {item.sizeBytes !== undefined && (
                                            <span>
                                                {formatBytes(item.sizeBytes)}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </section>
        </section>
    );
};

export default RepositoryContextSetup;
