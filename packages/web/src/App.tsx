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
import Hero from '@components/Hero';
import Footer from '@components/Footer';

const PROJECT_DOCS_URL =
    'https://github.com/footnote-ai/footnote/tree/main/docs';

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

const HomePage = (): JSX.Element => {
    const location = useLocation();

    useEffect(() => {
        if (!location.hash) {
            return;
        }

        const targetId = decodeURIComponent(location.hash.slice(1));
        const sectionElement = document.getElementById(targetId);
        if (!sectionElement) {
            return;
        }

        sectionElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [location.hash]);

    return (
        <>
            <Header />
            <main id="main-content" className="page-content landing-page">
                <section
                    id="about"
                    className="landing-section landing-section--about"
                    aria-labelledby="about-title"
                >
                    <p className="landing-kicker">About</p>
                    <h1 id="about-title" className="landing-title">
                        AI that shows its work.
                    </h1>
                    <p className="landing-lede">
                        Footnote helps make AI answers easier to check.
                    </p>
                    <p>
                        Most chatbots rush to give you a polished answer, even when they're wrong. 
                        Footnote gives you the tools to see what shaped the answer: 
                        What it knows, what it doesn't, and where you can look next.
                    </p>
                    <p>
                        Want to help? Visit the project{' '}
                        <a
                            href="https://github.com/footnote-ai/footnote"
                            target="_blank"
                            rel="noreferrer"
                        >
                            repository
                        </a>{' '}
                        and{' '}
                        <a
                            href={PROJECT_DOCS_URL}
                            target="_blank"
                            rel="noreferrer"
                        >
                            docs
                        </a>
                        .
                    </p>
                </section>

                <Hero sectionId="demo" />

                <section
                    id="get-started"
                    className="landing-section landing-section--get-started"
                    aria-labelledby="get-started-title"
                >
                    <p className="landing-kicker">Get started</p>
                    <h2 id="get-started-title" className="landing-title">
                        Run Footnote locally in minutes.
                    </h2>
                    <p className="landing-lede">
                        Install the launcher from GitHub Releases, then start
                        Footnote with one command.
                    </p>

                    <pre className="landing-command-block">
                        <code>footnote start</code>
                    </pre>

                    <div className="cta-group">
                        <a
                            className="cta-button primary"
                            href="https://github.com/footnote-ai/footnote/releases"
                            target="_blank"
                            rel="noreferrer"
                        >
                            Download Footnote CLI
                        </a>
                        <a
                            className="cta-button secondary"
                            href="https://github.com/footnote-ai/footnote#quickstart"
                            target="_blank"
                            rel="noreferrer"
                        >
                            Read the Quickstart
                        </a>
                    </div>

                    <p className="landing-note">
                        Footnote runs with Docker. Prefer working from source? Use{' '}
                        <code>pnpm start</code>.
                    </p>
                </section>
            </main>
            <Footer />
        </>
    );
};

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
    <main id="main-content" className="route-loading-shell">
        <section
            className="route-loading-card"
            aria-label="Page loading state"
            role="status"
            aria-live="polite"
        >
            <div className="spinner route-loading-spinner" aria-hidden="true" />
            <p className="route-loading-title">Loading page…</p>
        </section>
    </main>
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
        <div className="app-shell">
            <a href="#main-content" className="skip-link">
                Skip to main content
            </a>
            <Routes>
                <Route path="/" element={<HomePage />} />
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
