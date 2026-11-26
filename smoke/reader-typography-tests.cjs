/* Unit tests: pagination maths, typography resolution, CSS generation, AA spacing. */
const path = require('path');
const assert = require('assert');

const dist = path.join(__dirname, '..', 'dist-smoke');
const { pageToFraction, fractionToPage } = require(path.join(dist, 'lib', 'pagination.js'));
const {
  DEFAULT_TYPOGRAPHY,
  DEFAULT_SETTINGS,
  PRESETS,
  AA_SPACING,
  LIMITS,
  normaliseTypography,
  typographyFor,
} = require(path.join(dist, 'lib', 'readerSettings.js'));
const { buildReaderCss, resolveColumns, THEMES } = require(path.join(dist, 'lib', 'readerCss.js'));

/* --- page/fraction round trip --- */
{
  assert.strictEqual(pageToFraction(0, 10), 0, 'first page is fraction 0');
  assert.strictEqual(pageToFraction(9, 10), 1, 'last page is fraction 1');
  assert.strictEqual(pageToFraction(0, 1), 0, 'single page is 0');
  assert.strictEqual(fractionToPage(0, 10), 0);
  assert.strictEqual(fractionToPage(1, 10), 9);
  assert.strictEqual(fractionToPage(0.5, 11), 5, 'middle fraction');
  assert.strictEqual(fractionToPage(5, 10), 9, 'fraction clamped');
  // Round trip every page in a typical chapter.
  for (const count of [1, 2, 5, 17, 40]) {
    for (let page = 0; page < count; page++) {
      assert.strictEqual(fractionToPage(pageToFraction(page, count), count), page, `round trip ${page}/${count}`);
    }
  }
  console.log('✓ page ↔ fraction round trips at every length');
}

/* --- typography normalisation clamps to spec limits --- */
{
  const t = normaliseTypography({
    fontSizePx: 999,
    measureCh: 5,
    lineHeight: 9,
    letterSpacingEm: -5,
    alignment: 'bogus',
    theme: 'nope',
  });
  assert.strictEqual(t.fontSizePx, LIMITS.fontSizePx[1], 'font size clamped to max');
  assert.strictEqual(t.measureCh, LIMITS.measureCh[0], 'measure clamped to min');
  assert.strictEqual(t.lineHeight, LIMITS.lineHeight[1], 'line height clamped');
  assert.strictEqual(t.letterSpacingEm, LIMITS.letterSpacingEm[0], 'letter spacing floored');
  assert.strictEqual(t.alignment, 'book', 'unknown alignment falls back');
  assert.strictEqual(normaliseTypography(null).fontSizePx, DEFAULT_TYPOGRAPHY.fontSizePx, 'null gives defaults');
  console.log('✓ typography clamped to the specification ranges');
}

/* --- per-book resolution --- */
{
  const settings = {
    ...DEFAULT_SETTINGS,
    global: { ...DEFAULT_TYPOGRAPHY, fontSizePx: 20 },
    perBook: { 'book-a': { ...DEFAULT_TYPOGRAPHY, fontSizePx: 26 } },
  };
  assert.strictEqual(typographyFor(settings, 'book-a').fontSizePx, 26, 'book override wins');
  assert.strictEqual(typographyFor(settings, 'book-b').fontSizePx, 20, 'other books use global');
  assert.strictEqual(typographyFor(DEFAULT_SETTINGS, 'anything').fontSizePx, DEFAULT_TYPOGRAPHY.fontSizePx);
  console.log('✓ per-book typography resolves override → global → default');
}

/* --- presets and AA spacing are in range --- */
{
  for (const preset of PRESETS) {
    const merged = normaliseTypography({ ...DEFAULT_TYPOGRAPHY, ...preset.values });
    assert.ok(merged.fontSizePx >= LIMITS.fontSizePx[0] && merged.fontSizePx <= LIMITS.fontSizePx[1], preset.name);
    assert.ok(merged.measureCh >= LIMITS.measureCh[0] && merged.measureCh <= LIMITS.measureCh[1], preset.name);
  }
  // WCAG 1.4.12: line height ≥ 1.5, paragraph ≥ 2, letter ≥ 0.12, word ≥ 0.16.
  assert.ok(AA_SPACING.lineHeight >= 1.5, 'AA line height');
  assert.ok(AA_SPACING.paragraphSpacingEm >= 2, 'AA paragraph spacing');
  assert.ok(AA_SPACING.letterSpacingEm >= 0.12, 'AA letter spacing');
  assert.ok(AA_SPACING.wordSpacingEm >= 0.16, 'AA word spacing');
  console.log('✓ presets in range; AA spacing meets WCAG 1.4.12');
}

