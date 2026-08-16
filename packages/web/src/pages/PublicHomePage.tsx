/**
 * @description: Renders the public Footnote homepage with one prepared answer and a reserved trace-footer position.
 * @footnote-scope: web
 * @footnote-module: PublicHomePage
 * @footnote-risk: medium - Homepage changes affect public discovery and prepared-example presentation.
 * @footnote-ethics: high - Prepared response state and the empty trace position must not imply live execution or fabricated provenance.
 */

import { Link } from 'react-router-dom';
import MarkdownResponse from '@components/MarkdownResponse';
import PublicFooter from '@components/PublicFooter';
import PublicHeader from '@components/PublicHeader';
import TraceFooterPlaceholder from '@components/TraceFooterPlaceholder';
import ResponseCarousel from '@components/ResponseCarousel';
import { landingScenarios } from '../data/landingScenarios';

const PublicHomePage = (): JSX.Element => {
    return (
        <div className="public-home">
            <PublicHeader />
            <main id="main-content" className="public-home__main">
                <section aria-labelledby="homepage-title">
                    <header className="public-home__intro">
                        <h1 id="homepage-title">AI that shows its work.</h1>
                        <p>Footnote helps make AI answers easier to check.</p>
                        <p>
                            Most chatbots rush to give you a polished answer,
                            even when they&apos;re wrong. Footnote gives you the
                            tools to see what shaped the answer: what it knows,
                            what it doesn&apos;t, and where you can look next.
                        </p>
                    </header>
                    <div className="public-home__intro-rule" />
                    <div className="public-home__thread">
                        <ResponseCarousel
                            items={landingScenarios}
                            ariaLabel="Pre-prepared answers"
                            getKey={(scenario) => scenario.id}
                            getDotLabel={(scenario, index) =>
                                `Show prepared response ${index + 1}: ${scenario.question}`
                            }
                            renderItem={(scenario) => (
                                <>
                                    <p className="public-message public-message--person">
                                        {scenario.question}
                                    </p>
                                    <article className="public-message public-message--assistant">
                                        <MarkdownResponse
                                            markdown={scenario.response.message}
                                        />
                                    </article>
                                    <TraceFooterPlaceholder />
                                </>
                            )}
                        />
                        <p className="public-home__prepared">
                            Pre-prepared response. <Link to="/chat">Chat</Link>
                        </p>
                    </div>
                </section>
                <section
                    className="public-home__get-started"
                    aria-labelledby="get-started-title"
                >
                    <h2 id="get-started-title">Get started</h2>
                    <p>
                        Run Footnote yourself in minutes. It&apos;s as easy as
                        double-clicking the file.
                    </p>
                    <div>
                        <a
                            className="public-home__download"
                            href="https://github.com/footnote-ai/footnote/releases"
                            target="_blank"
                            rel="noreferrer"
                        >
                            Download
                        </a>
                        <a
                            className="public-home__documentation"
                            href="https://github.com/footnote-ai/footnote#quickstart"
                            target="_blank"
                            rel="noreferrer"
                        >
                            Documentation
                        </a>
                    </div>
                </section>
            </main>
            <PublicFooter />
        </div>
    );
};

export default PublicHomePage;
