/**
 * @description: Shows account sign-in availability, the current backend-owned session, logout, and account deletion.
 * @footnote-scope: web
 * @footnote-module: AccountPage
 * @footnote-risk: medium - State mistakes can misrepresent whether a user is signed in or signed out.
 * @footnote-ethics: high - Identity display and logout controls affect user privacy and account agency.
 */

import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ComponentRef,
    type FormEvent,
} from 'react';
import type {
    DiscordConnectionStateResponse,
    GetAccountIncidentsResponse,
    GetAuthSessionResponse,
} from '@footnote/contracts/web';
import PublicPageLayout from '@components/PublicPageLayout';
import { Link } from 'react-router-dom';
import {
    cancelDiscordConnection,
    consentDiscordConnection,
    exchangeDiscordConnection,
    getAuthSession,
    getAccountIncidents,
    getDiscordConnectionState,
    claimIncident,
    logoutAccount,
    deleteAccount,
} from '../utils/api';

type SessionState =
    | { status: 'loading' }
    | { status: 'ready'; session: GetAuthSessionResponse }
    | { status: 'error' };

type LogoutState = 'idle' | 'submitting' | 'error';
type DeletionState = 'idle' | 'submitting' | 'error' | 'success';
type AccountIncidentsState =
    | { status: 'loading'; accountKey: string | null }
    | {
          status: 'ready';
          accountKey: string | null;
          incidents: GetAccountIncidentsResponse['incidents'];
      }
    | { status: 'error'; accountKey: string };
type ConnectionState =
    | { status: 'loading' }
    | {
          status: 'ready';
          state: DiscordConnectionStateResponse['state'];
          code?: string;
      }
    | { status: 'error' };

const hasAuthFailureMarker = (): boolean =>
    new URLSearchParams(window.location.search).get('auth') === 'failed';

