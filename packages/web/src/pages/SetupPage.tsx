/**
 * @description: Shared settings editor for setup/recovery sessions and signed-in administrator sessions.
 * @footnote-scope: web
 * @footnote-module: SetupPage
 * @footnote-risk: high - Setup-flow mistakes can prevent initial configuration or cause invalid privileged writes.
 * @footnote-ethics: high - First-run setup UX governs operator control over governance-sensitive system settings.
 */

import { useEffect, useMemo, useState } from 'react';
import type {
    AdminSettingsValidationError,
    AdminSettingsValidationFailureResponse,
    PostAdminSettingsValidateResponse,
    PostSetupSessionResponse,
    PutAdminSettingsYamlResponse,
} from '@footnote/contracts/web';
import PublicPageLayout from '@components/PublicPageLayout';
import { parseSetupCodeFromHash } from '../utils/setupFlow';
import { getAuthSession } from '../utils/api';

const MISSING_SETTINGS_SENTINEL = '"footnote-settings-missing"';
const SETUP_CSRF_HEADER_NAME = 'x-setup-csrf';
const ACCOUNT_CSRF_HEADER_NAME = 'x-auth-csrf';

type ExchangeState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; csrfToken: string; expiresAt: string }
    | { status: 'error'; message: string };

type LoadYamlState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready' }
    | { status: 'error'; message: string };

type YamlNoticeState = {
    message: string;
    kind: 'info' | 'warning';
};

type SubmitStatusState =
    | { kind: 'idle' }
    | { kind: 'submitting' }
    | { kind: 'error'; message: string }
    | { kind: 'success'; message: string };

type SubmitFeedbackState = {
    validationErrors: AdminSettingsValidationError[];
    validationWarnings: string[];
    status: SubmitStatusState;
};

export type SettingsPageMode = 'setup' | 'admin';

type SetupPageProps = {
    mode?: SettingsPageMode;
};

const INITIAL_SUBMIT_FEEDBACK: SubmitFeedbackState = {
    validationErrors: [],
    validationWarnings: [],
    status: { kind: 'idle' },
};

const readErrorMessage = async (response: Response): Promise<string> => {
    try {
        const payload = (await response.json()) as {
            error?: unknown;
            details?: unknown;
        };
        if (typeof payload.error === 'string' && payload.error.length > 0) {
            return payload.error;
        }
        if (typeof payload.details === 'string' && payload.details.length > 0) {
            return payload.details;
        }
    } catch {
        // Ignore and fall through to status-only message.
    }
    return `Request failed with status ${response.status}`;
};

