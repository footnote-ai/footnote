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
    report: 'available' | 'unknown' | 'stale' | 'unavailable'
): string =>
    renderToStaticMarkup(
        <CanonicalResponseFootnote
            metadata={metadata}
            artifacts={{ trace, report }}
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
    const barMatch = markup.match(
        new RegExp(
            `<div[^>]*class="canonical-response-footnote__bar canonical-response-footnote__axis--${axis}"[\\s\\S]*?<\\/div>`,
            'm'
        )
    );
    return barMatch ? count(barMatch[0], /class="is-filled"/g) : 0;
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
    assert.match(markup, /TRACE describes posture, not answer quality/);
    assert.match(markup, /<summary>Sources<\/summary>/);
    assert.match(markup, /<summary>Controls<\/summary>/);
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
    assert.match(markup, /canonical-response-footnote__wheel-missing/);
});

test('rendered safety summary keeps sensitivity separate from divergent evaluator facts', () => {
    const markup = render(
        toFootnote(fixture.safetyDivergent),
        'unknown',
        'unavailable'
    );

    assert.match(markup, /Sensitivity: Low/);
    assert.match(markup, /Evaluator: enforce \/ block \/ Evaluator tier High/);
});

test('rendered safety summary marks a missing evaluator unavailable', () => {
    const markup = render(
        toFootnote(fixture.partial),
        'unknown',
        'unavailable'
    );

    assert.match(markup, /Sensitivity: Medium/);
    assert.match(markup, /Evaluator: Unavailable/);
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
});

test('rendered live fixture keeps unknown Trace link honest and Report disabled', () => {
    const markup = render(
        toFootnote(fixture.complete),
        'unknown',
        'unavailable'
    );

    assert.match(markup, /href="\/traces\/response-footnote-fixture-complete"/);
    assert.match(markup, /Availability unconfirmed/);
    assert.match(markup, /Unavailable on web/);
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

    assert.equal(ids.length, 4);
    assert.equal(new Set(ids).size, ids.length);
    assert.match(first, /data-state="unavailable"/);
    assert.match(first, /Trace.*Unavailable/);
    assert.match(first, /Report.*Unavailable/);
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
    assert.match(styles, /@media \(max-width: 480px\)/);
    assert.match(styles, /@media \(max-width: 700px\)/);
});
