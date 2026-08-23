/**
 * @description: Defines the web app route tree for the public homepage and standalone public pages.
 * @footnote-scope: web
 * @footnote-module: WebAppRoutes
 * @footnote-risk: medium - Routing mistakes can hide key web surfaces or send users to broken pages.
 * @footnote-ethics: medium - The top-level route map affects access to transparency and self-hosting guidance.
 */

import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import PublicHomePage from '@pages/PublicHomePage';
import PublicPageLayout from '@components/PublicPageLayout';

const NotFound = (): JSX.Element => (
    <PublicPageLayout>
        <main id="main-content" className="public-page__main">
            <section
                className="public-page__intro"
                aria-labelledby="not-found-title"
            >
                <h1 id="not-found-title">Page not found</h1>
                <p>That page does not exist.</p>
            </section>
        </main>
    </PublicPageLayout>
);

const loadTracePage = (): Promise<typeof import('@pages/TracePage')> =>
    import('@pages/TracePage');
const loadEmbedPage = (): Promise<typeof import('@pages/EmbedPage')> =>
    import('@pages/EmbedPage');
const loadSetupPage = (): Promise<typeof import('@pages/SetupPage')> =>
    import('@pages/SetupPage');
const loadChatPage = (): Promise<typeof import('@pages/ChatPage')> =>
    import('@pages/ChatPage');
const loadAccountPage = (): Promise<typeof import('@pages/AccountPage')> =>
    import('@pages/AccountPage');
const loadAdminPage = (): Promise<typeof import('@pages/AdminPage')> =>
    import('@pages/AdminPage');

const TracePage = lazy(loadTracePage);
const EmbedPage = lazy(loadEmbedPage);
const SetupPage = lazy(loadSetupPage);
const ChatPage = lazy(loadChatPage);
const AccountPage = lazy(loadAccountPage);
const AdminPage = lazy(loadAdminPage);

const routeFallback = (
    <PublicPageLayout>
        <main
            id="main-content"
            className="public-page__main route-loading-shell"
        >
            <div role="status" aria-live="polite">
                <span className="sr-only">Loading page.</span>
                <div
                    className="spinner route-loading-spinner"
                    aria-hidden="true"
                />
            </div>
        </main>
    </PublicPageLayout>
);

// The App component stitches together the landing page sections in their intended scroll order.
const App = (): JSX.Element => {
    useEffect(() => {
        const windowWithIdleCallbacks = window as typeof globalThis & {
            requestIdleCallback?: (callback: () => void) => number;
            cancelIdleCallback?: (handle: number) => void;
        };

        const preloadRoutes = (): void => {
            void Promise.allSettled([
                loadTracePage(),
                loadEmbedPage(),
                loadSetupPage(),
                loadChatPage(),
                loadAccountPage(),
                loadAdminPage(),
            ]);
        };

        if (typeof windowWithIdleCallbacks.requestIdleCallback === 'function') {
            const idleCallbackId = windowWithIdleCallbacks.requestIdleCallback(
                () => {
                    preloadRoutes();
                }
            );

            return (): void => {
                windowWithIdleCallbacks.cancelIdleCallback?.(idleCallbackId);
            };
        }

        const timeoutId = window.setTimeout(preloadRoutes, 900);

        return (): void => {
            window.clearTimeout(timeoutId);
        };
    }, []);

    return (
        <div className="app-shell app-shell--public">
            <a href="#main-content" className="skip-link">
                Skip to main content
            </a>
            <Routes>
                <Route path="/" element={<PublicHomePage />} />
                <Route
                    path="/chat"
                    element={
                        <Suspense fallback={routeFallback}>
                            <ChatPage />
                        </Suspense>
                    }
                />
                <Route
                    path="/account"
                    element={
                        <Suspense fallback={routeFallback}>
                            <AccountPage />
                        </Suspense>
                    }
                />
                <Route
                    path="/admin"
                    element={
                        <Suspense fallback={routeFallback}>
                            <AdminPage />
                        </Suspense>
                    }
                />
                <Route
                    path="/setup"
                    element={
                        <Suspense fallback={routeFallback}>
                            <SetupPage />
                        </Suspense>
                    }
                />
                <Route
                    path="/embed"
                    element={
                        <Suspense fallback={routeFallback}>
                            <EmbedPage />
                        </Suspense>
                    }
                />
                <Route
                    path="/traces/:responseId"
                    element={
                        <Suspense fallback={routeFallback}>
                            <TracePage />
                        </Suspense>
                    }
                />
                <Route
                    path="/api/traces/:responseId"
                    element={
                        <Suspense fallback={routeFallback}>
                            <TracePage />
                        </Suspense>
                    }
                />
                <Route path="*" element={<NotFound />} />
            </Routes>
        </div>
    );
};

export default App;
