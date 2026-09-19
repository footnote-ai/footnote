/**
 * @description: Renders the public Footnote homepage, prepared examples, and concise product narrative.
 * @footnote-scope: web
 * @footnote-module: PublicHomePage
 * @footnote-risk: medium - Homepage changes affect public discovery and prepared-example presentation.
 * @footnote-ethics: high - Prepared response state and public claims must not imply live execution or fabricated provenance.
 */

import { Link } from 'react-router-dom';
import CanonicalResponseFootnote from '@components/CanonicalResponseFootnote';
import MarkdownResponse from '@components/MarkdownResponse';
import PublicFooter from '@components/PublicFooter';
import PublicHeader from '@components/PublicHeader';
import ResponseCarousel from '@components/ResponseCarousel';
import { landingScenarios } from '../data/landingScenarios';

type PublicConcept = {
    id: string;
    label: string;
    description: string;
    documentationHref: string;
    documentationLabel: string;
};

const publicConcepts: readonly PublicConcept[] = [
    {
        id: 'see-what-happened',
        label: 'See what happened',
        description:
            'Know where an answer came from, what Footnote did, and what it could not confirm.',
        documentationHref: '/wiki/architecture/canonical-response-footnote/',
        documentationLabel: 'How answers are explained',
    },
    {
        id: 'your-rules',
        label: 'Your rules',
        description:
            'Decide what Footnote may use, what it can do, and how it should behave.',
        documentationHref: '/wiki/architecture/admin-settings-architecture/',
        documentationLabel: 'Configuration',
    },
    {
        id: 'run-it-your-way',
        label: 'Run it your way',
        description:
            'Use local or online models, on your computer or a server.',
        documentationHref: '/wiki/deployment/',
        documentationLabel: 'Deployment',
    },
    {
        id: 'open-about-our-choices',
        label: 'Open about our choices',
        description:
            'Our code, licensing, limits, AI use, and resource claims should be open to scrutiny.',
        documentationHref: '/wiki/philosophy/',
        documentationLabel: 'Philosophy',
    },
];

const ConceptIllustration = ({ id }: { id: string }): JSX.Element => {
    if (id === 'see-what-happened') {
        return (
            <svg viewBox="0 0 220 72" aria-hidden="true" focusable="false">
                <circle cx="18" cy="36" r="3" />
                <path d="M18 36C62 36 58 10 102 10s43 52 86 52" />
                <path d="M18 36c40 0 52-17 84-17 39 0 45 34 86 34" />
                <path d="M18 36c42 0 45 18 84 18 40 0 46-27 86-27" />
                <path d="M18 36c40 0 51 25 84 25 43 0 43-47 86-47" />
                <circle cx="102" cy="10" r="3" />
                <circle cx="102" cy="54" r="3" />
                <circle cx="188" cy="35" r="3" />
            </svg>
        );
    }
    if (id === 'your-rules') {
        return (
            <svg viewBox="0 0 180 72" aria-hidden="true" focusable="false">
                <path d="M12 16h156M12 36h156M12 56h156" />
                <circle cx="74" cy="16" r="5" />
                <circle cx="120" cy="36" r="5" />
                <circle cx="55" cy="56" r="5" />
            </svg>
        );
    }
    if (id === 'run-it-your-way') {
        return (
            <svg viewBox="0 0 200 72" aria-hidden="true" focusable="false">
                <rect x="16" y="14" width="58" height="38" rx="3" />
                <path d="M9 57h72M25 57v4h40v-4M101 34h26" />
                <path d="M151 54h29a9 9 0 0 0 1-18 15 15 0 0 0-29-4 11 11 0 0 0-1 22Z" />
                <circle cx="91" cy="34" r="1.5" />
                <circle cx="97" cy="34" r="1.5" />
            </svg>
        );
    }
    return (
        <svg viewBox="0 0 100 72" aria-hidden="true" focusable="false">
            <path d="m50 9 29 15-29 15-29-15z" />
            <path d="m21 36 29 15 29-15M21 48l29 15 29-15" />
        </svg>
    );
};

const PublicConceptList = (): JSX.Element => {
    return (
        <ul className="public-home__concepts" aria-label="How Footnote works">
            {publicConcepts.map((concept) => {
                return (
                    <li
                        className={`public-home__concept-wrap public-home__concept-wrap--${concept.id}`}
                        key={concept.id}
                    >
                        <article className="public-home__concept">
                            <div className="public-home__concept-art">
                                <ConceptIllustration id={concept.id} />
                            </div>
                            <div className="public-home__concept-content">
                                <h3>{concept.label}</h3>
                                <p>{concept.description}</p>
                                <a href={concept.documentationHref}>
                                    {concept.documentationLabel}
                                    <span aria-hidden="true"> →</span>
                                </a>
                            </div>
                        </article>
                    </li>
                );
            })}
        </ul>
    );
};

