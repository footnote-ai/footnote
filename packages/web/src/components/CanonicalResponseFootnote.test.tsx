/**
 * @description: Exercises the rendered canonical response-footnote DOM with shared metadata fixtures.
 * @footnote-scope: test
 * @footnote-module: CanonicalResponseFootnoteRenderedTests
 * @footnote-risk: low - Rendered contract assertions protect visual state mapping without adding runtime authority.
 * @footnote-ethics: high - Tests prevent unavailable facts or actions from appearing available to users.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResponseFootnote } from '@footnote/contracts/policy';
import CanonicalResponseFootnote from './CanonicalResponseFootnote';
import fixture from '../../../contracts/test/fixtures/response-footnote.json' with { type: 'json' };

const toFootnote = (value: unknown): ResponseFootnote =>
    value as ResponseFootnote;

const render = (
    metadata: ResponseFootnote | null,
    trace: 'available' | 'unknown' | 'stale' | 'unavailable',
    report: 'available' | 'unknown' | 'stale' | 'unavailable',
    answerProvenanceEligible?: boolean
): string =>
    renderToStaticMarkup(
        <CanonicalResponseFootnote
            metadata={metadata}
            artifacts={{ trace, report }}
            answerProvenanceEligible={answerProvenanceEligible}
        />
    );

const count = (value: string, pattern: RegExp): number =>
    Array.from(value.matchAll(pattern)).length;

const axisPathCount = (markup: string, axis: string): number =>
    count(
        markup,
        new RegExp(
            `<path[^>]*class="canonical-response-footnote__axis--${axis}"`,
            'g'
        )
    );

const axisFilledBarCount = (markup: string, axis: string): number => {
    const barStart = markup.indexOf(
        `class="canonical-response-footnote__bar canonical-response-footnote__axis--${axis}"`
    );
    const descriptionStart = markup.indexOf(
        'class="canonical-response-footnote__axis-description"',
        barStart
    );
    return barStart >= 0 && descriptionStart > barStart
        ? count(markup.slice(barStart, descriptionStart), /class="is-filled"/g)
        : 0;
};

test('rendered complete fixture keeps wheel filled levels equal to final bars', () => {
    const markup = render(
        toFootnote(fixture.complete),
        'unknown',
        'unavailable'
    );
    const expected: Record<string, number> = {
        tightness: 4,
        rationale: 3,
        attribution: 5,
        caution: 4,
        extent: 2,
    };

    for (const [axis, score] of Object.entries(expected)) {
        assert.equal(axisPathCount(markup, axis), score);
        assert.equal(axisFilledBarCount(markup, axis), score);
    }
    assert.equal(
        count(markup, /canonical-response-footnote__wheel-background/g),
        25,
        'each axis keeps five pale unfilled levels behind its recorded fill'
    );
    assert.equal(
        count(markup, /canonical-response-footnote__wheel-separator/g),
        5,
        'the wheel keeps a separator for each visual wedge'
    );
    assert.match(markup, /TRACE describes posture, not answer quality/);
    assert.match(markup, /<span>Sources<\/span>/);
    assert.match(markup, /<span>Controls<\/span>/);
    assert.match(
        markup,
        /canonical-response-footnote__summary-safety[\s\S]*Sensitivity/
    );
    const summaryMarkup = markup.split(
        'class="canonical-response-footnote__trace"'
    )[0];
    assert.doesNotMatch(
        summaryMarkup,
        /Evaluator/,
        'evaluator diagnostics stay in the details disclosure'
    );
    assert.match(markup, /class="canonical-response-footnote__axis-label"/);
    assert.match(
        markup,
        /class="canonical-response-footnote__axis-description"/
    );
    for (const description of [
        'Space efficiency',
        'Reasoning level',
        'Connects to sources',
        'Care attention',
        'Breadth and coverage',
    ]) {
        assert.match(markup, new RegExp(description));
    }
    assert.doesNotMatch(
        markup,
        /data-active-axis=/,
        'the TRACE wheel starts neutral until an axis is hovered or selected'
    );
    assert.equal(
        count(markup, /class="canonical-response-footnote__wheel-hit-area/g),
        5,
        'each TRACE wedge exposes one keyboard and pointer target'
    );
    const wheelMarkup = markup.match(
        /<svg[^>]*canonical-response-footnote__wheel[\s\S]*?<\/svg>/
    )?.[0];
    assert.ok(wheelMarkup);
    assert.match(wheelMarkup, /role="group"/);
    assert.doesNotMatch(
        wheelMarkup,
        /role="img"[\s\S]*canonical-response-footnote__wheel-hit-area/
    );
    assert.equal(
        count(
            markup,
            /<button[^>]*class="canonical-response-footnote__axis-row/g
        ),
        5,
        'each axis row remains a native keyboard button'
    );
    assert.equal(
        count(markup, /class="canonical-response-footnote__axis-row/g),
        5,
        'each TRACE wedge has one linked axis row'
    );
    assert.match(
        markup,
        /M 120 120 L [\d.-]+ [\d.-]+ A/,
        'the first radial band must begin at the wheel center'
    );
    assert.equal(
        count(markup, /canonical-response-footnote__summary-item/g),
        3,
        'the glanceable summary keeps one primary fact per conceptual region'
    );
    assert.match(markup, /<h4>Workflow<\/h4>/);
    assert.match(markup, /Classification: Retrieved/);
    assert.match(
        markup,
        /Assessment method: Deterministic multi-signal provenance/
    );
    assert.match(markup, /Conflicts: none recorded/);
    assert.match(markup, /Limitations: none recorded/);
    assert.match(markup, /Sensitivity: Low/);
    assert.match(markup, /Evaluator: observe \/ allow \/ Evaluator tier Low/);
    assert.equal(
        count(
            markup,
            /class="canonical-response-footnote__details-secondary"/g
        ),
        0,
        'details must not create a separate visual band'
    );
});

test('rendered final score of one fills exactly one wheel level and bar', () => {
    const complete = toFootnote(fixture.complete);
    const boundary: ResponseFootnote = {
        ...complete,
        trace_target: { ...complete.trace_target, tightness: 1 },
        trace_final: { ...complete.trace_final, tightness: 1 },
    };
    const markup = render(boundary, 'available', 'unavailable');

    assert.equal(axisPathCount(markup, 'tightness'), 1);
    assert.equal(axisFilledBarCount(markup, 'tightness'), 1);
});

test('rendered enabled actions point to their shared drawers', () => {
    const markup = render(
        toFootnote(fixture.complete),
        'available',
        'available'
    );

    for (const action of ['sources', 'controls', 'trace', 'report']) {
        assert.match(
            markup,
            new RegExp(`aria-controls="[^"]+-${action}-drawer"`)
        );
    }
    assert.equal(
        count(markup, /class="canonical-response-footnote__drawer"/g),
        4
    );
    assert.doesNotMatch(
        markup,
        /class="canonical-response-footnote__drawer"[^>]*role="region"/
    );
});

test('rendered partial fixture keeps missing and target-only axes unavailable', () => {
    const markup = render(
        toFootnote(fixture.partial),
        'unknown',
        'unavailable'
    );

    assert.equal(axisPathCount(markup, 'tightness'), 3);
    assert.equal(axisFilledBarCount(markup, 'tightness'), 3);
    assert.equal(axisPathCount(markup, 'rationale'), 0);
    assert.equal(axisFilledBarCount(markup, 'rationale'), 0);
    assert.equal(axisPathCount(markup, 'caution'), 0);
    assert.equal(axisFilledBarCount(markup, 'caution'), 0);
    assert.match(markup, /Caution unavailable/);
    assert.match(markup, /Target 2 · Final unavailable/);
    assert.match(markup, /<title>Caution unavailable<\/title>/);
    assert.match(markup, /Workflow details unavailable/);
});

test('rendered safety summary keeps sensitivity separate from divergent evaluator facts', () => {
    const markup = render(
        toFootnote(fixture.safetyDivergent),
        'unknown',
        'unavailable'
    );

    assert.match(markup, /Sensitivity: Low/);
    assert.match(markup, /Evaluator: enforce \/ block \/ Evaluator tier High/);
    const summaryMarkup = markup.split(
        'class="canonical-response-footnote__trace"'
    )[0];
    assert.doesNotMatch(summaryMarkup, /Evaluator/);
});

test('rendered safety summary marks a missing evaluator unavailable', () => {
    const markup = render(
        toFootnote(fixture.partial),
        'unknown',
        'unavailable'
    );

    assert.match(markup, /Sensitivity: Medium/);
    assert.match(markup, /Evaluator: Unavailable/);
    const summaryMarkup = markup.split(
        'class="canonical-response-footnote__trace"'
    )[0];
    assert.doesNotMatch(summaryMarkup, /Evaluator/);
});
test('rendered prepared fixture exposes sources and controls but no Trace href', () => {
    const markup = render(
        toFootnote(fixture.prepared),
        'unavailable',
        'unavailable'
    );

    assert.match(markup, /Prepared source/);
    assert.match(markup, /workflow_mode/);
    assert.doesNotMatch(markup, /href="\/traces\//);
    assert.match(markup, /Report/);
    assert.match(markup, /disabled/);
    assert.match(markup, /canonical-response-footnote__action-status/);
    assert.match(markup, /Reporting is not available on this surface\./);
});

test('rendered live fixture keeps unknown Trace action honest and Report disabled', () => {
    const markup = render(
        toFootnote(fixture.complete),
        'unknown',
        'unavailable'
    );

    assert.match(markup, /<span>Trace<\/span>/);
    assert.match(markup, /aria-expanded="false"/);
    assert.doesNotMatch(
        markup,
        /href="\/traces\/response-footnote-fixture-complete"/
    );
    assert.match(
        markup,
        /Trace availability is not confirmed by the chat response\./
    );
    assert.doesNotMatch(markup, /Unavailable on web/);
});

test('rendered unavailable actions expose their projected reasons', () => {
    const nullMetadataMarkup = render(null, 'unavailable', 'unavailable');
    assert.match(nullMetadataMarkup, /Response metadata is unavailable\./);
    assert.match(
        nullMetadataMarkup,
        /No controls were recorded for this response\./
    );

    const partialMarkup = render(
        toFootnote(fixture.partial),
        'unavailable',
        'unavailable'
    );
    assert.match(partialMarkup, /Reporting is not available on this surface\./);
});

test('rendered ineligible response provenance is omitted', () => {
    const markup = render(
        toFootnote(fixture.complete),
        'available',
        'available',
        false
    );

    assert.equal(markup, '');
});

test('rendered citations link only safe http(s) URLs and retain unsafe text', () => {
    const complete = toFootnote(fixture.complete);
    const unsafe: ResponseFootnote = {
        ...complete,
        citations: [
            { title: 'Safe HTTP', url: 'https://example.com/safe' },
            { title: 'JavaScript citation', url: 'javascript:alert(1)' },
            { title: 'Data citation', url: 'data:text/plain,unsafe' },
        ],
    };
    const markup = render(unsafe, 'available', 'unavailable');

    assert.match(markup, /href="https:\/\/example\.com\/safe"/);
    assert.doesNotMatch(markup, /href="javascript:/);
    assert.doesNotMatch(markup, /href="data:/);
    assert.match(markup, /JavaScript citation/);
    assert.match(markup, /Data citation/);
});

test('rendered null metadata is unavailable and generated ids remain unique', () => {
    const first = renderToStaticMarkup(
        <>
            <CanonicalResponseFootnote
                metadata={null}
                artifacts={{ trace: 'available', report: 'available' }}
            />
            <CanonicalResponseFootnote
                metadata={null}
                artifacts={{ trace: 'available', report: 'available' }}
            />
        </>
    );
    const ids = [...first.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);

    assert.ok(ids.length > 4);
    assert.equal(new Set(ids).size, ids.length);
    assert.match(first, /data-state="unavailable"/);
    assert.match(first, /<span>Trace<\/span>/);
    assert.match(first, /<span>Report<\/span>/);
    assert.match(first, /canonical-response-footnote__action-status/);
    assert.match(first, /No controls were recorded for this response\./);
});

test('canonical stylesheet declares neutral missing token and narrow layout rules', async () => {
    const stylePath = path.join(
        process.cwd(),
        'packages',
        'web',
        'src',
        'styles',
        'canonical-response-footnote.css'
    );
    const styles = await readFile(stylePath, 'utf8');

    assert.match(
        styles,
        /--canonical-axis-missing:\s*var\(--fn-color-stone-300\)/
    );
    assert.match(styles, /@container \(max-width: 420px\)/);
    assert.match(styles, /container-type: inline-size/);
    assert.match(styles, /@container \(max-width: 820px\)/);
    assert.match(styles, /@container \(max-width: 560px\)/);
    assert.match(styles, /wheel-background/);
    assert.match(
        styles,
        /data-active-axis='rationale'\][^\n]*circle:not\(\.canonical-response-footnote__connector-source\)/
    );
    assert.match(
        styles,
        /data-active-axis='rationale'\][^\n]*canonical-response-footnote__connector-source \{ stroke: var\(--canonical-axis-rationale\)/
    );
    assert.match(
        styles,
        /canonical-response-footnote__drawer \{[^}]*grid-column: 1 \/ -1/
    );
    assert.doesNotMatch(
        styles,
        /canonical-response-footnote__axis-row:first-child/,
        'the first axis must not receive a default highlight'
    );
});