const SetupPage = ({ mode = 'setup' }: SetupPageProps): JSX.Element => {
    const isAdministratorMode = mode === 'admin';
    const setupCode = useMemo(
        () => parseSetupCodeFromHash(window.location.hash),
        []
    );
    const [exchangeState, setExchangeState] = useState<ExchangeState>({
        status: 'idle',
    });
    const [yamlState, setYamlState] = useState<LoadYamlState>({
        status: 'idle',
    });
    const [yamlText, setYamlText] = useState<string>('');
    const [ifMatch, setIfMatch] = useState<string>(MISSING_SETTINGS_SENTINEL);
    const [yamlRetryKey, setYamlRetryKey] = useState(0);
    const [yamlNotice, setYamlNotice] = useState<YamlNoticeState | null>(null);
    const [submitFeedback, setSubmitFeedback] = useState<SubmitFeedbackState>(
        INITIAL_SUBMIT_FEEDBACK
    );

    useEffect(() => {
        if (isAdministratorMode) {
            let cancelled = false;
            setExchangeState({ status: 'loading' });
            void getAuthSession()
                .then((session) => {
                    if (cancelled) {
                        return;
                    }
                    if (!session.enabled) {
                        setExchangeState({
                            status: 'error',
                            message:
                                'Administrator sign-in is unavailable. Public Footnote remains available.',
                        });
                        return;
                    }
                    if (!session.authenticated) {
                        setExchangeState({
                            status: 'error',
                            message:
                                'Sign in to an administrator account before opening Footnote settings.',
                        });
                        return;
                    }
                    setExchangeState({
                        status: 'ready',
                        csrfToken: session.csrfToken,
                        expiresAt: session.expiresAt,
                    });
                })
                .catch((error: unknown) => {
                    if (!cancelled) {
                        setExchangeState({
                            status: 'error',
                            message:
                                error instanceof Error
                                    ? error.message
                                    : 'Administrator session could not be loaded.',
                        });
                    }
                });

            return (): void => {
                cancelled = true;
            };
        }

        if (!setupCode) {
            setExchangeState({
                status: 'error',
                message:
                    'Setup code is missing. Run `pnpm settings` to generate a new settings link.',
            });
            return;
        }

        let cancelled = false;
        setExchangeState({ status: 'loading' });
        void (async () => {
            const response = await fetch('/api/setup/session', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ code: setupCode }),
            });
            if (!response.ok) {
                const message = await readErrorMessage(response);
                if (!cancelled) {
                    setExchangeState({
                        status: 'error',
                        message,
                    });
                }
                return;
            }
            const payload = (await response.json()) as PostSetupSessionResponse;
            if (!cancelled) {
                setExchangeState({
                    status: 'ready',
                    csrfToken: payload.csrfToken,
                    expiresAt: payload.expiresAt,
                });
            }
        })().catch((error) => {
            if (!cancelled) {
                setExchangeState({
                    status: 'error',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Setup session exchange failed.',
                });
            }
        });

        return () => {
            cancelled = true;
        };
    }, [isAdministratorMode, setupCode]);

    useEffect(() => {
        if (exchangeState.status !== 'ready') {
            return;
        }
        let cancelled = false;
        setYamlState({ status: 'loading' });
        setYamlNotice(null);
        const setYamlError = (message: string): void => {
            if (cancelled) {
                return;
            }
            setYamlState({ status: 'error', message });
        };
        void (async () => {
            const response = await fetch('/api/admin/settings.yaml', {
                method: 'GET',
            });
            if (response.status === 404) {
                const templateResponse = await fetch(
                    '/api/admin/settings/template',
                    {
                        method: 'GET',
                    }
                );
                if (!templateResponse.ok) {
                    setYamlError(await readErrorMessage(templateResponse));
                    return;
                }
                const templateText = await templateResponse.text();
                if (templateText.trim().length === 0) {
                    setYamlError(
                        'Settings template response was empty. Retry loading setup.'
                    );
                    return;
                }
                if (!cancelled) {
                    setIfMatch(MISSING_SETTINGS_SENTINEL);
                    setYamlText(templateText);
                    setYamlState({ status: 'ready' });
                }
                return;
            }
            if (!response.ok) {
                setYamlError(await readErrorMessage(response));
                return;
            }
            const settingsEtag = response.headers.get('etag');
            const body = await response.text();
            if (body.trim().length === 0) {
                const templateResponse = await fetch(
                    '/api/admin/settings/template',
                    {
                        method: 'GET',
                    }
                );
                if (!templateResponse.ok) {
                    setYamlError(await readErrorMessage(templateResponse));
                    return;
                }
                const templateText = await templateResponse.text();
                if (templateText.trim().length === 0) {
                    setYamlError(
                        'Settings template response was empty. Retry loading setup.'
                    );
                    return;
                }
                if (!cancelled) {
                    setIfMatch(
                        typeof settingsEtag === 'string' &&
                            settingsEtag.length > 0
                            ? settingsEtag
                            : MISSING_SETTINGS_SENTINEL
                    );
                    setYamlText(templateText);
                    setYamlNotice({
                        message:
                            'Settings file is empty. Loaded canonical template so you can edit and save.',
                        kind: 'warning',
                    });
                    setYamlState({ status: 'ready' });
                }
                return;
            }
            const etag = response.headers.get('etag');
            if (!cancelled) {
                setYamlText(body);
                setIfMatch(
                    typeof etag === 'string' && etag.length > 0
                        ? etag
                        : MISSING_SETTINGS_SENTINEL
                );
                setYamlState({ status: 'ready' });
            }
        })().catch((error) => {
            setYamlError(
                error instanceof Error
                    ? error.message
                    : 'Failed to load settings YAML.'
            );
        });

        return () => {
            cancelled = true;
        };
    }, [exchangeState, yamlRetryKey]);

    const handleSave = async (): Promise<void> => {
        if (exchangeState.status !== 'ready' || yamlState.status !== 'ready') {
            return;
        }
        setSubmitFeedback((prior) => ({
            ...prior,
            status: { kind: 'submitting' },
        }));
        try {
            const csrfHeaderName = isAdministratorMode
                ? ACCOUNT_CSRF_HEADER_NAME
                : SETUP_CSRF_HEADER_NAME;
            const validateResponse = await fetch(
                '/api/admin/settings/validate',
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'text/yaml',
                        [csrfHeaderName]: exchangeState.csrfToken,
                    },
                    body: yamlText,
                }
            );
            if (validateResponse.status === 400) {
                const payload =
                    (await validateResponse.json()) as AdminSettingsValidationFailureResponse;
                setSubmitFeedback({
                    validationErrors: payload.validationErrors,
                    validationWarnings: [],
                    status: {
                        kind: 'error',
                        message: 'Validation failed. Fix the listed issues.',
                    },
                });
                return;
            }
            if (!validateResponse.ok) {
                const message = await readErrorMessage(validateResponse);
                setSubmitFeedback((prior) => ({
                    ...prior,
                    status: { kind: 'error', message },
                }));
                return;
            }

            const validatePayload =
                (await validateResponse.json()) as PostAdminSettingsValidateResponse;
            const validationWarnings = validatePayload.warnings;

            const response = await fetch('/api/admin/settings.yaml', {
                method: 'PUT',
                headers: {
                    'content-type': 'text/yaml',
                    [csrfHeaderName]: exchangeState.csrfToken,
                    'if-match': ifMatch,
                },
                body: yamlText,
            });
            if (response.status === 400) {
                const payload =
                    (await response.json()) as AdminSettingsValidationFailureResponse;
                setSubmitFeedback({
                    validationErrors: payload.validationErrors,
                    validationWarnings,
                    status: {
                        kind: 'error',
                        message: 'Save failed because YAML is invalid.',
                    },
                });
                return;
            }
            if (response.status === 412) {
                setSubmitFeedback((prior) => ({
                    ...prior,
                    validationWarnings,
                    status: {
                        kind: 'error',
                        message:
                            'Save failed because the optimistic lock is stale. Reload setup and try again.',
                    },
                }));
                return;
            }
            if (!response.ok) {
                const message = await readErrorMessage(response);
                setSubmitFeedback((prior) => ({
                    ...prior,
                    validationWarnings,
                    status: { kind: 'error', message },
                }));
                return;
            }
            const payload =
                (await response.json()) as PutAdminSettingsYamlResponse;
            if (payload.etag.length > 0) {
                setIfMatch(payload.etag);
            }
            setSubmitFeedback({
                validationErrors: [],
                validationWarnings: [],
                status: {
                    kind: 'success',
                    message: 'Settings saved. Restart Footnote to use them.',
                },
            });
        } catch (error) {
            const message =
                error instanceof Error
                    ? `Save request failed: ${error.message}`
                    : 'Save request failed due to a network or parse error.';
            setSubmitFeedback((prior) => ({
                ...prior,
                status: { kind: 'error', message },
            }));
        }
    };

    return (
        <PublicPageLayout>
            <main className="public-page__main" id="main-content">
                <section
                    className="public-page__intro"
                    aria-labelledby="setup-title"
                >
                    <h1 id="setup-title">
                        {isAdministratorMode
                            ? 'Administrator settings'
                            : 'Settings'}
                    </h1>
                    <p className="public-page__lede">
                        Edit <code>footnote.yaml</code> and save. Settings are
                        not applied until Footnote restarts.
                    </p>
                </section>

                <section className="setup-panel" aria-live="polite">
                    {exchangeState.status === 'loading' && (
                        <p>
                            {isAdministratorMode
                                ? 'Checking administrator session...'
                                : 'Exchanging setup code...'}
                        </p>
                    )}
                    {exchangeState.status === 'error' && (
                        <p className="setup-error">{exchangeState.message}</p>
                    )}
                    {exchangeState.status === 'ready' && (
                        <p className="setup-note">
                            {isAdministratorMode
                                ? 'Administrator session is active until '
                                : 'Setup session is active until '}
                            {exchangeState.expiresAt}.
                        </p>
                    )}
                    {yamlNotice && (
                        <p className="setup-note">{yamlNotice.message}</p>
                    )}
                    {yamlState.status === 'loading' && (
                        <p>Loading settings...</p>
                    )}
                    {yamlState.status === 'error' && (
                        <>
                            <p className="setup-error">{yamlState.message}</p>
                            <div className="setup-actions">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setYamlRetryKey((prior) => prior + 1)
                                    }
                                >
                                    Retry loading settings
                                </button>
                            </div>
                        </>
                    )}
                </section>

                {exchangeState.status === 'ready' &&
                    yamlState.status === 'ready' && (
                        <section
                            className="setup-editor"
                            aria-labelledby="setup-yaml-title"
                        >
                            <h2 id="setup-yaml-title">Settings YAML</h2>
                            <details open className="setup-editor-disclosure">
                                <summary>Settings YAML editor</summary>
                                <div className="setup-editor-disclosure__content">
                                    <textarea
                                        className="setup-textarea"
                                        value={yamlText}
                                        onChange={(event) =>
                                            setYamlText(event.target.value)
                                        }
                                        spellCheck={false}
                                        rows={22}
                                    />
                                    <div className="setup-actions">
                                        <button
                                            type="button"
                                            onClick={() => void handleSave()}
                                            disabled={
                                                submitFeedback.status.kind ===
                                                'submitting'
                                            }
                                        >
                                            {submitFeedback.status.kind ===
                                            'submitting'
                                                ? 'Saving...'
                                                : 'Save settings'}
                                        </button>
                                    </div>

                                    <div
                                        className="setup-submit-feedback"
                                        aria-live="polite"
                                    >
                                        {submitFeedback.status.kind ===
                                            'error' && (
                                            <p className="setup-error">
                                                {submitFeedback.status.message}
                                            </p>
                                        )}
                                        {submitFeedback.status.kind ===
                                            'success' && (
                                            <p className="setup-note">
                                                {submitFeedback.status.message}
                                            </p>
                                        )}
                                        {submitFeedback.validationWarnings
                                            .length > 0 && (
                                            <ul className="setup-warnings">
                                                {submitFeedback.validationWarnings.map(
                                                    (warning, index) => (
                                                        <li
                                                            key={`${warning}-${index}`}
                                                        >
                                                            {warning}
                                                        </li>
                                                    )
                                                )}
                                            </ul>
                                        )}
                                        {submitFeedback.validationErrors
                                            .length > 0 && (
                                            <ul className="setup-errors">
                                                {submitFeedback.validationErrors.map(
                                                    (error, index) => (
                                                        <li
                                                            key={`${error.category}-${error.pointer ?? 'root'}-${index}`}
                                                        >
                                                            <strong>
                                                                {error.category}
                                                            </strong>{' '}
                                                            {error.pointer
                                                                ? `[${error.pointer}] `
                                                                : ''}
                                                            {error.message}
                                                        </li>
                                                    )
                                                )}
                                            </ul>
                                        )}
                                    </div>
                                </div>
                            </details>
                        </section>
                    )}
            </main>
        </PublicPageLayout>
    );
};

export default SetupPage;
