/**
 * @description: Shows account sign-in availability, the current backend-owned session, and local logout.
 * @footnote-scope: web
 * @footnote-module: AccountPage
 * @footnote-risk: medium - State mistakes can misrepresent whether a user is signed in or signed out.
 * @footnote-ethics: high - Identity display and logout controls affect user privacy and account agency.
 */

import { useEffect, useRef, useState, type ComponentRef } from 'react';
import type { GetAuthSessionResponse } from '@footnote/contracts/web';
import PublicPageLayout from '@components/PublicPageLayout';
import { Link } from 'react-router-dom';
import { getAuthSession, logoutAccount } from '../utils/api';

type SessionState =
    | { status: 'loading' }
    | { status: 'ready'; session: GetAuthSessionResponse }
    | { status: 'error' };

type LogoutState = 'idle' | 'submitting' | 'error';

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
    const [showCallbackFailure] = useState(hasAuthFailureMarker);
    const accountStatusHeadingRef = useRef<ComponentRef<'h2'>>(null);
    const focusAfterLogoutRef = useRef(false);

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
                <Link
                    className="account-card__button account-card__button--primary"
                    to="/admin"
                >
                    Open administrator settings
                </Link>
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
            </div>
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
                        {renderSessionState()}
                    </div>
                </section>
            </main>
        </PublicPageLayout>
    );
};

export default AccountPage;