/* --- CSS generation --- */
{
  const base = { typography: DEFAULT_TYPOGRAPHY, mode: 'preserve', theme: 'paper', columns: 1 };
  const preserve = buildReaderCss(base);
  assert.match(preserve, /font-size: 18px !important/, 'font size applied');
  assert.match(preserve, /max-inline-size: 66ch/, 'measure applied');
  assert.doesNotMatch(preserve, /font-family: Georgia/, 'publisher font kept in preserve mode');

  const own = buildReaderCss({
    ...base,
    mode: 'own',
    typography: { ...DEFAULT_TYPOGRAPHY, fontFamily: 'serif' },
  });
  assert.match(own, /font-family: Georgia/, 'own mode sets the chosen font');

  // "book" means "leave the publisher's font alone", even in own mode.
  const ownBookFont = buildReaderCss({ ...base, mode: 'own' });
  assert.doesNotMatch(ownBookFont, /font-family: Georgia/, 'book font choice leaves the publisher font');

  const night = buildReaderCss({ ...base, theme: 'night' });
  assert.match(night, new RegExp(THEMES.night.surface), 'night surface');
  assert.match(night, new RegExp(THEMES.night.ink), 'night ink');

  // Exempt elements must never be reflowed.
  for (const el of ['figure', 'table', 'pre', 'code', 'svg', 'img']) {
    assert.ok(preserve.includes(el), `${el} exempted`);
  }

  const justified = buildReaderCss({
    ...base,
    typography: { ...DEFAULT_TYPOGRAPHY, alignment: 'justify', hyphenation: 'on' },
  });
  assert.match(justified, /text-align: justify !important/, 'justification applied');
  assert.match(justified, /hyphens: auto !important/, 'hyphenation applied');

  const writing = buildReaderCss({
    ...base,
    typography: { ...DEFAULT_TYPOGRAPHY, writingMarginPercent: 20 },
  });
  assert.match(writing, /padding-inline-end: 20%/, 'writing margin reserves space');

  const spacing = buildReaderCss({
    ...base,
    typography: normaliseTypography({ ...DEFAULT_TYPOGRAPHY, ...AA_SPACING }),
  });
  assert.match(spacing, /letter-spacing: 0.12em !important/, 'AA letter spacing in CSS');
  assert.match(spacing, /word-spacing: 0.16em !important/, 'AA word spacing in CSS');
  console.log('✓ generated CSS applies overrides, keeps exemptions, honours theme');
}

/* --- column resolution --- */
{
  // The anchor rule: fit as many ideal columns as the width allows, up to two,
  // but never split into columns below the comfort floor.
  assert.strictEqual(resolveColumns(1, 2000, 18), 1, 'one column when asked, however wide');
  assert.strictEqual(resolveColumns(2, 2000, 18), 2, 'two columns when there is room');
  assert.strictEqual(resolveColumns('auto', 2000, 18), 2, 'auto uses two when wide');
  assert.strictEqual(resolveColumns('auto', 400, 18), 1, 'auto uses one when narrow');
  // Two columns of ~39 characters each are worse than one full column.
  assert.strictEqual(resolveColumns(2, 700, 18), 1, 'a narrow window refuses a cramped spread');
  // The floor is in characters, so it scales with the type: 1280px is two
  // comfortable ~53-character columns at 24px, but the same width at 32px is
  // only ~40 characters each and still acceptable, while 900px at 32px is not.
  assert.strictEqual(resolveColumns('auto', 1280, 24), 2, 'a wide window spreads medium type');
  assert.strictEqual(resolveColumns('auto', 900, 32), 1, 'huge type in a small window stays one column');
  assert.strictEqual(resolveColumns('auto', 1280, 32), 2, 'huge type in a wide window still fits two');
  // At a normal size the spread appears once each column still beats the floor:
  // 700px would give two 39-character columns (too cramped), 800px gives ~44.
  assert.strictEqual(resolveColumns('auto', 700, 18), 1, 'a cramped window keeps one column');
  assert.strictEqual(resolveColumns('auto', 800, 18), 2, 'a wider window spreads normal type');
  assert.strictEqual(resolveColumns('auto', 1280, 18), 2, 'a wide window spreads normal type');
  // Wider windows never reduce the column count.
  let previous = 0;
  for (const width of [400, 700, 900, 1280, 1600, 2000]) {
    const n = resolveColumns('auto', width, 18);
    assert.ok(n >= previous, `width ${width} did not reduce columns`);
    previous = n;
  }
  console.log('✓ column count adapts to width and font size');
}

console.log('\nAll pagination and typography tests passed.');
