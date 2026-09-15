/**
 * @description: Verifies canonical trace-card SVG rendering and PNG conversion behavior.
 * @footnote-scope: test
 * @footnote-module: TraceCardRendererTests
 * @footnote-risk: low - Test-only checks for deterministic rendering and rasterization invariants.
 * @footnote-ethics: low - Uses synthetic TRACE values and no user-identifying data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResponseFootnote } from '@footnote/contracts/policy';
import { projectResponseFootnote } from '@footnote/contracts/policy';
import fixture from '../../contracts/test/fixtures/response-footnote.json' with { type: 'json' };

import { renderTraceCardPng } from '../src/services/traceCard/traceCardRaster.js';
import { renderTraceCardSvg } from '../src/services/traceCard/traceCardSvg.js';

/**
 * Reads PNG dimensions directly from IHDR bytes.
 * PNG stores width/height as 32-bit big-endian integers at bytes 16..23.
 */
const readPngDimensions = (png: Buffer): { width: number; height: number } => {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    return { width, height };
};

const countMatches = (value: string, regex: RegExp): number =>
    (value.match(regex) ?? []).length;

const fixtureFootnote = fixture.complete as ResponseFootnote;

test('renderTraceCardSvg uses 5 wheel bands and renders metadata rows for valid scores', () => {
    const svg = renderTraceCardSvg({
        temperament: {
            tightness: 5,
            rationale: 5,
            attribution: 5,
            caution: 5,
            extent: 5,
        },
        chips: {
            evidenceScore: 5,
            freshnessScore: 4,
        },
    });

    assert.match(svg, /width="172"/);
    assert.match(svg, /height="40"/);
    assert.match(svg, /<circle cx="20" cy="20" r="19"/);
    assert.match(svg, /id="trace-icon-evidence"/);
    assert.match(svg, /id="trace-icon-freshness"/);
    assert.equal(countMatches(svg, /fill="#CBD5E1"/g), 2);
    assert.equal(countMatches(svg, /stroke="#CBD5E1"/g), 2);
    assert.equal(countMatches(svg, /stroke-opacity="0.3"/g), 10);
    assert.equal(
        countMatches(svg, /fill="(#008080|#9A6373|#E6AC00|#B87333|#5E7C5B)"/g),
        25
    );
    assert.equal(countMatches(svg, /fill="#8FA3BE"/g), 9);
    assert.equal(countMatches(svg, /fill="#EF4444" fill-opacity="0.45"/g), 0);
});

test('renderTraceCardSvg draws red fallback wedges for missing axes and gray chip rows for missing chip scores', () => {
    const svg = renderTraceCardSvg({
        temperament: {
            tightness: 3,
        },
        chips: {},
    });

    assert.equal(countMatches(svg, /fill="#EF4444" fill-opacity="0.45"/g), 4);
    assert.equal(countMatches(svg, /fill="#EF4444" fill-opacity="0.2"/g), 0);
    assert.equal(countMatches(svg, /fill="#D1D5DB" fill-opacity="0.06"/g), 10);
    assert.equal(countMatches(svg, /fill="#8FA3BE"/g), 0);
});

test('renderTraceCardSvg treats invalid input values as missing', () => {
    const invalidInput = {
        temperament: {
            tightness: 7,
            rationale: 0,
        },
        chips: {
            evidenceScore: 2.4,
            freshnessScore: 6,
        },
    } as unknown as Parameters<typeof renderTraceCardSvg>[0];
    const svg = renderTraceCardSvg(invalidInput);

    assert.equal(countMatches(svg, /fill="#EF4444" fill-opacity="0.45"/g), 5);
    assert.equal(countMatches(svg, /fill="#EF4444" fill-opacity="0.2"/g), 0);
    assert.equal(countMatches(svg, /fill="#D1D5DB" fill-opacity="0.06"/g), 10);
});

test('renderTraceCardPng returns PNG bytes with expected signature and dimensions', () => {
    const requestedWidth = 448;
    const requestedHeight = 96;
    const { png } = renderTraceCardPng({
        temperament: {
            tightness: 4,
            rationale: 3,
            attribution: 5,
            caution: 2,
            extent: 4,
        },
        chips: {
            evidenceScore: 4,
            freshnessScore: 3,
        },
        width: requestedWidth,
        height: requestedHeight,
    });

    assert.equal(png[0], 0x89);
    assert.equal(png[1], 0x50);
    assert.equal(png[2], 0x4e);
    assert.equal(png[3], 0x47);

    const dimensions = readPngDimensions(png);
    assert.equal(dimensions.width, requestedWidth);
    assert.equal(dimensions.height, requestedHeight);
});

test('renderTraceCardSvg uses the shared response projection for semantic PNG cards', () => {
    const projection = projectResponseFootnote({
        metadata: fixtureFootnote,
        artifacts: { trace: 'available', report: 'unavailable' },
    });
    const { svg, png } = renderTraceCardPng({ projection });

    assert.match(svg, /width="860"/);
    assert.match(svg, /height="470"/);
    assert.match(svg, /Evidence/);
    assert.match(svg, /Recorded fixture license/);
    assert.match(svg, /Efficient use of space and/);
    assert.match(svg, /attention\./);
    assert.match(svg, /Separates sourced and/);
    assert.match(svg, /inferred content\./);
    assert.match(svg, /Final 5\/5/);
    assert.match(svg, /Target 4\/5/);
    assert.match(svg, /TRACE describes posture, not answer quality\./);
    assert.doesNotMatch(svg, /trace-icon-evidence/);
    assert.doesNotMatch(svg, /Freshness/);
    assert.equal(readPngDimensions(png).width, 860);
    assert.equal(readPngDimensions(png).height, 470);

    for (const [axis, score] of Object.entries({
        tightness: 4,
        rationale: 3,
        attribution: 5,
        caution: 4,
        extent: 2,
    })) {
        const axisMarkup = svg.match(
            new RegExp(`<rect data-axis="${axis}"[^>]*/>`, 'g')
        );
        assert.equal(axisMarkup?.length, 5);
        assert.equal(
            axisMarkup?.filter((rect) => rect.includes('fill-opacity="0.9"'))
                .length,
            score
        );
    }
});

test('semantic card keeps missing final axes neutral and visibly unavailable', () => {
    const projection = projectResponseFootnote({
        metadata: fixture.partial as ResponseFootnote,
        artifacts: { trace: 'available', report: 'unavailable' },
    });
    const svg = renderTraceCardSvg({ projection });

    assert.equal(countMatches(svg, /fill="#3F3C35" fill-opacity="0.22"/g), 4);
    assert.match(svg, /Final unavailable/);
});
