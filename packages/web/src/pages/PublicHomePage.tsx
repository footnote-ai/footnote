/**
 * @description: Renders the public Footnote homepage, prepared examples, and concise product narrative.
 * @footnote-scope: web
 * @footnote-module: PublicHomePage
 * @footnote-risk: medium - Homepage changes affect public discovery and prepared-example presentation.
 * @footnote-ethics: high - Prepared response state and public claims must not imply live execution or fabricated provenance.
 */

import {
    useRef,
    useState,
    type FocusEvent,
    type MouseEvent,
    type PointerEvent,
} from 'react';
import { Link } from 'react-router-dom';
import MarkdownResponse from '@components/MarkdownResponse';
import PublicFooter from '@components/PublicFooter';
import PublicHeader from '@components/PublicHeader';
import TraceFooterPlaceholder from '@components/TraceFooterPlaceholder';
import ResponseCarousel from '@components/ResponseCarousel';
import { landingScenarios } from '../data/landingScenarios';

type PublicConcept = {
    id: string;
    label: string;
    description: string;
    detailLead: string;
    technicalLabel: string;
    detailTail: string;
    documentationHref: string;
};

const publicConcepts: readonly PublicConcept[] = [
    {
        id: 'origins',
        label: 'Origins',
        description: 'Where information came from.',
        detailLead: 'Sources and context used to form the answer. See',
        technicalLabel: 'provenance',
        detailTail: '.',
        documentationHref: '/wiki/architecture/canonical-response-footnote/',
    },
    {
        id: 'uncertainty',
        label: 'Uncertainty',
        description: 'What may be wrong or missing.',
        detailLead: 'What could not be confirmed or remains unresolved. See',
        technicalLabel: 'uncertainty',
        detailTail: '.',
        documentationHref: '/wiki/architecture/platform-experience-standard/',
    },
    {
        id: 'steps',
        label: 'Steps',
        description: 'What the system did.',
        detailLead:
            'Searches, tools, and other work used to produce the answer. See',
        technicalLabel: 'workflow',
        detailTail: '.',
        documentationHref: '/wiki/architecture/workflow/',
    },
    {
        id: 'limits',
        label: 'Limits',
        description: 'What it could not do or check.',
        detailLead: 'What could not be accessed, checked, or completed. See',
        technicalLabel: 'limitations',
        detailTail: '.',
        documentationHref: '/wiki/architecture/platform-experience-standard/',
    },
];

const PublicConceptList = (): JSX.Element => {
    const [activeConceptId, setActiveConceptId] = useState<string | null>(null);
    const pointerActivationRef = useRef<string | null>(null);

    const isMobileCardInteraction = (): boolean =>
        typeof window !== 'undefined' &&
        window.matchMedia('(hover: none), (pointer: coarse)').matches;

    const handleConceptBlur = (event: FocusEvent<HTMLElement>): void => {
        const nextTarget = event.relatedTarget;
        if (
            !(nextTarget instanceof HTMLElement) ||
            !event.currentTarget.contains(nextTarget)
        ) {
            setActiveConceptId(null);
        }
    };

    const handleConceptPointerDown = (
        event: PointerEvent<HTMLDivElement>
    ): void => {
        pointerActivationRef.current = event.pointerType || 'mouse';
    };

    const handleConceptClick = (
        conceptId: string,
        event: MouseEvent<HTMLDivElement>
    ): void => {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest('a')) {
            pointerActivationRef.current = null;
            return;
        }
        if (
            isMobileCardInteraction() ||
            pointerActivationRef.current === 'touch'
        ) {
            setActiveConceptId((currentConceptId) =>
                currentConceptId === conceptId ? null : conceptId
            );
        }
        pointerActivationRef.current = null;
    };

    return (
        <ul
            className="public-home__concepts"
            aria-label="What to check around an answer"
        >
            {publicConcepts.map((concept) => {
                const isActive = activeConceptId === concept.id;
                const popoverId = `public-home-concept-${concept.id}`;

                return (
                    <li
                        className={`public-home__concept-wrap public-home__concept-wrap--${concept.id}`}
                        data-concept={concept.id}
                        key={concept.id}
                        onBlur={handleConceptBlur}
                        onFocus={() => {
                            if (!pointerActivationRef.current) {
                                setActiveConceptId(concept.id);
                            }
                        }}
                        onMouseEnter={() => {
                            if (!isMobileCardInteraction()) {
                                setActiveConceptId(concept.id);
                            }
                        }}
                        onMouseLeave={() => {
                            if (!isMobileCardInteraction()) {
                                setActiveConceptId(null);
                            }
                        }}
                        data-active={isActive}
                    >
                        <div
                            className="public-home__concept"
                            tabIndex={0}
                            role="group"
                            aria-label={concept.label}
                            onClick={(event) =>
                                handleConceptClick(concept.id, event)
                            }
                            onPointerDown={handleConceptPointerDown}
                        >
                            <div className="public-home__concept-header">
                                <strong>{concept.label}</strong>
                                <span
                                    className="public-home__concept-indicator"
                                    aria-hidden="true"
                                >
                                    <svg
                                        viewBox="0 0 12 8"
                                        focusable="false"
                                        aria-hidden="true"
                                    >
                                        <path d="m1 1 5 5 5-5" />
                                    </svg>
                                </span>
                            </div>
                            <div className="public-home__concept-body">
                                <p
                                    className="public-home__concept-summary"
                                    aria-hidden={isActive}
                                >
                                    {concept.description}
                                </p>
                                <div
                                    id={popoverId}
                                    className="public-home__concept-detail"
                                    role="region"
                                    aria-hidden={!isActive}
                                    aria-label={`${concept.label} explanation`}
                                >
                                    <p className="public-home__concept-detail-copy">
                                        {concept.detailLead}{' '}
                                        <a
                                            href={concept.documentationHref}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            {concept.technicalLabel}
                                            <span aria-hidden="true"> ↗</span>
                                            <span className="sr-only">
                                                {' '}
                                                (opens in a new tab)
                                            </span>
                                        </a>
                                        {concept.detailTail}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
};

const PublicHomePage = (): JSX.Element => {
    return (
        <div className="public-home">
            <PublicHeader />
            <main id="main-content" className="public-home__main">
                <section aria-labelledby="homepage-title">
                    <header className="public-home__intro">
                        <h1 id="homepage-title">AI that shows its work.</h1>
                        <p>
                            <span className="public-home__intro-sentence">
                                Most chatbots rush to give you a polished
                                answer,{' '}
                                <span className="public-home__no-wrap">
                                    even when they&apos;re wrong.
                                </span>
                            </span>{' '}
                            <span className="public-home__intro-sentence">
                                We care more about giving you answers that are
                                easy to check.
                            </span>
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
                            This is a prepared example —{' '}
                            <Link to="/chat">Ask a question</Link>
                        </p>
                    </div>
                </section>
                <section
                    className="public-home__narrative"
                    aria-labelledby="narrative-title"
                >
                    <h2 id="narrative-title">What to check</h2>
                    <PublicConceptList />
                </section>
                <section
                    className="public-home__get-started"
                    aria-labelledby="get-started-title"
                >
                    <h2 id="get-started-title">Run it yourself</h2>
                    <p>
                        Footnote is open source and can run on your own
                        computer.
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
                            Setup guide
                        </a>
                    </div>
                </section>
            </main>
            <PublicFooter />
        </div>
    );
};

export default PublicHomePage;
