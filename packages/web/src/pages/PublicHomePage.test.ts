/**
 * @description: Protects the public homepage's approved prepared-answer presentation and cutover routing.
 * @footnote-scope: test
 * @footnote-module: PublicHomePageTests
 * @footnote-risk: low - Assertions cover static public page composition only.
 * @footnote-ethics: high - Tests prevent prepared content and the empty trace position from becoming misleading.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const webDirectory = path.join(process.cwd(), 'packages', 'web');
const webSourceDirectory = `${path.join(webDirectory, 'src')}${path.sep}`;
const pagesDirectory = `${path.join(webSourceDirectory, 'pages')}${path.sep}`;

test('public homepage keeps the approved hero, truthful handoff, and destinations', async () => {
    const source = await readFile(
        `${pagesDirectory}PublicHomePage.tsx`,
        'utf8'
    );

    assert.match(source, /<h1 id="homepage-title">/);
    assert.match(
        source,
        /See how an answer was made, set your own rules,[\s\S]*?run Footnote your way\./
    );
    assert.match(source, /AI that\s*<\/span>/);
    assert.match(source, /<em>shows its work\.<\/em>/);
    assert.doesNotMatch(source, /Prepared example · live chat starts here/);
    assert.match(source, /to="\/chat"/);
    assert.doesNotMatch(source, /ai\.jordanmakes\.dev\/ask/);
    assert.match(source, /canonical-response-footnote/);
    assert.doesNotMatch(source, /TraceFooterPlaceholder/);
    assert.match(source, /ResponseCarousel/);
    assert.match(source, /items=\{landingScenarios\}/);
    assert.match(
        source,
        /https:\/\/github\.com\/footnote-ai\/footnote\/releases/
    );
    assert.match(source, /href="\/wiki\/getting-started\/"/);
    assert.match(
        source,
        /documentationHref: '\/wiki\/architecture\/admin-settings-architecture\/'/
    );
    assert.match(source, />\s*Get started\s*</);
    assert.match(source, />\s*Setup guide\s*</);
    assert.match(source, />Run Footnote</);
    assert.match(source, /documentationLabel: 'Philosophy'/);
    assert.match(source, /Ask a question…/);
    assert.match(source, /documentationHref: '\/wiki\/deployment\/'/);
    assert.doesNotMatch(
        source,
        /Download Footnote|Quickstart|Privacy and control/
    );
});

test('public homepage presents plain-language blocks with useful documentation links', async () => {
    const source = await readFile(
        `${pagesDirectory}PublicHomePage.tsx`,
        'utf8'
    );

    assert.match(source, /className="public-home__concepts"/);
    for (const concept of [
        'see-what-happened',
        'your-rules',
        'run-it-your-way',
        'open-about-our-choices',
    ]) {
        assert.match(source, new RegExp(`id: '${concept}'`));
    }
    assert.match(source, />How we do things</);
    assert.match(source, /href=\{concept\.documentationHref\}/);
    assert.match(source, /See what happened/);
    assert.match(source, /Your rules/);
    assert.match(source, /Run it your way/);
    assert.match(source, /Open about our choices/);
    assert.match(source, /documentationLabel: 'How answers are explained'/);
    assert.match(source, /documentationLabel: 'Configuration'/);
    assert.match(source, /documentationLabel: 'Deployment'/);
    assert.match(source, /documentationLabel: 'Philosophy'/);
    assert.doesNotMatch(source, /Building for v1|What to check/);
});

test('public footer points at canonical security and dual-license documentation', async () => {
    const [source, securitySource, philosophySource] = await Promise.all([
        readFile(
            `${webSourceDirectory}components${path.sep}PublicFooter.tsx`,
            'utf8'
        ),
        readFile(path.join(process.cwd(), 'SECURITY.md'), 'utf8'),
        readFile(path.join(process.cwd(), 'docs', 'Philosophy.md'), 'utf8'),
    ]);

    assert.match(
        source,
        /href="\/wiki\/philosophy\/#licensing-and-its-tension">\s*\{homepage \? 'Licensing'/
    );
    assert.match(source, /homepage \? 'Privacy' : 'Security & privacy'/);
    assert.doesNotMatch(source, /href="\/wiki\/philosophy\/">Privacy</);
    assert.match(
        securitySource,
        /security\*\*, \*\*privacy\*\*, or \*\*ethical-safety\*\* issue/
    );
    assert.match(philosophySource, /MIT and Hippocratic License terms/);
});

test('response carousel owns the preserved transition and accessible dot controls', async () => {
    const source = await readFile(
        `${webSourceDirectory}components${path.sep}ResponseCarousel.tsx`,
        'utf8'
    );

    assert.match(source, /setIsTransitioning\(true\)/);
    assert.match(source, /aria-pressed/);
    assert.match(source, /ArrowLeft/);
    assert.match(source, /ArrowRight/);
    assert.match(source, /tabIndex=\{0\}/);
    assert.match(source, /role="group"/);
    assert.match(source, /showPreviousNextControls/);
    assert.match(source, /const activeIndex = normalizeInitialIndex/);
    assert.match(source, /items\[activeIndex\]/);
});

test('public cutover removes the design-lab route', async () => {
    const appSource = await readFile(`${webSourceDirectory}App.tsx`, 'utf8');

    assert.match(appSource, /path="\/" element={<PublicHomePage \/>}/);
    assert.match(appSource, /path="\/chat"/);
    assert.match(appSource, /<ChatPage \/>/);
    assert.doesNotMatch(appSource, /design-lab/);
    assert.doesNotMatch(appSource, /AskMeAnything/);
});

test('chat stays suggestion-free and falls back to an out-of-flow managed challenge', async () => {
    const [
        chatSource,
        chatPageSource,
        embedSource,
        headerSource,
        interactionStyles,
    ] = await Promise.all([
        readFile(`${webSourceDirectory}components/Chat.tsx`, 'utf8'),
        readFile(`${pagesDirectory}ChatPage.tsx`, 'utf8'),
        readFile(`${pagesDirectory}EmbedPage.tsx`, 'utf8'),
        readFile(`${webSourceDirectory}components/PublicHeader.tsx`, 'utf8'),
        readFile(`${webSourceDirectory}styles/interaction.css`, 'utf8'),
    ]);

    assert.match(chatSource, /const Chat =/);
    assert.doesNotMatch(chatSource, /AskMeAnything/);
    assert.doesNotMatch(chatSource, /console\./);
    assert.doesNotMatch(chatSource, /PreparedLandingConversation/);
    assert.doesNotMatch(chatSource, /getPreparedLandingConversations/);
    assert.doesNotMatch(chatSource, /currentScenario/);
    assert.doesNotMatch(chatSource, /language: 'auto'/);
    assert.match(chatSource, /size: 'invisible'/);
    assert.match(chatSource, /execution: 'execute'/);
    assert.match(chatSource, /appearance: 'execute'/);
    assert.match(chatSource, /size: 'normal'/);
    assert.match(chatSource, /isManagedChallengeVisible/);
    assert.match(chatSource, /showManagedChallenge/);
    assert.match(chatSource, /language: 'en'/);
    assert.match(chatSource, /theme,/);
    assert.match(
        chatPageSource,
        /Ask anything, and see how Footnote responds!/
    );
    assert.match(embedSource, /<Chat \/>/);
    assert.match(headerSource, /<Link to="\/account">\s*Sign in\s*<\/Link>/);
    assert.match(headerSource, /<a href="\/wiki\/">\s*Docs\s*<\/a>/);
    assert.match(headerSource, /Footnote<sup>\[1\]<\/sup>/);
    assert.doesNotMatch(headerSource, /deepwiki\.com/);
    assert.doesNotMatch(headerSource, /Sign-in is not available yet/);
    assert.match(
        interactionStyles,
        /\.interaction-captcha--invisible[\s\S]*?position: absolute[\s\S]*?width: 0[\s\S]*?height: 0[\s\S]*?overflow: hidden/
    );
    assert.match(interactionStyles, /\.interaction-captcha--managed/);
});

test('route fallback is a flat, spinner-only loading state', async () => {
    const [appSource, publicStyles, preloadSource] = await Promise.all([
        readFile(`${webSourceDirectory}App.tsx`, 'utf8'),
        readFile(`${webSourceDirectory}styles/public-home.css`, 'utf8'),
        readFile(path.join(webDirectory, 'index.html'), 'utf8'),
    ]);

    assert.match(appSource, /route-loading-shell/);
    assert.match(appSource, /spinner route-loading-spinner/);
    assert.match(appSource, /<div role="status" aria-live="polite">/);
    assert.match(appSource, /Loading page\./);
    assert.doesNotMatch(appSource, /<main[^>]*role="status"/);
    assert.doesNotMatch(appSource, /route-loading-card/);
    assert.doesNotMatch(appSource, /route-loading-title/);
    assert.match(appSource, /PublicPageLayout/);
    assert.match(
        publicStyles,
        /\.route-loading-shell[\s\S]*?min-height: calc\(100vh - 14rem\)/
    );
    assert.doesNotMatch(preloadSource, /preload-shell__card/);
    assert.doesNotMatch(preloadSource, /Loading page\.\.\./);
    assert.match(
        preloadSource,
        /localStorage\.getItem\('footnote-theme-preference'\)/
    );
    assert.match(preloadSource, /:root\[data-theme='dark'\]/);
});

test('homepage projects prepared metadata through the canonical footnote', async () => {
    const [pageSource, stylesSource] = await Promise.all([
        readFile(`${pagesDirectory}PublicHomePage.tsx`, 'utf8'),
        readFile(`${webSourceDirectory}styles/public-home.css`, 'utf8'),
    ]);

    assert.match(pageSource, /<CanonicalResponseFootnote/);
    assert.match(
        pageSource,
        /metadata=\{[\s\S]*?scenario\.response\.metadata[\s\S]*?\}/
    );
    assert.match(pageSource, /trace: 'unavailable'/);
    assert.match(pageSource, /report: 'unavailable'/);
    assert.doesNotMatch(pageSource, /Prepared example · live chat starts here/);
    assert.match(pageSource, /to="\/chat"/);
    assert.doesNotMatch(pageSource, /prepared-landing|\/traces\/prepared/);
    assert.match(stylesSource, /\.public-home__scenario-dots/);
    assert.match(stylesSource, /\.public-home__scenario-dot--selected/);
    assert.match(
        stylesSource,
        /\.public-home__response \.response-carousel__navigation--inline[\s\S]*?margin-top: 1\.05rem[\s\S]*?margin-bottom: 1\.1rem/
    );
    assert.match(
        stylesSource,
        /\.public-home \.canonical-response-footnote[\s\S]*?margin: 1\.25rem 0/
    );
    assert.match(stylesSource, /opacity 180ms ease/);
    assert.match(stylesSource, /\.public-header nav[\s\S]*?flex-wrap: wrap/);
    assert.match(stylesSource, /\.public-footer[\s\S]*?padding: 2rem 0 3rem/);
    assert.match(stylesSource, /@media \(max-width: 280px\)/);
    assert.match(stylesSource, /\.public-home__main > section \{/);
    assert.doesNotMatch(stylesSource, /\.public-home section \{/);
    assert.match(
        stylesSource,
        /\.public-home \.canonical-response-footnote[\s\S]*?width: 100%/
    );
    assert.doesNotMatch(
        stylesSource,
        /\.public-home \.canonical-response-footnote__summary-safety/
    );
    assert.match(stylesSource, /\.public-home__concept-art/);
    assert.match(stylesSource, /grid-template-columns: 1\.9fr 1fr 1fr/);
    assert.match(
        stylesSource,
        /\.public-home__concept-wrap--open-about-our-choices/
    );
    assert.match(
        stylesSource,
        /#root:has\(.app-shell--public\)[\s\S]*?min-width: 0/
    );
    assert.match(
        stylesSource,
        /\.public-home__response > \.response-carousel__item-and-navigation[\s\S]*?width: 100%[\s\S]*?max-width: 100%/
    );
    assert.match(
        stylesSource,
        /\.public-home__response > \.response-carousel__item-and-navigation > \.public-message--person[\s\S]*?justify-self: end/
    );
});

test('standalone routes use the shared public shell without changing their route behavior', async () => {
    const [layoutSource, setupSource, embedSource, traceSource, traceStyles] =
        await Promise.all([
            readFile(
                `${webSourceDirectory}components/PublicPageLayout.tsx`,
                'utf8'
            ),
            readFile(`${pagesDirectory}SetupPage.tsx`, 'utf8'),
            readFile(`${pagesDirectory}EmbedPage.tsx`, 'utf8'),
            readFile(`${pagesDirectory}TracePage.tsx`, 'utf8'),
            readFile(`${webSourceDirectory}styles/trace.css`, 'utf8'),
        ]);

    assert.match(layoutSource, /PublicHeader/);
    assert.match(layoutSource, /PublicFooter/);
    assert.match(setupSource, /<PublicPageLayout>/);
    assert.match(embedSource, /<PublicPageLayout>/);
    assert.match(embedSource, /createEmbedHeightMessenger/);
    assert.match(traceSource, /<PublicPageLayout>/);
    assert.match(traceSource, /trace-safety-indicator/);
    assert.doesNotMatch(traceSource, /style=\{\{/);
    assert.match(traceStyles, /\.trace-prompt-block/);
    assert.match(traceStyles, /\.trace-raw-json/);
});

test('chat request cleanup distinguishes timeouts from replaced requests', async () => {
    const chatSource = await readFile(
        `${webSourceDirectory}components/Chat.tsx`,
        'utf8'
    );

    assert.match(chatSource, /let didRequestTimeout = false/);
    assert.match(chatSource, /didRequestTimeout = true/);
    assert.match(chatSource, /The request timed out\. Please try again\./);
    assert.match(chatSource, /abortRef\.current === controller/);
    assert.match(chatSource, /abortRef\.current = null/);
});
