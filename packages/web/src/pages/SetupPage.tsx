/**
 * @description: First-setup page for bootstrapping footnote.yaml when missing and saving validated YAML through backend-owned admin routes.
 * @footnote-scope: web
 * @footnote-module: SetupPage
 * @footnote-risk: high - Setup-flow mistakes can prevent initial configuration or cause invalid privileged writes.
 * @footnote-ethics: high - First-run setup UX governs operator control over governance-sensitive system settings.
 */

import { useEffect, useMemo, useState } from 'react';
import type {
    AdminSettingsValidationError,
    PostSetupSessionResponse,
} from '@footnote/contracts/web';
import Header from '@components/Header';
import Footer from '@components/Footer';
import { parseSetupCodeFromHash } from '../utils/setupFlow';

const MISSING_SETTINGS_SENTINEL = '"footnote-settings-missing"';

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

const SetupPage = (): JSX.Element => {
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
    const [validationErrors, setValidationErrors] = useState<
        AdminSettingsValidationError[]
    >([]);
    const [validateMessage, setValidateMessage] = useState<string | null>(null);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [validating, setValidating] = useState(false);

    useEffect(() => {
        if (!setupCode) {
            setExchangeState({
                status: 'error',
                message:
                    'Setup code is missing. Re-run `footnote setup` to generate a new setup link.',
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
    }, [setupCode]);

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
                const templateEtag = templateResponse.headers.get('etag');
                if (templateText.trim().length === 0) {
                    setYamlError(
                        'Settings template response was empty. Retry loading setup.'
                    );
                    return;
                }
                if (!cancelled) {
                    setIfMatch(
                        typeof templateEtag === 'string' &&
                            templateEtag.length > 0
                            ? templateEtag
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

    const handleValidate = async (): Promise<void> => {
        if (exchangeState.status !== 'ready' || yamlState.status !== 'ready') {
            return;
        }
        setValidating(true);
        setValidateMessage(null);
        setSaveMessage(null);
        setValidationErrors([]);
        try {
            const response = await fetch('/api/admin/settings/validate', {
                method: 'POST',
                headers: {
                    'content-type': 'text/yaml',
                    'x-setup-csrf': exchangeState.csrfToken,
                },
                body: yamlText,
            });
            if (response.status === 400) {
                const payload = (await response.json()) as {
                    validationErrors?: AdminSettingsValidationError[];
                };
                setValidationErrors(payload.validationErrors ?? []);
                setValidateMessage('Validation failed. Fix the listed issues.');
                return;
            }
            if (!response.ok) {
                setValidateMessage(await readErrorMessage(response));
                return;
            }
            setValidateMessage('YAML is valid. You can save settings now.');
        } catch (error) {
            setValidationErrors([]);
            setValidateMessage(
                error instanceof Error
                    ? `Validation request failed: ${error.message}`
                    : 'Validation request failed due to a network or parse error.'
            );
        } finally {
            setValidating(false);
        }
    };

    const handleSave = async (): Promise<void> => {
        if (exchangeState.status !== 'ready' || yamlState.status !== 'ready') {
            return;
        }
        setSaving(true);
        setSaveMessage(null);
        setValidateMessage(null);
        setValidationErrors([]);
        try {
            const response = await fetch('/api/admin/settings.yaml', {
                method: 'PUT',
                headers: {
                    'content-type': 'text/yaml',
                    'x-setup-csrf': exchangeState.csrfToken,
                    'if-match': ifMatch,
                },
                body: yamlText,
            });
            if (response.status === 400) {
                const payload = (await response.json()) as {
                    validationErrors?: AdminSettingsValidationError[];
                };
                setValidationErrors(payload.validationErrors ?? []);
                setSaveMessage('Save failed because YAML is invalid.');
                return;
            }
            if (response.status === 412) {
                setSaveMessage(
                    'Save failed because the optimistic lock is stale. Reload setup and try again.'
                );
                return;
            }
            if (!response.ok) {
                setSaveMessage(await readErrorMessage(response));
                return;
            }
            const payload = (await response.json()) as { etag?: unknown };
            if (typeof payload.etag === 'string' && payload.etag.length > 0) {
                setIfMatch(payload.etag);
            }
            setSaveMessage('Settings saved. Restart Footnote to use them.');
        } catch (error) {
            setValidationErrors([]);
            setSaveMessage(
                error instanceof Error
                    ? `Save request failed: ${error.message}`
                    : 'Save request failed due to a network or parse error.'
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <Header />
            <main className="page-content" id="main-content">
                <section className="page-hero" aria-labelledby="setup-title">
                    <h1 id="setup-title">First setup</h1>
                    <p className="page-hero__summary">
                        Configure <code>footnote.yaml</code>, validate it, then
                        save. Settings are not applied until Footnote restarts.
                    </p>
                </section>

                <section className="setup-panel" aria-live="polite">
                    {exchangeState.status === 'loading' && (
                        <p>Exchanging setup code...</p>
                    )}
                    {exchangeState.status === 'error' && (
                        <p className="setup-error">{exchangeState.message}</p>
                    )}
                    {exchangeState.status === 'ready' && (
                        <p className="setup-note">
                            Setup session is active until{' '}
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
                                    onClick={() => void handleValidate()}
                                    disabled={validating || saving}
                                >
                                    {validating ? 'Validating...' : 'Validate'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void handleSave()}
                                    disabled={validating || saving}
                                >
                                    {saving ? 'Saving...' : 'Save settings'}
                                </button>
                            </div>

                            {validateMessage && (
                                <p className="setup-note">{validateMessage}</p>
                            )}
                            {saveMessage && (
                                <p className="setup-note">{saveMessage}</p>
                            )}
                            {validationErrors.length > 0 && (
                                <ul className="setup-errors">
                                    {validationErrors.map((error, index) => (
                                        <li
                                            key={`${error.category}-${error.pointer ?? 'root'}-${index}`}
                                        >
                                            <strong>{error.category}</strong>{' '}
                                            {error.pointer
                                                ? `[${error.pointer}] `
                                                : ''}
                                            {error.message}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    )}
            </main>
            <Footer />
        </>
    );
};

export default SetupPage;
