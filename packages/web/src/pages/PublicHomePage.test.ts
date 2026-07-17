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

test('public homepage keeps approved prepared-response content and destinations', async () => {
    const source = await readFile(
        `${pagesDirectory}PublicHomePage.tsx`,
        'utf8'
    );

    assert.match(source, /AI that shows its work/);
    assert.match(source, /Most chatbots rush to give you a polished answer/);
    assert.match(source, /Pre-prepared response/);
    assert.match(source, /Ask anything/);
    assert.match(source, /https:\/\/ai\.jordanmakes\.dev\/ask/);
    assert.match(source, /TraceFooterPlaceholder/);
    assert.match(source, /landingScenarios\.map/);
    assert.match(source, /public-home__scenario-dot--selected/);
    assert.match(source, /setIsTransitioning\(true\)/);
    assert.match(
        source,
        /https:\/\/github\.com\/footnote-ai\/footnote\/releases/
    );
    assert.match(
        source,
        /https:\/\/github\.com\/footnote-ai\/footnote#quickstart/
    );
    assert.match(source, />\s*Download\s*</);
    assert.match(source, />\s*Documentation\s*</);
    assert.ok(
        source.indexOf('>\n                            Download') <
            source.indexOf('>\n                            Documentation')
    );
    assert.doesNotMatch(source, /Download Footnote/);
    assert.doesNotMatch(source, /Quickstart/);
});

test('public cutover removes the design-lab route', async () => {
    const appSource = await readFile(`${webSourceDirectory}App.tsx`, 'utf8');

    assert.match(appSource, /path="\/" element={<PublicHomePage \/>}/);
    assert.doesNotMatch(appSource, /design-lab/);
    assert.doesNotMatch(appSource, /AskMeAnything/);
});

test('route fallback is a flat, spinner-only loading state', async () => {
    const [appSource, layoutStyles, preloadSource] = await Promise.all([
        readFile(`${webSourceDirectory}App.tsx`, 'utf8'),
        readFile(`${webSourceDirectory}styles/layout.css`, 'utf8'),
        readFile(path.join(webDirectory, 'index.html'), 'utf8'),
    ]);

    assert.match(appSource, /className="route-loading-shell"/);
    assert.match(appSource, /spinner route-loading-spinner/);
    assert.doesNotMatch(appSource, /route-loading-card/);
    assert.doesNotMatch(appSource, /route-loading-title/);
    assert.match(layoutStyles, /\.route-loading-shell[\s\S]*?position: fixed/);
    assert.match(
        layoutStyles,
        /\.route-loading-shell[\s\S]*?background: var\(--fn-surface-bg\)/
    );
    assert.doesNotMatch(preloadSource, /preload-shell__card/);
    assert.doesNotMatch(preloadSource, /Loading page\.\.\./);
    assert.match(
        preloadSource,
        /localStorage\.getItem\('footnote-theme-preference'\)/
    );
    assert.match(preloadSource, /:root\[data-theme='dark'\]/);
});

test('trace placeholder is empty and joined to the assistant response', async () => {
    const [placeholderSource, stylesSource] = await Promise.all([
        readFile(
            `${webSourceDirectory}components/TraceFooterPlaceholder.tsx`,
            'utf8'
        ),
        readFile(`${webSourceDirectory}styles/public-home.css`, 'utf8'),
    ]);

    assert.match(placeholderSource, /aria-hidden="true"/);
    assert.match(stylesSource, /\.trace-footer-placeholder/);
    assert.match(stylesSource, /border-top: 0/);
    assert.match(stylesSource, /border-bottom-right-radius: 0/);
    assert.match(stylesSource, /border-bottom-left-radius: 0/);
    assert.match(stylesSource, /\.public-home__scenario-dots/);
    assert.match(stylesSource, /\.public-home__scenario-dot--selected/);
    assert.match(stylesSource, /opacity 180ms ease/);
    assert.match(stylesSource, /\.public-header nav[\s\S]*?flex-wrap: wrap/);
    assert.match(stylesSource, /\.public-footer[\s\S]*?padding: 2rem 0 3rem/);
    assert.match(stylesSource, /@media \(max-width: 280px\)/);
    assert.match(
        stylesSource,
        /\.public-message--person,[\s\S]*?max-width: 100%/
    );
    assert.match(
        stylesSource,
        /#root:has\(.app-shell--public-home\)[\s\S]*?min-width: 0/
    );
    assert.match(
        stylesSource,
        /\.public-message--person[\s\S]*?margin-right: 0\.75rem/
    );
});
