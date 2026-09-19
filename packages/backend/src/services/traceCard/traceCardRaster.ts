/**
 * @description: Converts canonical trace-card SVG into PNG bytes for Discord-compatible delivery.
 * @footnote-scope: utility
 * @footnote-module: TraceCardRasterizer
 * @footnote-risk: medium - Conversion failures can block image delivery for preview command responses.
 * @footnote-ethics: low - Rasterization changes image format only; provenance semantics stay in canonical SVG.
 */
import { fileURLToPath } from 'node:url';
import { Resvg, type ResvgRenderOptions } from '@resvg/resvg-js';
import {
    renderTraceCardSvg,
    type TraceCardRenderInput,
} from './traceCardSvg.js';

const TRACE_CARD_FONT_FILES = [
    fileURLToPath(
        new URL(
            '../../../../../docs/assets/fonts/BarlowCondensed-Regular.ttf',
            import.meta.url
        )
    ),
    fileURLToPath(
        new URL(
            '../../../../../docs/assets/fonts/LibreBaskerville-wght.ttf',
            import.meta.url
        )
    ),
    fileURLToPath(
        new URL(
            '../../../../../docs/assets/fonts/IBMPlexMono-Regular.ttf',
            import.meta.url
        )
    ),
];

/**
 * Returns deterministic raster options so Discord cards do not depend on the
 * host image's installed font set. Missing fonts otherwise make resvg render
 * the wheel and bars while silently omitting every text node.
 */
export const createTraceCardRasterOptions = (): ResvgRenderOptions => ({
    font: {
        fontFiles: TRACE_CARD_FONT_FILES,
        loadSystemFonts: false,
        defaultFontFamily: 'Barlow Condensed',
        sansSerifFamily: 'Barlow Condensed',
        serifFamily: 'Libre Baskerville',
        monospaceFamily: 'IBM Plex Mono',
    },
});

/**
 * Renders a trace-card PNG from the canonical SVG source.
 * Returns both forms so callers can persist SVG and respond with PNG.
 */
export const renderTraceCardPng = (
    input: TraceCardRenderInput
): { svg: string; png: Buffer } => {
    const svg = renderTraceCardSvg(input);
    const resvg = new Resvg(svg, createTraceCardRasterOptions());
    const png = Buffer.from(resvg.render().asPng());

    return { svg, png };
};
