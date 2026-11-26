/**
 * Turns reader typography into the CSS injected into a chapter.
 *
 * The escalation policy: only the properties the reader owns are overridden,
 * and only with `!important`, because EPUB inline styles beat a normal
 * stylesheet. Elements the reader must not reflow — figures, tables, code and
 * whitespace-preserved blocks — are deliberately exempt.
 *
 * ## Page geometry lives here
 *
 * Pagination measures the DOM, so this CSS is what makes the measurement
 * correct. It sets up:
 *
 *   html    the page box: exactly the frame, clipping the column strip
 *   body    the column container: no padding, exactly one page tall, columns
 *           contiguous (`column-gap: 0`), so column *n* begins at exactly
 *           *n* × columnWidth and the translate stride is the page width
 *   blocks  the page margin and the spread gutter, as inline padding on the
 *           text, so the whitespace is real without perturbing the arithmetic
 */

import type { BookTypography, ReaderMode, ReaderTheme } from './readerSettings';

const FONT_STACKS: Record<BookTypography['fontFamily'], string | null> = {
  // "book" leaves the publisher's font alone.
  book: null,
  serif: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif",
  sans: "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif",
  dyslexic: "'OpenDyslexic', 'Comic Sans MS', 'Verdana', sans-serif",
};

export const THEMES: Record<ReaderTheme, { surface: string; ink: string; muted: string; raised: string; border: string }> =
  {
    paper: { surface: '#fffdf8', ink: '#211d17', muted: '#5d5448', raised: '#f7f3ea', border: '#e4dbc9' },
    sepia: { surface: '#f4ecd8', ink: '#3b3121', muted: '#6b5c42', raised: '#e9dfc6', border: '#d8cbb0' },
    night: { surface: '#14110e', ink: '#e6ddcc', muted: '#a99c86', raised: '#1e1a16', border: '#322b23' },
  };

/** Space between the two columns of a spread, in CSS px. */
export const COLUMN_GUTTER = 48;

export interface CssInput {
  typography: BookTypography;
  mode: ReaderMode;
  theme: ReaderTheme;
  /** How many columns a page holds. */
  columns: 1 | 2;
}

