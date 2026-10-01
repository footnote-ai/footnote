/**
 * @description: Lets people manage account sign-in, memories, reports, connections, and account data.
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
    AccountMemory,
    GetAuthSessionResponse,
} from '@footnote/contracts/web';
import PublicPageLayout from '@components/PublicPageLayout';
import AccountIcon from '@components/AccountIcon';
import MemorySection, { type MemoryReadState } from '@components/MemorySection';
import ReportsSection from '@components/ReportsSection';
import { Link } from 'react-router-dom';
import {
    cancelDiscordConnection,
    consentDiscordConnection,
    exchangeDiscordConnection,
    getAuthSession,
    getAccountIncidents,
    getAccountMemories,
    addAccountMemory,
    updateAccountMemory,
    forgetAccountMemory,
    getDiscordConnectionState,
    getAccountDiscordStatus,
    disconnectAccountDiscord,
    claimIncident,
    logoutAccount,
    deleteAccount,
    isApiClientError,
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
type AccountDiscordState =
    | { status: 'loading'; accountKey: string | null }
    | { status: 'error'; accountKey: string }
    | {
          status: 'ready';
          accountKey: string;
          connected: boolean;
          discordUserIds: string[];
          disconnecting: boolean;
          disconnectError: boolean;
      };

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
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    const [connectionState, setConnectionState] = useState<ConnectionState>({
        status: 'loading',
    });
    const [accountDiscordState, setAccountDiscordState] =
        useState<AccountDiscordState>({
            status: 'loading',
            accountKey: null,
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
    const [memories, setMemories] = useState<AccountMemory[]>([]);
    const [memoryReadState, setMemoryReadState] =
        useState<MemoryReadState>('loading');
    const [memoryReloadKey, setMemoryReloadKey] = useState(0);
    const [memoryWriteError, setMemoryWriteError] = useState<
        'save' | 'edit' | 'forget' | 'limit' | null
    >(null);
    const [memoryBusy, setMemoryBusy] = useState(false);
    const [showCallbackFailure] = useState(hasAuthFailureMarker);
    const accountTitleRef = useRef<ComponentRef<'h1'>>(null);
    const deleteConfirmationHeadingRef = useRef<ComponentRef<'h3'>>(null);
    const deleteAccountTriggerRef = useRef<ComponentRef<'button'>>(null);
    const focusAfterLogoutRef = useRef(false);
    const focusAfterDeleteCancelRef = useRef(false);
    const deletionRequestInFlightRef = useRef(false);
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
            setMemories([]);
            setMemoryReadState('loading');
            setMemoryWriteError(null);
            setMemoryBusy(false);
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
        if (accountKey === null) {
            setMemories([]);
            setMemoryReadState('ready');
            return;
        }
        const controller = new AbortController();
        setMemoryReadState('loading');
        void getAccountMemories(controller.signal)
            .then(({ memories: result }) => {
                if (
                    !controller.signal.aborted &&
                    activeAccountKeyRef.current === accountKey
                )
                    setMemories(result);
                if (
                    !controller.signal.aborted &&
                    activeAccountKeyRef.current === accountKey
                )
                    setMemoryReadState('ready');
            })
            .catch(() => {
                if (
                    !controller.signal.aborted &&
                    activeAccountKeyRef.current === accountKey
                )
                    setMemoryReadState('error');
            });
        return (): void => controller.abort();
    }, [accountKey, memoryReloadKey]);

    useEffect(() => {
        if (accountKey === null) {
            setAccountDiscordState({ status: 'loading', accountKey: null });
            return;
        }
        const controller = new AbortController();
        setAccountDiscordState({ status: 'loading', accountKey });
        void getAccountDiscordStatus(controller.signal)
            .then(({ connected, discordUserIds }) => {
                if (
                    !controller.signal.aborted &&
                    activeAccountKeyRef.current === accountKey
                ) {
                    setAccountDiscordState({
                        status: 'ready',
                        accountKey,
                        connected,
                        discordUserIds,
                        disconnecting: false,
                        disconnectError: false,
                    });
                }
            })
            .catch(() => {
                if (
                    !controller.signal.aborted &&
                    activeAccountKeyRef.current === accountKey
                ) {
                    setAccountDiscordState({ status: 'error', accountKey });
                }
            });
        return (): void => controller.abort();
    }, [accountKey]);

    const handleDiscordDisconnect = async (
        session: Extract<
            GetAuthSessionResponse,
            { enabled: true; authenticated: true }
        >
    ): Promise<void> => {
        if (accountKey === null) return;
        const submittedAccountKey = accountKey;
        setAccountDiscordState({
            status: 'ready',
            accountKey,
            connected: true,
            discordUserIds:
                accountDiscordState.status === 'ready'
                    ? accountDiscordState.discordUserIds
                    : [],
            disconnecting: true,
            disconnectError: false,
        });
        try {
            await disconnectAccountDiscord(session.csrfToken);
            if (activeAccountKeyRef.current !== submittedAccountKey) return;
            setAccountDiscordState({
                status: 'ready',
                accountKey,
                connected: false,
                discordUserIds: [],
                disconnecting: false,
                disconnectError: false,
            });
        } catch {
            if (activeAccountKeyRef.current !== submittedAccountKey) return;
            setAccountDiscordState({
                status: 'ready',
                accountKey,
                connected: true,
                discordUserIds:
                    accountDiscordState.status === 'ready'
                        ? accountDiscordState.discordUserIds
                        : [],
                disconnecting: false,
                disconnectError: true,
            });
        }
    };

    const handleAddMemory = async (text: string): Promise<boolean> => {
        if (
            sessionState.status !== 'ready' ||
            !sessionState.session.authenticated ||
            accountKey === null
        )
            return false;
        const submittedAccountKey = accountKey;
        setMemoryBusy(true);
        setMemoryWriteError(null);
        try {
            const result = await addAccountMemory(
                text,
                sessionState.session.csrfToken
            );
            if (activeAccountKeyRef.current !== submittedAccountKey)
                return false;
            setMemories((current) => [...current, result.memory]);
            return true;
        } catch (error: unknown) {
            if (activeAccountKeyRef.current !== submittedAccountKey)
                return false;
            setMemoryWriteError(
                isApiClientError(error) && error.status === 409
                    ? 'limit'
                    : 'save'
            );
            return false;
        } finally {
            setMemoryBusy(false);
        }
    };

    const handleEditMemory = async (
        memoryId: string,
        text: string
    ): Promise<boolean> => {
        if (
            sessionState.status !== 'ready' ||
            !sessionState.session.authenticated ||
            accountKey === null
        )
            return false;
        const submittedAccountKey = accountKey;
        setMemoryBusy(true);
        setMemoryWriteError(null);
        try {
            const result = await updateAccountMemory(
                memoryId,
                text,
                sessionState.session.csrfToken
            );
            if (activeAccountKeyRef.current !== submittedAccountKey)
                return false;
            setMemories((current) =>
                current.map((memory) =>
                    memory.id === memoryId ? result.memory : memory
                )
            );
            return true;
        } catch {
            if (activeAccountKeyRef.current !== submittedAccountKey)
                return false;
            setMemoryWriteError('edit');
            return false;
        } finally {
            setMemoryBusy(false);
        }
    };

    const handleForgetMemory = async (memoryId: string): Promise<void> => {
        if (
            sessionState.status !== 'ready' ||
            !sessionState.session.authenticated ||
            accountKey === null
        )
            return;
        const submittedAccountKey = accountKey;
        setMemoryBusy(true);
        setMemoryWriteError(null);
        try {
            await forgetAccountMemory(memoryId, sessionState.session.csrfToken);
            if (activeAccountKeyRef.current !== submittedAccountKey) return;
            setMemories((current) =>
                current.filter((memory) => memory.id !== memoryId)
            );
        } catch {
            if (activeAccountKeyRef.current !== submittedAccountKey) return;
            setMemoryWriteError('forget');
        } finally {
            setMemoryBusy(false);
        }
    };

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
            accountTitleRef.current?.focus();
        }
    }, [sessionState]);

    useEffect(() => {
        if (showDeleteConfirmation) {
            deleteConfirmationHeadingRef.current?.focus();
        } else if (focusAfterDeleteCancelRef.current) {
            focusAfterDeleteCancelRef.current = false;
            deleteAccountTriggerRef.current?.focus();
        }
    }, [showDeleteConfirmation]);

    const handleLogout = async (
        session: Extract<
            GetAuthSessionResponse,
            { enabled: true; authenticated: true }
        >
    ): Promise<void> => {
        setLogoutState('submitting');
        setClaimCodeDraft({ accountKey: null, value: '' });
        setClaimMessageDraft({ accountKey: null, value: '' });
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

    const confirmAccountDeletion = async (
        session: Extract<
            GetAuthSessionResponse,
            { enabled: true; authenticated: true }
        >
    ): Promise<void> => {
        if (deletionRequestInFlightRef.current) return;
        deletionRequestInFlightRef.current = true;
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
        } finally {
            deletionRequestInFlightRef.current = false;
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
            return <p role="status">Loading account…</p>;
        }

        if (sessionState.status === 'error') {
            return (
                <div>
                    <p className="account-page__error" role="alert">
                        Account status could not be loaded. Please try again.
                    </p>
                    <button
                        className="account-page__action"
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
                <p>
                    Account sign-in isn't available on this Footnote instance.
                </p>
            );
        }

        if (!sessionState.session.authenticated) {
            return (
                <a
                    className="account-page__action account-page__action--primary"
                    href="/api/auth/login"
                >
                    Sign in
                </a>
            );
        }

        const authenticatedSession = sessionState.session;
        const { principal } = authenticatedSession;

        return (
            <div className="account-page__summary">
                <h2 id="account-status-heading" tabIndex={-1}>
                    {principal.displayName?.trim()
                        ? `Signed in as ${principal.displayName.trim()}`
                        : 'Signed in'}
                </h2>
                {authenticatedSession.isAdministrator ? (
                    <Link className="account-page__action" to="/admin">
                        Admin settings
                    </Link>
                ) : null}
                <button
                    className="account-page__action"
                    type="button"
                    disabled={logoutState === 'submitting'}
                    onClick={() => {
                        void handleLogout(authenticatedSession);
                    }}
                >
                    {logoutState === 'submitting' ? 'Signing out…' : 'Sign out'}
                </button>
                {logoutState === 'error' ? (
                    <p className="account-page__error" role="alert">
                        Sign-out could not be completed. Please try again.
                    </p>
                ) : null}
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
                <p className="account-page__error" role="alert">
                    Discord connection could not be loaded or completed. Start
                    again from Discord.
                </p>
            );
        if (connectionState.state === 'expired')
            return (
                <p className="account-page__error" role="alert">
                    This Discord connection expired or was cancelled. Start
                    again with <code>/account connect</code>.
                </p>
            );
        if (connectionState.state === 'waiting-for-discord-confirmation')
            return (
                <p role="status">
                    Run{' '}
                    <code>/account confirm code:{connectionState.code}</code> in
                    the Discord account that started this request.
                </p>
            );
        if (
            sessionState.status !== 'ready' ||
            !sessionState.session.enabled ||
            !sessionState.session.authenticated
        ) {
            return (
                <div className="account-page__actions">
                    <p>Sign in to the Footnote account you want to connect.</p>
                    <a
                        className="account-page__action account-page__action--primary"
                        href="/api/auth/login"
                    >
                        Sign in
                    </a>
                </div>
            );
        }
        const csrfToken = sessionState.session.csrfToken;
        return (
            <div className="account-page__actions">
                <p>Connect your Discord account to this Footnote account?</p>
                <button
                    className="account-page__action account-page__action--primary"
                    type="button"
                    onClick={() => void handleDiscordConsent(csrfToken)}
                >
                    Approve connection
                </button>
                <button
                    className="account-page__action"
                    type="button"
                    onClick={() => void handleDiscordCancel(csrfToken)}
                >
                    Cancel connection
                </button>
            </div>
        );
    };

    const authenticatedSession =
        sessionState.status === 'ready' &&
        sessionState.session.enabled &&
        sessionState.session.authenticated
            ? sessionState.session
            : null;
    const currentIncidentsState =
        authenticatedSession && incidentsState.accountKey === accountKey
            ? incidentsState
            : { status: 'loading' as const, accountKey };
    const claimCode =
        claimCodeDraft.accountKey === accountKey ? claimCodeDraft.value : '';
    const claimMessage =
        claimMessageDraft.accountKey === accountKey
            ? claimMessageDraft.value
            : '';
    const currentAccountDiscordState =
        authenticatedSession && accountDiscordState.accountKey === accountKey
            ? accountDiscordState
            : { status: 'loading' as const, accountKey };
    return (
        <PublicPageLayout>
            <main id="main-content" className="public-page__main account-page">
                <section
                    className="public-page__intro"
                    aria-labelledby="account-page-title"
                >
                    <h1
                        id="account-page-title"
                        ref={accountTitleRef}
                        tabIndex={-1}
                    >
                        Account
                    </h1>
                    {sessionState.status === 'ready' &&
                    sessionState.session.enabled &&
                    !sessionState.session.authenticated ? (
                        <p className="public-page__lede">
                            Sign in to manage your Footnote account.
                        </p>
                    ) : null}
                    {showCallbackFailure ? (
                        <p className="account-page__notice" role="alert">
                            Sign-in could not be completed. Please try again.
                        </p>
                    ) : null}
                    <div className="account-page__summary" aria-live="polite">
                        {renderSessionState()}
                    </div>
                    {deletionState === 'success' ? (
                        <p className="account-page__notice" role="status">
                            Your Footnote account was deleted. Claimed safety
                            reports remain without details that identify you;
                            your sign-in and Discord accounts were not changed.
                        </p>
                    ) : null}
                    {deletionState === 'error' ? (
                        <p className="account-page__error" role="alert">
                            Your account couldn't be deleted. Sign in again and
                            try once more.
                        </p>
                    ) : null}
                </section>
                {authenticatedSession ? (
                    <MemorySection
                        memories={memories}
                        readState={memoryReadState}
                        writeError={memoryWriteError}
                        busy={memoryBusy}
                        onSave={handleAddMemory}
                        onEdit={handleEditMemory}
                        onForget={handleForgetMemory}
                        onRetry={() => setMemoryReloadKey((value) => value + 1)}
                    />
                ) : null}
                {authenticatedSession ? (
                    <ReportsSection
                        incidents={
                            currentIncidentsState.status === 'ready'
                                ? currentIncidentsState.incidents
                                : []
                        }
                        readState={currentIncidentsState.status}
                        claimCode={claimCode}
                        claimMessage={claimMessage}
                        onClaimCodeChange={(value) =>
                            setClaimCodeDraft({ accountKey, value })
                        }
                        onClaim={(event) => {
                            if (!accountKey) return;
                            void handleClaimIncident(
                                event,
                                authenticatedSession,
                                accountKey
                            );
                        }}
                    />
                ) : null}
                {authenticatedSession ? (
                    <section
                        className="account-page__section"
                        aria-labelledby="discord-connection-heading"
                    >
                        <h2 id="discord-connection-heading">Connections</h2>
                        {currentAccountDiscordState.status === 'loading' ? (
                            <p role="status">Checking Discord connection…</p>
                        ) : null}
                        {currentAccountDiscordState.status === 'error' ? (
                            <p className="account-page__error" role="alert">
                                Discord connection status couldn't be loaded.
                                Refresh the page to try again.
                            </p>
                        ) : null}
                        {currentAccountDiscordState.status === 'ready' ? (
                            <>
                                <p role="status">
                                    {currentAccountDiscordState.connected
                                        ? 'Discord connected.'
                                        : 'Discord not connected.'}
                                </p>
                                {currentAccountDiscordState.connected ? (
                                    <>
                                        <p>
                                            Discord ID:{' '}
                                            {currentAccountDiscordState.discordUserIds.join(
                                                ', '
                                            )}
                                        </p>
                                        <p>
                                            Disconnecting only removes this
                                            Footnote link.
                                        </p>
                                        <div className="account-page__actions">
                                            <button
                                                aria-label={
                                                    currentAccountDiscordState.disconnecting
                                                        ? 'Disconnecting from Discord'
                                                        : 'Disconnect Discord'
                                                }
                                                className="account-page__action account-page__icon-action"
                                                disabled={
                                                    currentAccountDiscordState.disconnecting
                                                }
                                                title="Disconnect Discord"
                                                type="button"
                                                onClick={() =>
                                                    void handleDiscordDisconnect(
                                                        authenticatedSession
                                                    )
                                                }
                                            >
                                                <AccountIcon name="disconnect" />
                                            </button>
                                            {currentAccountDiscordState.disconnectError ? (
                                                <p
                                                    className="account-page__error"
                                                    role="alert"
                                                >
                                                    Discord couldn't be
                                                    disconnected. Try again.
                                                </p>
                                            ) : null}
                                        </div>
                                    </>
                                ) : (
                                    <p>
                                        Start with <code>/account connect</code>{' '}
                                        in Discord.
                                    </p>
                                )}
                            </>
                        ) : null}
                        {renderDiscordConnection()}
                    </section>
                ) : null}
                {sessionState.status === 'ready' &&
                sessionState.session.enabled &&
                sessionState.session.authenticated ? (
                    <section
                        className="account-page__section"
                        aria-labelledby="account-data-heading"
                    >
                        <h2 id="account-data-heading">Account data</h2>
                        <p>
                            Download a copy of the information associated with
                            your account.
                        </p>
                        <a
                            aria-label="Download account data"
                            className="account-page__action"
                            href="/api/account/export"
                            title="Download account data"
                        >
                            <AccountIcon name="download" />
                            <span className="sr-only">
                                Download account data
                            </span>
                        </a>
                        <div className="account-page__delete">
                            <h3>Delete account</h3>
                            <p>
                                Deletes your account, memories, connections, and
                                links to reports you claimed. Claimed safety
                                reports remain without details that identify
                                you.
                            </p>
                            {!showDeleteConfirmation ? (
                                <button
                                    ref={deleteAccountTriggerRef}
                                    className="account-page__action account-page__action--danger"
                                    type="button"
                                    onClick={() =>
                                        setShowDeleteConfirmation(true)
                                    }
                                >
                                    <AccountIcon name="delete" />
                                    Delete account
                                </button>
                            ) : (
                                <div
                                    className="account-page__confirmation"
                                    role="group"
                                    aria-labelledby="delete-confirmation-title"
                                >
                                    <h3
                                        id="delete-confirmation-title"
                                        ref={deleteConfirmationHeadingRef}
                                        tabIndex={-1}
                                    >
                                        Delete your Footnote account?
                                    </h3>
                                    <p>
                                        Your memories, Discord connection, and
                                        sign-in links will be deleted. Claimed
                                        safety reports will remain after
                                        identifying details and contact
                                        information are removed. Unclaimed
                                        reports are unchanged. Your external
                                        sign-in and Discord accounts won't be
                                        deleted. This can't be undone.
                                    </p>
                                    <div className="account-page__actions">
                                        <button
                                            className="account-page__action"
                                            type="button"
                                            disabled={
                                                deletionState === 'submitting'
                                            }
                                            onClick={() => {
                                                focusAfterDeleteCancelRef.current = true;
                                                setShowDeleteConfirmation(
                                                    false
                                                );
                                            }}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            className="account-page__action account-page__action--danger"
                                            type="button"
                                            disabled={
                                                deletionState === 'submitting'
                                            }
                                            onClick={() => {
                                                if (
                                                    sessionState.status ===
                                                        'ready' &&
                                                    sessionState.session
                                                        .enabled &&
                                                    sessionState.session
                                                        .authenticated
                                                ) {
                                                    void confirmAccountDeletion(
                                                        sessionState.session
                                                    );
                                                }
                                            }}
                                        >
                                            {deletionState === 'submitting'
                                                ? 'Deleting…'
                                                : 'Delete account'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>
                ) : null}
            </main>
        </PublicPageLayout>
    );
};

export default AccountPage;
