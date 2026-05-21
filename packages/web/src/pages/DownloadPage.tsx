/**
 * @description: Presents the standalone launcher CLI download path and runtime options.
 * @footnote-scope: web
 * @footnote-module: DownloadPage
 * @footnote-risk: low - Incorrect install copy can misdirect operators without changing runtime behavior.
 * @footnote-ethics: low - Deployment guidance affects operator decisions and reliability expectations.
 */

import { useState, type JSX } from 'react';
import Header from '@components/Header';
import Footer from '@components/Footer';

/**
 * Renders the download page for the standalone `footnote` CLI path.
 * This component has no props and only performs local clipboard copy side effects.
 * @returns {JSX.Element} Download experience with command copy affordance.
 */
const DownloadPage = (): JSX.Element => {
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>(
        'idle'
    );

    const cliCommand = 'footnote start';

    const handleCopy = async (): Promise<void> => {
        try {
            await navigator.clipboard.writeText(cliCommand);
            setCopyStatus('copied');
        } catch (error: unknown) {
            console.error('Failed to copy CLI command to clipboard.', error);
            setCopyStatus('error');
        }
    };

    return (
        <>
            <Header />
            <main className="page-content" id="main-content">
                <section className="page-hero">
                    <h1>Download</h1>
                    <p className="page-hero__summary">
                        Install the standalone launcher binary and run Footnote
                        with one command.
                    </p>
                    <p>
                        Primary command: <code>footnote start</code>
                    </p>
                    <p>
                        Runtime image: <code>ghcr.io/footnote-ai/footnote</code>
                    </p>
                    <pre>
                        <code>{cliCommand}</code>
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
                        <button
                            className="cta-button secondary"
                            type="button"
                            onClick={handleCopy}
                        >
                            Copy command
                        </button>
                    </div>
                    <p aria-live="polite" role="status">
                        {copyStatus === 'copied'
                            ? 'Copied.'
                            : copyStatus === 'error'
                              ? 'Copy failed.'
                              : ''}
                    </p>
                    <p>
                        Footnote launcher v1 uses Docker + GHCR. Developer
                        source workflows still use <code>pnpm start</code>.
                    </p>
                </section>
            </main>
            <Footer />
        </>
    );
};

export default DownloadPage;