const PublicHomePage = (): JSX.Element => {
    // NYC source/readiness remains gated pending the approved retrieval rollout.
    // Do not present a retrieval claim while PR #665 is still gated.
    const nycRecordsEnabled = false;

    return (
        <div className="public-home">
            <svg
                className="public-home__linework"
                viewBox="0 0 1200 1800"
                preserveAspectRatio="none"
                aria-hidden="true"
                focusable="false"
            >
                <path d="M-40 180C160 180 166 345 318 345S502 155 664 155s214 92 308 92 155-181 270-181" />
                <path d="M-32 770c164 0 171-124 318-124 162 0 211 155 344 155 168 0 194-183 345-183 115 0 131 88 249 88" />
                <path d="M600 1260v120" />
                <path d="M-20 1570c228 0 280-106 495-106s245 92 426 92 174-126 320-126" />
                <path d="M710 1650c112 0 138-58 219-101s137-25 231-139" />
                <circle cx="318" cy="345" r="6" />
                <circle cx="664" cy="155" r="6" />
                <circle cx="972" cy="472" r="6" />
                <circle cx="600" cy="1380" r="6" />
                <circle cx="901" cy="1556" r="6" />
            </svg>
            <PublicHeader homepage />
            <main id="main-content" className="public-home__main">
                <section aria-labelledby="homepage-title">
                    <header className="public-home__intro">
                        <h1 id="homepage-title">
                            <span className="public-home__hero-title-line">
                                AI that
                            </span>{' '}
                            <span className="public-home__hero-title-line">
                                <em>shows its work.</em>
                            </span>
                        </h1>
                        <p>
                            See how an answer was made, set your own rules, and
                            run Footnote your way.
                        </p>
                    </header>
                    <div className="public-home__intro-rule" />
                    <div className="public-home__thread">
                        <div className="public-home__chat-shell">
                            <aside
                                className="public-home__context-notice"
                                hidden={!nycRecordsEnabled}
                                aria-label="NYC September 11 records"
                            >
                                <strong>New: NYC September 11 records</strong>
                                <span>
                                    Ask about the response, cleanup,
                                    environmental conditions, agencies,
                                    residents, and recovery, with sources you
                                    can inspect.
                                </span>
                                <Link to="/chat">Ask in chat →</Link>
                            </aside>
                            <ResponseCarousel
                                items={landingScenarios}
                                ariaLabel="Pre-prepared answers"
                                getKey={(scenario) => scenario.id}
                                getDotLabel={(scenario, index) =>
                                    `Show prepared response ${index + 1}: ${scenario.question}`
                                }
                                renderItem={(scenario) => (
                                    <p className="public-message public-message--person">
                                        {scenario.question}
                                    </p>
                                )}
                                renderItemAfterNavigation={(scenario) => (
                                    <>
                                        <article className="public-message public-message--assistant">
                                            <MarkdownResponse
                                                markdown={
                                                    scenario.response.message
                                                }
                                            />
                                        </article>
                                        <CanonicalResponseFootnote
                                            metadata={
                                                scenario.response.metadata
                                            }
                                            artifacts={{
                                                trace: 'unavailable',
                                                report: 'unavailable',
                                            }}
                                        />
                                    </>
                                )}
                            />
                            <Link
                                className="public-home__chat-handoff"
                                to="/chat"
                            >
                                <span>Ask a question…</span>
                                <span aria-hidden="true">→</span>
                            </Link>
                        </div>
                    </div>
                </section>
                <section
                    className="public-home__narrative"
                    aria-labelledby="narrative-title"
                >
                    <h2 id="narrative-title">How we do things</h2>
                    <PublicConceptList />
                </section>
                <section
                    className="public-home__get-started"
                    aria-labelledby="get-started-title"
                >
                    <h2 id="get-started-title">Run Footnote</h2>
                    <p>Open source. Your computer or a server.</p>
                    <div>
                        <a
                            className="public-home__download"
                            href="https://github.com/footnote-ai/footnote/releases"
                            target="_blank"
                            rel="noreferrer"
                        >
                            Get started
                        </a>
                        <a
                            className="public-home__documentation"
                            href="/wiki/getting-started/"
                        >
                            Setup guide
                        </a>
                    </div>
                </section>
            </main>
            <PublicFooter homepage />
        </div>
    );
};

export default PublicHomePage;