export function buildReaderCss({ typography: t, mode, theme, columns }: CssInput): string {
  const palette = THEMES[theme];
  const fontStack = FONT_STACKS[t.fontFamily];
  const own = mode === 'own';
  // The paginator overwrites these with exact measurements; these initial
  // values are what the first paint uses, so a spread never flashes
  // gutterless or marginless text before the measurement lands.
  const gutter = columns === 2 ? COLUMN_GUTTER / 2 : 0;
  const margin = t.marginPercent;

  // In preserve mode only size and spacing are ours; in own mode we also take
  // over the font and the paragraph rhythm.
  const bodyDecls = [
    `font-size: ${t.fontSizePx}px !important`,
    `line-height: ${t.lineHeight} !important`,
    `color: ${palette.ink} !important`,
    t.letterSpacingEm !== 0 ? `letter-spacing: ${t.letterSpacingEm}em !important` : '',
    t.wordSpacingEm !== 0 ? `word-spacing: ${t.wordSpacingEm}em !important` : '',
    own && fontStack ? `font-family: ${fontStack} !important` : '',
  ]
    .filter(Boolean)
    .join('; ');

  const textBlockDecls = [
    // The measure is a maximum on the text, not on the container: a max-width
    // on the container would fight the multi-column layout.
    `max-inline-size: none`,
    // The page margin and the spread gutter are both inline padding on the text
    // blocks, never on the column container. That is deliberate: padding on the
    // container would shrink the content box the columns are measured from, so
    // the column pitch would stop matching the page stride and every page after
    // the first would slide out of the frame.
    `padding-inline: calc(var(--reader-margin, ${margin}%) + var(--reader-gutter, ${gutter}px))`,
  ].join('; ');

  const paragraphDecls = [
    `margin-block: 0 ${t.paragraphSpacingEm}em !important`,
    t.alignment === 'left' ? `text-align: left !important` : '',
    t.alignment === 'justify' ? `text-align: justify !important` : '',
    t.hyphenation === 'on'
      ? `hyphens: auto !important; -webkit-hyphens: auto !important`
      : t.hyphenation === 'off'
        ? `hyphens: manual !important; -webkit-hyphens: manual !important`
        : '',
    own && t.indentEm > 0
      ? `text-indent: ${t.indentEm}em !important`
      : own && t.indentEm === 0
        ? `text-indent: 0 !important`
        : '',
  ]
    .filter(Boolean)
    .join('; ');

  // Reflowing these breaks them; they keep their own geometry.
  const EXEMPT = 'figure, table, pre, code, math, svg, img';
  const MEASURE = `${t.measureCh}ch`;

  return `
:root {
  color-scheme: ${theme === 'night' ? 'dark' : 'light'};
  /* The page box. Its width is the paginator's translate stride: page n starts
     at exactly n × width, with no margin arithmetic in between. */
  box-sizing: border-box;
  height: 100% !important;
  width: 100% !important;
  padding: 0 !important;
  margin: 0 !important;
  background: ${palette.surface} !important;
  overflow: hidden !important;
}
html, body { margin: 0 !important; }
html { background: ${palette.surface} !important; }
body {
  ${bodyDecls};
  /* The body paints the page surface itself. Leaving it transparent makes the
     reader theme depend on whatever sits behind the frame, which breaks night
     mode the moment the surrounding chrome changes colour. */
  background: ${palette.surface} !important;
  box-sizing: border-box;
  /* The column container. No padding: page n starts at exactly n × 100%, so the
     translate stride and the column pitch are the same number by construction.
     The page margin lives on the text blocks instead. */
  width: 100% !important;
  padding: 0 !important;
  /* One page tall: with column-fill:auto the browser fills a column to this
     height and flows the remainder into the next column. */
  height: 100% !important;
  margin: 0 !important;
  -webkit-text-size-adjust: 100%;
  overflow-wrap: break-word;
  transform: translateX(0);
  will-change: transform;
}
#book-content {
  /* No measure cap here: the page width already limits the line, and a cap
     would break the column arithmetic. */
  max-inline-size: none;
  margin-inline: 0;
  /* The writing margin is real space kept free at the end of each page's text,
     so marginalia have somewhere to go. It is padding rather than a column gap
     so that the column pitch stays exactly the page stride. */
  ${t.writingMarginPercent > 0 ? `padding-inline-end: ${t.writingMarginPercent}% !important;` : ''}
}
/* Text blocks carry the measure and the spread gutter. */
#book-content > *,
#book-content p,
#book-content li,
#book-content dd,
#book-content blockquote,
#book-content h1,
#book-content h2,
#book-content h3,
#book-content h4,
#book-content h5,
#book-content h6 {
  ${textBlockDecls};
  max-inline-size: ${MEASURE};
  margin-inline: auto;
  box-sizing: border-box;
}
#book-content p,
#book-content li,
#book-content dd,
#book-content blockquote {
  ${paragraphDecls};
}
#book-content :not(${EXEMPT}) {
  line-height: inherit;
}
h1, h2, h3, h4, h5, h6 {
  line-height: 1.25 !important;
  color: ${palette.ink} !important;
  ${own && fontStack ? `font-family: ${fontStack} !important;` : ''}
  break-after: avoid-column;
}
/* Never split a figure across a column break. */
figure, table, pre, blockquote, img {
  break-inside: avoid-column;
}
a { color: ${theme === 'night' ? '#e08a5c' : '#8b3616'} !important; }
blockquote {
  padding-inline-start: 1em !important;
  border-inline-start: 1px solid ${palette.border} !important;
  color: ${palette.muted} !important;
}
pre, code { font-family: ui-monospace, 'Cascadia Code', monospace !important; }
pre {
  overflow-x: auto !important;
  padding: 0.8em !important;
  background: ${palette.raised} !important;
  border-radius: 6px !important;
}
figure, table { max-inline-size: 100% !important; }
/* Images fit beside the measure, and the max height is set by the paginator. */
img, svg, video {
  max-width: 100% !important;
  height: auto !important;
  object-fit: contain;
}
td, th { border: 1px solid ${palette.border} !important; padding: 4px 8px !important; }
figcaption { color: ${palette.muted} !important; font-size: 0.86em !important; }
`;
}

/** The narrowest a column may get before a spread stops being readable. */
const MIN_COMFORTABLE_CH = 40;

/**
 * How many columns a page should hold.
 *
 * Readest and foliate derive this as
 * `min(maxColumnCount, ceil(pageWidth / maxInlineSize))` — "fit as many columns
 * as the ideal column width allows, never more than the maximum". The
 * consequence that matters is that a column may come out *narrower* than ideal
 * when there is room for another one, which is how a 1280px window at 24px type
 * still gets two comfortable 53-character columns.
 *
 * The one guard the anchor does not have is a comfort floor: at 700px and 18px,
 * "ceil" would split into two 39-character columns, which is worse than one
 * full-width column. Below that floor, one column wins whatever was asked for.
 */
export function resolveColumns(
  choice: 'auto' | 1 | 2,
  frameWidth: number,
  fontSizePx: number,
  measureCh = 66,
): 1 | 2 {
  if (choice === 1) return 1;
  // Rough average glyph advance for a text face, in px.
  const glyph = fontSizePx * 0.5;
  const ideal = Math.max(1, measureCh * glyph);
  const floor = MIN_COMFORTABLE_CH * glyph;

  const divisor = Math.min(2, Math.max(1, Math.ceil(frameWidth / ideal)));
  if (divisor < 2) return 1;
  // Two columns are only worth it while each still reads as a line of text.
  return frameWidth / 2 >= floor ? 2 : 1;
}