const clearAuthFailureMarker = (): void => {
    const url = new URL(window.location.href);
    url.searchParams.delete('auth');
    window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`
    );
};

const AccountPage = (): JSX.Element => {
    const [sessionState, setSessionState] = useState<SessionState>({
        status: 'loading',
    });
    const [reloadKey, setReloadKey] = useState(0);
    const [logoutState, setLogoutState] = useState<LogoutState>('idle');
    const [deletionState, setDeletionState] = useState<DeletionState>('idle');
    const [connectionState, setConnectionState] = useState<ConnectionState>({
        status: 'loading',
    });
    const [incidentsState, setIncidentsState] = useState<AccountIncidentsState>(
        { status: 'loading', accountKey: null }
    );
    const [claimCodeDraft, setClaimCodeDraft] = useState<{
        accountKey: string | null;
        value: string;
    }>({ accountKey: null, value: '' });
    const [claimMessageDraft, setClaimMessageDraft] = useState<{
        accountKey: string | null;
        value: string;
    }>({ accountKey: null, value: '' });
    const [incidentReloadKey, setIncidentReloadKey] = useState(0);
    const [selectedIncidentId, setSelectedIncidentId] = useState<{
        accountKey: string;
        incidentId: string;
    } | null>(null);
    const [showCallbackFailure] = useState(hasAuthFailureMarker);
    const accountStatusHeadingRef = useRef<ComponentRef<'h2'>>(null);
    const focusAfterLogoutRef = useRef(false);
    const connectionEffectStartedRef = useRef(false);
    const activeAccountKeyRef = useRef<string | null>(null);
    const accountKey =
        sessionState.status === 'ready' &&
        sessionState.session.enabled &&
        sessionState.session.authenticated
            ? `${sessionState.session.principal.issuer}\u0000${sessionState.session.principal.subject}`
            : null;

    useEffect(() => {
        if (showCallbackFailure) {
            clearAuthFailureMarker();
        }
    }, [showCallbackFailure]);

    useEffect(() => {
        const controller = new AbortController();
        setSessionState({ status: 'loading' });

        void getAuthSession(controller.signal)
            .then((session) => {
                if (!controller.signal.aborted) {
                    setSessionState({ status: 'ready', session });
                }
            })
            .catch(() => {
                if (!controller.signal.aborted) {
                    setSessionState({ status: 'error' });
                }
            });

        return (): void => {
            controller.abort();
        };
    }, [reloadKey]);

    useLayoutEffect(() => {
        const previousAccountKey = activeAccountKeyRef.current;
        activeAccountKeyRef.current = accountKey;
        if (previousAccountKey !== accountKey) {
            setClaimCodeDraft({ accountKey: null, value: '' });
            setClaimMessageDraft({ accountKey: null, value: '' });
            setSelectedIncidentId(null);
        }
    }, [accountKey]);

    useEffect(() => {
        if (accountKey === null) {
            setIncidentsState({
                status: 'ready',
                accountKey: null,
                incidents: [],
            });
            return;
        }
        const controller = new AbortController();
        setIncidentsState({ status: 'loading', accountKey });
        void getAccountIncidents(controller.signal)
            .then((result) => {
                if (
                    !controller.signal.aborted &&
                    activeAccountKeyRef.current === accountKey
                ) {
                    setIncidentsState({
                        status: 'ready',
                        accountKey,
                        incidents: result.incidents,
                    });
                }
            })
            .catch(() => {
                if (
                    !controller.signal.aborted &&
                    activeAccountKeyRef.current === accountKey
                ) {
                    setIncidentsState({ status: 'error', accountKey });
                }
            });
        return (): void => controller.abort();
    }, [accountKey, incidentReloadKey]);

    useEffect(() => {
        if (connectionEffectStartedRef.current) return;
        connectionEffectStartedRef.current = true;

        const fragment = new URLSearchParams(window.location.hash.slice(1));
        const capability = fragment.get('connect');
        if (capability) {
            window.history.replaceState(
                window.history.state,
                '',
                `${window.location.pathname}${window.location.search}`
            );
            void exchangeDiscordConnection(capability)
                .then((result) =>
                    setConnectionState({
                        status: 'ready',
                        state: result.state,
                        code: result.code,
                    })
                )
                .catch(() => setConnectionState({ status: 'error' }));
            return;
        }
        void getDiscordConnectionState()
            .then((result) =>
                setConnectionState({
                    status: 'ready',
                    state: result.state,
                    code: result.code,
                })
            )
            .catch(() => setConnectionState({ status: 'error' }));
    }, []);

    const handleDiscordConsent = async (csrfToken: string): Promise<void> => {
        try {
            const result = await consentDiscordConnection(csrfToken);
            setConnectionState({
                status: 'ready',
                state: 'waiting-for-discord-confirmation',
                code: result.code,
            });
        } catch {
            setConnectionState({ status: 'error' });
        }
    };

    const handleDiscordCancel = async (csrfToken: string): Promise<void> => {
        try {
            await cancelDiscordConnection(csrfToken);
            setConnectionState({ status: 'ready', state: 'none' });
        } catch {
            setConnectionState({ status: 'error' });
        }
    };

    useEffect(() => {
        if (focusAfterLogoutRef.current && sessionState.status === 'ready') {
            focusAfterLogoutRef.current = false;
            accountStatusHeadingRef.current?.focus();
        }
    }, [sessionState]);

    const handleLogout = async (
        session: Extract<
            GetAuthSessionResponse,
            { enabled: true; authenticated: true }
        >
    ): Promise<void> => {
        setLogoutState('submitting');
        setClaimCodeDraft({ accountKey: null, value: '' });
        setClaimMessageDraft({ accountKey: null, value: '' });
        setSelectedIncidentId(null);
        try {
            await logoutAccount(session.csrfToken);
            focusAfterLogoutRef.current = true;
            setSessionState({
                status: 'ready',
                session: {
                    enabled: true,
                    authenticated: false,
                },
            });
            setLogoutState('idle');
        } catch {
            setLogoutState('error');
        }
    };

    const handleDeleteAccount = async (
        session: Extract<
            GetAuthSessionResponse,
            { enabled: true; authenticated: true }
        >
    ): Promise<void> => {
        if (
            !window.confirm(
                'Permanently delete your Footnote account, its sign-in mappings, and its report links? Your external identity-provider accounts will not be changed.'
            )
        ) {
            return;
        }

        setDeletionState('submitting');
        try {
            await deleteAccount(session.csrfToken);
            setSessionState({
                status: 'ready',
                session: { enabled: true, authenticated: false },
            });
            setDeletionState('success');
        } catch {
            setSessionState({
                status: 'ready',
                session: { enabled: true, authenticated: false },
            });
            setDeletionState('error');
        }
    };

    const handleClaimIncident = async (
        event: FormEvent<HTMLFormElement>,
        session: Extract<
            GetAuthSessionResponse,
            { enabled: true; authenticated: true }
        >,
        submittedAccountKey: string
    ): Promise<void> => {
        event.preventDefault();
        const submittedCode =
            claimCodeDraft.accountKey === submittedAccountKey
                ? claimCodeDraft.value.trim()
                : '';
        setClaimMessageDraft({
            accountKey: submittedAccountKey,
            value: '',
        });
        try {
            await claimIncident(submittedCode, session.csrfToken);
            if (activeAccountKeyRef.current !== submittedAccountKey) return;
            setClaimCodeDraft({ accountKey: submittedAccountKey, value: '' });
            setClaimMessageDraft({
                accountKey: submittedAccountKey,
                value: 'Report added to your account.',
            });
            setIncidentReloadKey((value) => value + 1);
        } catch {
            if (activeAccountKeyRef.current !== submittedAccountKey) return;
            setClaimMessageDraft({
                accountKey: submittedAccountKey,
                value: 'That claim code is invalid or expired.',
            });
        }
    };

    const renderSessionState = (): JSX.Element => {
        if (sessionState.status === 'loading') {
            return (
                <p className="account-card__status" role="status">
                    Loading account…
                </p>
            );
        }

        if (sessionState.status === 'error') {
            return (
                <div className="account-card__stack">
                    <p className="account-card__error" role="alert">
                        Account status could not be loaded. Please try again.
                    </p>
                    <button
                        className="account-card__button"
                        type="button"
                        onClick={() => {
                            setReloadKey((value) => value + 1);
                        }}
                    >
                        Try again
                    </button>
                </div>
            );
        }

        if (!sessionState.session.enabled) {
            return (
                <div className="account-card__stack">
                    <h2
                        id="account-status-heading"
                        ref={accountStatusHeadingRef}
                        tabIndex={-1}
                    >
                        Sign-in is unavailable
                    </h2>
                    <p>
                        This Footnote instance has not enabled account sign-in.
                        Public Footnote features remain available.
                    </p>
                </div>
            );
        }

        if (!sessionState.session.authenticated) {
            return (
                <div className="account-card__stack">
                    <h2
                        id="account-status-heading"
                        ref={accountStatusHeadingRef}
                        tabIndex={-1}
                    >
                        Signed out
                    </h2>
                    <p>
                        Sign in through the identity provider configured by this
                        Footnote instance.
                    </p>
                    <a
                        className="account-card__button account-card__button--primary"
                        href="/api/auth/login"
                    >
                        Sign in
                    </a>
                </div>
            );
        }

        const authenticatedSession = sessionState.session;
        const { principal, expiresAt } = authenticatedSession;
        const displayIdentity = principal.displayName ?? principal.subject;

        return (
            <div className="account-card__stack">
                <h2
                    id="account-status-heading"
                    ref={accountStatusHeadingRef}
                    tabIndex={-1}
                >
                    Signed in
                </h2>
                <dl className="account-card__identity">
                    <div>
                        <dt>Account</dt>
                        <dd>{displayIdentity}</dd>
                    </div>
                    <div>
                        <dt>Subject</dt>
                        <dd>{principal.subject}</dd>
                    </div>
                    <div>
                        <dt>Issuer</dt>
                        <dd>{principal.issuer}</dd>
                    </div>
                    <div>
                        <dt>Session expires</dt>
                        <dd>
                            <time dateTime={expiresAt}>
                                {new Date(expiresAt).toLocaleString()}
                            </time>
                        </dd>
                    </div>
                </dl>
                <p className="account-card__note">
                    Signing out ends only this Footnote session. It does not
                    sign you out of your identity provider.
                </p>
                {authenticatedSession.isAdministrator ? (
                    <Link
                        className="account-card__button account-card__button--primary"
                        to="/admin"
                    >
                        Open administrator settings
                    </Link>
                ) : null}
                <button
                    className="account-card__button"
                    type="button"
                    disabled={logoutState === 'submitting'}
                    onClick={() => {
                        void handleLogout(authenticatedSession);
                    }}
                >
                    {logoutState === 'submitting' ? 'Signing out…' : 'Sign out'}
                </button>
                {logoutState === 'error' ? (
                    <p className="account-card__error" role="alert">
                        Sign-out could not be completed. Please try again.
                    </p>
                ) : null}
                {deletionState === 'error' ? (
                    <p className="account-card__error" role="alert">
                        Account deletion could not finish. Sign in again and
                        retry.
                    </p>
                ) : null}
                <button
                    className="account-card__button"
                    type="button"
                    disabled={deletionState === 'submitting'}
                    onClick={() => {
                        void handleDeleteAccount(authenticatedSession);
                    }}
                >
                    {deletionState === 'submitting'
                        ? 'Deleting account…'
                        : 'Delete Footnote account'}
                </button>
            </div>
        );
    };

    const renderDiscordConnection = (): JSX.Element | null => {
        if (
            connectionState.status === 'loading' ||
            (connectionState.status === 'ready' &&
                connectionState.state === 'none')
        )
            return null;
        if (connectionState.status === 'error')
            return (
                <p className="account-card__error" role="alert">
                    Discord connection could not be loaded or completed. Start
                    again from Discord.
                </p>
            );
        if (connectionState.state === 'expired')
            return (
                <p className="account-card__error" role="alert">
                    This Discord connection expired or was cancelled. Start
                    again with <code>/account connect</code>.
                </p>
            );
        if (connectionState.state === 'waiting-for-discord-confirmation')
            return (
                <output className="account-card__status">
                    Run{' '}
                    <code>/account confirm code:{connectionState.code}</code> in
                    the Discord account that started this request.
                </output>
            );
        if (
            sessionState.status !== 'ready' ||
            !sessionState.session.enabled ||
            !sessionState.session.authenticated
        ) {
            return (
                <div className="account-card__stack">
                    <output>
                        Sign in to the Footnote account you want to connect.
                    </output>
                    <a
                        className="account-card__button account-card__button--primary"
                        href="/api/auth/login"
                    >
                        Sign in
                    </a>
                </div>
            );
        }
        const csrfToken = sessionState.session.csrfToken;
        return (
            <div className="account-card__stack">
                <p>Connect your Discord account to this Footnote account?</p>
                <button
                    className="account-card__button account-card__button--primary"
                    type="button"
                    onClick={() => void handleDiscordConsent(csrfToken)}
                >
                    Approve connection
                </button>
                <button
                    className="account-card__button"
                    type="button"
                    onClick={() => void handleDiscordCancel(csrfToken)}
                >
                    Cancel connection
                </button>
            </div>
        );
    };

    const renderAccountIncidents = (): JSX.Element | null => {
        if (sessionState.status !== 'ready' || !sessionState.session.enabled) {
            return null;
        }
        if (!sessionState.session.authenticated) {
            return (
                <section
                    className="account-card account-card__stack"
                    aria-labelledby="account-incidents-heading"
                >
                    <h2 id="account-incidents-heading">Your reports</h2>
                    <p>
                        Sign in to add a report to your account or check its
                        status.
                    </p>
                    <a
                        className="account-card__button account-card__button--primary"
                        href="/api/auth/login"
                    >
                        Sign in
                    </a>
                </section>
            );
        }
        const session = sessionState.session;
        const sessionAccountKey = `${session.principal.issuer}\u0000${session.principal.subject}`;
        const currentIncidentsState =
            incidentsState.accountKey === sessionAccountKey
                ? incidentsState
                : { status: 'loading' as const, accountKey: sessionAccountKey };
        const claimCode =
            claimCodeDraft.accountKey === sessionAccountKey
                ? claimCodeDraft.value
                : '';
        const claimMessage =
            claimMessageDraft.accountKey === sessionAccountKey
                ? claimMessageDraft.value
                : '';
        const selectedIncident =
            currentIncidentsState.status === 'ready'
                ? currentIncidentsState.incidents.find(
                      (incident) =>
                          selectedIncidentId?.accountKey ===
                              sessionAccountKey &&
                          incident.incidentId === selectedIncidentId.incidentId
                  )
                : undefined;
        return (
            <section
                className="account-card account-card__stack"
                aria-labelledby="account-incidents-heading"
            >
                <h2 id="account-incidents-heading">Your reports</h2>
                <p>Enter the claim code shown after you submitted a report.</p>
                <form
                    onSubmit={(event) =>
                        void handleClaimIncident(
                            event,
                            session,
                            sessionAccountKey
                        )
                    }
                >
                    <label htmlFor="incident-claim-code">Claim code</label>
                    <input
                        id="incident-claim-code"
                        autoComplete="off"
                        value={claimCode}
                        onChange={(event) =>
                            setClaimCodeDraft({
                                accountKey: sessionAccountKey,
                                value: event.target.value,
                            })
                        }
                    />
                    <button
                        className="account-card__button account-card__button--primary"
                        type="submit"
                        disabled={!claimCode.trim()}
                    >
                        Add report
                    </button>
                </form>
                {claimMessage ? <p role="status">{claimMessage}</p> : null}
                {currentIncidentsState.status === 'loading' ? (
                    <p role="status">Loading reports…</p>
                ) : null}
                {currentIncidentsState.status === 'error' ? (
                    <p className="account-card__error" role="alert">
                        Reports could not be loaded. Please try again.
                    </p>
                ) : null}
                {currentIncidentsState.status === 'ready' &&
                currentIncidentsState.incidents.length === 0 ? (
                    <p>No reports are linked to this account.</p>
                ) : null}
                {currentIncidentsState.status === 'ready' &&
                currentIncidentsState.incidents.length > 0 ? (
                    <ul>
                        {currentIncidentsState.incidents.map((incident) => (
                            <li key={incident.incidentId}>
                                <button
                                    className="account-card__button"
                                    type="button"
                                    onClick={() =>
                                        setSelectedIncidentId({
                                            accountKey: sessionAccountKey,
                                            incidentId: incident.incidentId,
                                        })
                                    }
                                >
                                    View report {incident.incidentId}
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : null}
                {selectedIncident ? (
                    <article
                        aria-label={`Report ${selectedIncident.incidentId}`}
                    >
                        <h3>Report {selectedIncident.incidentId}</h3>
                        <p>
                            Status:{' '}
                            {selectedIncident.status.replaceAll('_', ' ')}
                        </p>
                        <p>
                            Submitted{' '}
                            <time dateTime={selectedIncident.createdAt}>
                                {new Date(
                                    selectedIncident.createdAt
                                ).toLocaleString()}
                            </time>
                        </p>
                        <p>
                            Updated{' '}
                            <time dateTime={selectedIncident.updatedAt}>
                                {new Date(
                                    selectedIncident.updatedAt
                                ).toLocaleString()}
                            </time>
                        </p>
                    </article>
                ) : null}
            </section>
        );
    };

    return (
        <PublicPageLayout>
            <main id="main-content" className="public-page__main account-page">
                <section
                    className="public-page__intro"
                    aria-labelledby="account-page-title"
                >
                    <h1 id="account-page-title">Account</h1>
                    <p className="public-page__lede">
                        View the local session for this Footnote instance.
                    </p>
                    {showCallbackFailure ? (
                        <p className="account-page__notice" role="alert">
                            Sign-in could not be completed. Please try again.
                        </p>
                    ) : null}
                    <div className="account-card" aria-live="polite">
                        {deletionState === 'success' ? (
                            <p className="account-card__status" role="status">
                                Your Footnote account has been deleted. Your
                                external sign-in accounts were not changed.
                                Incident reports are managed separately.
                            </p>
                        ) : null}
                        {renderSessionState()}
                    </div>
                    {renderAccountIncidents()}
                    {connectionState.status === 'ready' &&
                    connectionState.state === 'none' ? null : (
                        <section
                            className="account-card account-card__stack"
                            aria-labelledby="discord-connection-heading"
                        >
                            <h2 id="discord-connection-heading">
                                Discord account connection
                            </h2>
                            {renderDiscordConnection()}
                        </section>
                    )}
                </section>
            </main>
        </PublicPageLayout>
    );
};

export default AccountPage;
