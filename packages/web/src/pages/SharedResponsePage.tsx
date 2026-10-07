/**
 * @description: Displays only the backend-approved projection of an explicitly published response.
 * @footnote-scope: web
 * @footnote-module: SharedResponsePage
 * @footnote-risk: high - Rendering mistakes could turn a narrow public artifact into a trace view.
 * @footnote-ethics: high - This anonymous page presents content the response author deliberately published.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { GetPublicResponseResponse } from '@footnote/contracts/web';
import PublicPageLayout from '@components/PublicPageLayout';
import MarkdownResponse from '@components/MarkdownResponse';
import { api } from '../utils/api';

type PageState =
    | { status: 'loading' }
    | { status: 'unavailable' }
    | { status: 'ready'; response: GetPublicResponseResponse };

const formatPublishedDate = (value: string): string => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? 'Date unavailable'
        : date.toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
          });
};

const SharedResponsePage = (): JSX.Element => {
    const { publicId } = useParams<{ publicId: string }>();
    const [pageState, setPageState] = useState<PageState>({
        status: 'loading',
    });

    useEffect(() => {
        const controller = new AbortController();
        if (!publicId) {
            setPageState({ status: 'unavailable' });
            return () => controller.abort();
        }

        setPageState({ status: 'loading' });
        void api
            .getPublicResponse(publicId, { signal: controller.signal })
            .then((result) => {
                if (result.status === 200 && 'answer' in result.data) {
                    setPageState({ status: 'ready', response: result.data });
                } else {
                    setPageState({ status: 'unavailable' });
                }
            })
            .catch(() => setPageState({ status: 'unavailable' }));

        return () => controller.abort();
    }, [publicId]);

    return (
        <PublicPageLayout>
            <main
                id="main-content"
                className="public-page__main shared-response-page"
                aria-labelledby="shared-response-title"
            >
                <section className="public-page__intro">
                    <p className="public-page__eyebrow">Public response</p>
                    <h1 id="shared-response-title">Published answer</h1>
                    {pageState.status === 'loading' && (
                        <p role="status">Loading published response…</p>
                    )}
                    {pageState.status === 'unavailable' && (
                        <p role="status">
                            This published response is no longer available.
                        </p>
                    )}
                    {pageState.status === 'ready' && (
                        <>
                            <p className="shared-response-page__published">
                                Published{' '}
                                {formatPublishedDate(
                                    pageState.response.publishedAt
                                )}
                            </p>
                            <article className="shared-response-page__answer public-message public-message--assistant">
                                <MarkdownResponse
                                    markdown={pageState.response.answer}
                                />
                            </article>
                            <section
                                className="shared-response-page__details"
                                aria-labelledby="shared-response-provenance"
                            >
                                <h2 id="shared-response-provenance">
                                    Provenance
                                </h2>
                                <p>
                                    Recorded as{' '}
                                    <strong>
                                        {pageState.response.provenance.toLowerCase()}
                                    </strong>
                                    .
                                </p>
                                {pageState.response.limitations.length > 0 && (
                                    <>
                                        <h3>Limitations</h3>
                                        <ul>
                                            {pageState.response.limitations.map(
                                                (limitation, index) => (
                                                    <li
                                                        key={`${index}-${limitation}`}
                                                    >
                                                        {limitation}
                                                    </li>
                                                )
                                            )}
                                        </ul>
                                    </>
                                )}
                                <p className="shared-response-page__expiry">
                                    This page expires{' '}
                                    {formatPublishedDate(
                                        pageState.response.expiresAt
                                    )}
                                    .
                                </p>
                            </section>
                        </>
                    )}
                </section>
            </main>
        </PublicPageLayout>
    );
};

export default SharedResponsePage;
