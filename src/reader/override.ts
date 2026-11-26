import { FONT_STACKS, type BookTypography } from './typography';

/**
 * The override layer stylesheet (READER-TYPOGRAPHY §8).
 *
 * Vars on :root, one scoped rule set, every property `!important` — inline
 * publisher styles lose to it on purpose. Figures, images, tables, code,
 * math and poetry blocks are deliberately out of scope: reflowing a diagram
 * breaks it. The engine injects this into every chapter document, last.
 */
export function buildOverrideCss(t: BookTypography, mode: 'preserve' | 'own'): string {
  const snap = `${Math.round(t.fontSizePx)}px`;
  const family =
    mode === 'own' && t.fontFamily !== 'book'
      ? `    font-family: ${FONT_STACKS[t.fontFamily]} !important;\n`
      : '';
  const align =
    mode === 'own' && t.alignment !== 'book'
      ? `    text-align: ${t.alignment === 'justify' ? 'justify' : 'start'} !important;\n`
      : '';
  const indent =
    mode === 'own' && t.indentEm > 0 ? `    text-indent: ${t.indentEm.toFixed(2)}em !important;\n` : '';
  const hyphens =
    mode === 'own' && t.alignment === 'justify' && t.hyphenation !== 'off' ? 'auto' : 'manual';
  const writing = (t.writingMarginPercent / 100).toFixed(4);

  return `:root {
    --mg-font-size: ${snap};
    --mg-measure: ${Math.round(t.measureCh)}ch;
    --mg-leading: ${t.lineHeight.toFixed(2)};
    --mg-letter-spacing: ${t.letterSpacingEm.toFixed(2)}em;
    --mg-word-spacing: ${t.wordSpacingEm.toFixed(2)}em;
    --mg-para-spacing: ${t.paragraphSpacingEm.toFixed(2)}em;
}
body {
    font-size: var(--mg-font-size) !important;
    line-height: var(--mg-leading) !important;
${family}    padding-inline-end: ${writing}% !important;
}
p, li, blockquote, dd, h1, h2, h3, h4, h5, h6 {
    letter-spacing: var(--mg-letter-spacing) !important;
    word-spacing: var(--mg-word-spacing) !important;
}
p, li, blockquote, dd {
    max-inline-size: var(--mg-measure) !important;
    line-height: var(--mg-leading) !important;
${align}${indent}    -webkit-hyphens: ${hyphens} !important;
    hyphens: ${hyphens} !important;
    widows: 2;
    orphans: 2;
}
p + p {
    margin-block-start: ${t.paragraphSpacingEm.toFixed(2)}em !important;
}
img, svg, table, figure {
    max-inline-size: 100% !important;
}`;
}
