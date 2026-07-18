/**
 * @description: Provides the shared public header, content frame, and footer for non-home web routes.
 * @footnote-scope: web
 * @footnote-module: PublicPageLayout
 * @footnote-risk: low - This presentational shell affects route consistency but not route behavior or data handling.
 * @footnote-ethics: low - A consistent shell helps people recognize public Footnote surfaces without changing their content.
 */

import type { PropsWithChildren } from 'react';
import PublicFooter from './PublicFooter';
import PublicHeader from './PublicHeader';

/** Keeps standalone routes visually aligned with the public homepage. */
const PublicPageLayout = ({ children }: PropsWithChildren): JSX.Element => (
    <div className="public-page">
        <PublicHeader />
        {children}
        <PublicFooter />
    </div>
);

export default PublicPageLayout;
