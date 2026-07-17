/**
 * @description: Defines the web app route tree and stitches together the landing page and standalone pages.
 * @footnote-scope: web
 * @footnote-module: WebAppRoutes
 * @footnote-risk: medium - Routing mistakes can hide key web surfaces or send users to broken pages.
 * @footnote-ethics: medium - The top-level route map affects access to transparency and self-hosting guidance.
 */

import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Header from '@components/Header';
import Footer from '@components/Footer';
import PublicHomePage from '@pages/PublicHomePage';

const NotFound = (): JSX.Element => (
    <>
        <Header />
        <main id="main-content" className="page-content">
            <section className="page-hero" aria-labelledby="not-found-title">
                <h1 id="not-found-title">Page not found</h1>
                <p>That page does not exist.</p>
            </section>
        </main>
        <Footer />
    </>
);

const loadTracePage = (): Promise<typeof import('@pages/TracePage')> =>
    import('@pages/TracePage');
const loadEmbedPage = (): Promise<typeof import('@pages/EmbedPage')> =>
    import('@pages/EmbedPage');
const loadSetupPage = (): Promise<typeof import('@pages/SetupPage')> =>
    import('@pages/SetupPage');

const TracePage = lazy(loadTracePage);
const EmbedPage = lazy(loadEmbedPage);
const SetupPage = lazy(loadSetupPage);

const routeFallback = (
    <main
        id="main-content"
        className="route-loading-shell"
        aria-label="Page loading state"
        role="status"
        aria-live="polite"
    >
        <div className="spinner route-loading-spinner" aria-hidden="true" />
    </main>
);

// The App component stitches together the landing page sections in their intended scroll order.
const App = (): JSX.Element => {
    const location = useLocation();
    const isPublicHome = location.pathname === '/';

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
        <div
            className={`app-shell${isPublicHome ? ' app-shell--public-home' : ''}`}
        >
            <a href="#main-content" className="skip-link">
                Skip to main content
            </a>
            <Routes>
                <Route path="/" element={<PublicHomePage />} />
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
