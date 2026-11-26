/**
 * Turns reader typography into the CSS injected into a chapter.
 *
 * The escalation policy: only the properties the reader owns are overridden,
 * and only with `!important`, because EPUB inline styles beat a normal
 * stylesheet. Elements the reader must not reflow — figures, tables, code and
 * whitespace-preserved blocks — are deliberately exempt.
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

export interface CssInput {
  typography: BookTypography;
  mode: ReaderMode;
  theme: ReaderTheme;
  /** 0 when the engine decided one column fits. */
  columns: 1 | 2;
}

export function buildReaderCss({ typography: t, mode, theme, columns }: CssInput): string {
  const palette = THEMES[theme];
  const fontStack = FONT_STACKS[t.fontFamily];
  const own = mode === 'own';

  // In preserve mode only size and spacing are ours; in own mode we also take
  // over the font and paragraph rhythm.
  const bodyDecls = [
    `font-size: ${t.fontSizePx}px !important`,
    `line-height: ${t.lineHeight} !important`,
    `color: ${palette.ink} !important`,
    `background: ${palette.surface} !important`,
    t.letterSpacingEm !== 0 ? `letter-spacing: ${t.letterSpacingEm}em !important` : '',
    t.wordSpacingEm !== 0 ? `word-spacing: ${t.wordSpacingEm}em !important` : '',
    own && fontStack ? `font-family: ${fontStack} !important` : '',
  ]
    .filter(Boolean)
    .join('; ');

  const contentDecls = [
    // Measure is applied to the text blocks, not the container: a max-width on
    // the container would fight the multi-column pagination.
    `max-inline-size: none`,
    `margin-inline: 0`,
  ].join('; ');

  const textBlockDecls = [
    `max-inline-size: ${t.measureCh}ch`,
    `margin-inline: auto`,
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
  const EXEMPT = 'figure, table, pre, code, math, svg, img, .no-reflow';

  return `
:root { color-scheme: ${theme === 'night' ? 'dark' : 'light'}; }
html, body {
  margin: 0 !important;
  padding: 0 !important;
  background: ${palette.surface} !important;
}
body {
  ${bodyDecls};
  padding-block: 0;
  padding-inline: ${t.marginPercent}% !important;
  -webkit-text-size-adjust: 100%;
  overflow-wrap: break-word;
  ${columns === 2 ? 'column-count: 1;' : ''}
}
#book-content {
  ${contentDecls};
  /* The writing margin is real space, not padding: notes need somewhere to go. */
  ${t.writingMarginPercent > 0 ? `padding-inline-end: ${t.writingMarginPercent}%;` : ''}
  padding-bottom: 30vh;
}
#book-content p,
#book-content li,
#book-content dd,
#book-content blockquote {
  ${paragraphDecls};
  ${textBlockDecls};
}
#book-content :not(${EXEMPT}) {
  line-height: inherit;
}
h1, h2, h3, h4, h5, h6 {
  line-height: 1.25 !important;
  color: ${palette.ink} !important;
  ${own && fontStack ? `font-family: ${fontStack} !important;` : ''}
}
a { color: ${theme === 'night' ? '#e08a5c' : '#8b3616'} !important; }
blockquote {
  margin-inline: 0 !important;
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
img, svg, video { max-width: 100% !important; height: auto !important; }
td, th { border: 1px solid ${palette.border} !important; padding: 4px 8px !important; }
figcaption { color: ${palette.muted} !important; font-size: 0.86em !important; }
`;
}

/** Two columns only when each would still be a comfortable measure. */
export function resolveColumns(choice: 'auto' | 1 | 2, frameWidth: number, fontSizePx: number): 1 | 2 {
  if (choice === 1) return 1;
  // Rough average glyph width for a serif at this size.
  const glyph = fontSizePx * 0.5;
  const comfortable = 52 * glyph;
  if (choice === 2) return frameWidth >= comfortable * 2 ? 2 : 1;
  return frameWidth >= comfortable * 2 ? 2 : 1;
}
