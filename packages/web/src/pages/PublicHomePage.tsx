/**
 * @description: Renders the public Footnote homepage, prepared examples, and concise product narrative.
 * @footnote-scope: web
 * @footnote-module: PublicHomePage
 * @footnote-risk: medium - Homepage changes affect public discovery and prepared-example presentation.
 * @footnote-ethics: high - Prepared response state and public claims must not imply live execution or fabricated provenance.
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
                    className="public-home__narrative"
                    aria-labelledby="narrative-title"
                >
                    <div className="public-home__narrative-intro">
                        <p className="public-home__eyebrow">Why Footnote</p>
                        <h2 id="narrative-title">
                            Answers are easier to use when you can check them.
                        </h2>
                        <p>
                            Footnote is an open-source AI assistant for answers
                            you can inspect. It keeps the useful questions close
                            to the answer: what shaped it, what may be missing,
                            and where to look next.
                        </p>
                    </div>
                    <div className="public-home__principles">
                        <article className="public-home__principle">
                            <h3>See what shaped an answer</h3>
                            <p>
                                A live response can show sources and runtime
                                details that help explain how it was produced.
                                Workflow details and limits stay visible when
                                they matter; when a trace is available, it gives
                                you a fuller record to inspect.
                            </p>
                            <a href="/wiki/architecture/canonical-response-footnote/">
                                How response details fit together
                            </a>
                        </article>
                        <article className="public-home__principle">
                            <h3>Keep uncertainty visible</h3>
                            <p>
                                Missing evidence, unavailable work, and relevant
                                limits should be visible instead of being
                                smoothed into a confident-looking answer. The
                                prepared example above is labeled so it cannot
                                be mistaken for a fresh run.
                            </p>
                            <a href="/wiki/architecture/platform-experience-standard/">
                                Read the experience standard
                            </a>
                        </article>
                        <article className="public-home__principle">
                            <h3>People keep the final say</h3>
                            <p>
                                Footnote is meant to support judgment, not
                                replace it. Privacy and permissions are part of
                                that control: the project asks what an assistant
                                may do, what record remains, and how someone can
                                correct or stop it.
                            </p>
                            <a href="/wiki/philosophy/">Read the philosophy</a>
                        </article>
                    </div>
                    <div className="public-home__narrative-actions">
                        <Link
                            className="public-home__action public-home__action--primary"
                            to="/chat"
                        >
                            Try a live question
                        </Link>
                        <a className="public-home__action" href="/wiki/">
                            Explore the documentation
                        </a>
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
                            href="/wiki/getting-started/"
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
