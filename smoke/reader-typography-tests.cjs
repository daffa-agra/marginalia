/*
 * Reader typography tests (READER-TYPOGRAPHY §9, the pure parts).
 * Run with: node smoke/reader-typography-tests.cjs
 */
const path = require('path');
const assert = require('assert');

const dist = path.join(__dirname, '..', 'dist-smoke');
const { buildOverrideCss } = require(path.join(dist, 'reader/override'));
const t = require(path.join(dist, 'reader/typography'));
const { sanitizeSettings, loadPositions, savePosition } = require(path.join(dist, 'reader/settings'));

// --- 1. Comfortable default matches the spec -------------------------------
assert.equal(t.COMFORTABLE.fontSizePx, 17);
assert.equal(t.COMFORTABLE.measureCh, 66);
assert.equal(t.COMFORTABLE.lineHeight, 1.55);
assert.equal(t.DEFAULT_SETTINGS.mode, 'preserve');
assert.equal(t.DEFAULT_SETTINGS.theme, 'paper');
assert.equal(t.PRESETS.length, 4, 'four named presets');
console.log('✓ defaults match the typography spec');

// --- 2. Clamp: no control exceeds its safe range ---------------------------
const wild = t.clampTypography({
  fontSizePx: 99, fontFamily: 'sans', measureCh: 900, lineHeight: 9,
  letterSpacingEm: 1, wordSpacingEm: 2, paragraphSpacingEm: 5,
  alignment: 'left', hyphenation: 'on', indentEm: 9,
  marginPercent: 100, writingMarginPercent: 100,
});
assert.ok(wild.fontSizePx >= 12 && wild.fontSizePx <= 32);
assert.ok(wild.measureCh >= 40 && wild.measureCh <= 90);
assert.ok(wild.lineHeight >= 1.2 && wild.lineHeight <= 2.2);
assert.ok(wild.letterSpacingEm >= -0.01 && wild.letterSpacingEm <= 0.12);
assert.ok(wild.wordSpacingEm >= 0 && wild.wordSpacingEm <= 0.16);
assert.ok(wild.paragraphSpacingEm >= 0 && wild.paragraphSpacingEm <= 2.0);
assert.ok(wild.marginPercent >= 0 && wild.marginPercent <= 15);
assert.ok(wild.writingMarginPercent >= 0 && wild.writingMarginPercent <= 25);
console.log('✓ clamping holds every control inside its range');

// --- 3. Resolve: per-book overrides global, absent inherits global ---------
const settings = t.DEFAULT_SETTINGS;
settings.perBook['book-a'] = { ...t.COMFORTABLE, fontSizePx: 24 };
assert.equal(t.resolveTypography(settings, 'book-a').fontSizePx, 24);
assert.equal(t.resolveTypography(settings, 'book-b').fontSizePx, 17, 'book B unchanged');
console.log('✓ per-book isolation works');

// --- 4. Preserve mode: publisher fonts and alignment survive ---------------
const preserved = buildOverrideCss({ ...t.COMFORTABLE, fontFamily: 'serif', alignment: 'justify' }, 'preserve');
assert.ok(!preserved.includes('font-family:'), 'preserve never overrides the font family');
assert.ok(!preserved.includes('text-align:'), 'preserve never overrides alignment');
assert.ok(preserved.includes('font-size: var(--mg-font-size) !important'));
assert.ok(preserved.includes('max-inline-size:'), 'measure control present in both modes');
console.log('✓ preserve mode touches size and spacing only');

// --- 5. My-page mode: font, alignment, indent are ours ---------------------
const own = buildOverrideCss({ ...t.COMFORTABLE, fontFamily: 'dyslexic', alignment: 'justify', indentEm: 1.2 }, 'own');
assert.ok(own.includes('font-family:'), 'own mode overrides family');
assert.ok(own.includes('text-align: justify'), 'own mode overrides alignment');
assert.ok(own.includes('text-indent: 1.20em'), 'own mode overrides indent');
assert.ok(own.includes('hyphens: auto'), 'justified text may hyphenate in own mode');
console.log('✓ my-page mode takes over family, alignment, indent');

// --- 6. The override always carries !important on the properties we own ----
for (const needle of ['font-size: var(--mg-font-size) !important', 'line-height: var(--mg-leading) !important', 'letter-spacing: var(--mg-letter-spacing) !important']) {
  assert.ok(preserved.includes(needle), `important override present: ${needle}`);
}
console.log('✓ !important survives on every owned property (defeats inline publisher styles)');

// --- 7. Hyphenation off explicitly stays off even when justified -----------
const noHyphens = buildOverrideCss({ ...t.COMFORTABLE, hyphenation: 'off' }, 'own');
assert.ok(noHyphens.includes('hyphens: manual'), 'explicit off wins');

// --- 8. WCAG AA one-click action reaches all four metrics ------------------
const aa = t.applyTextSpacingAA({ ...t.COMFORTABLE });
assert.ok(aa.lineHeight >= 1.5, 'line height ≥ 1.5×');
assert.ok(aa.paragraphSpacingEm >= 2.0, 'paragraph spacing ≥ 2×');
assert.ok(aa.letterSpacingEm >= 0.12, 'letter spacing ≥ 0.12em');
assert.ok(aa.wordSpacingEm >= 0.16, 'word spacing ≥ 0.16em');
console.log('✓ one click reaches the WCAG 1.4.12 text spacing metrics');

// --- 9. Settings sanitizeresse: unknown input falls back to defaults ------
assert.equal(sanitizeSettings(null).mode, 'preserve');
assert.equal(sanitizeSettings({ theme: 'nonsense' }).theme, 'paper');
assert.equal(sanitizeSettings({ columns: 2 }).columns, 2);
const hostile = sanitizeSettings({ global: { fontSizePx: 4000 }, perBook: { x: { fontSizePx: -5 } } });
assert.equal(hostile.global.fontSizePx, 32, 'global size clamps high');
assert.equal(hostile.perBook.x.fontSizePx, 12, 'per-book size clamps low');
console.log('✓ hostile settings input sanes into range');

// --- 10. Positions round-trip in localStorage ------------------------------
global.window = { localStorage: { store: new Map(), getItem(k) { return this.store.get(k) ?? null; }, setItem(k, v) { this.store.set(k, v); }, removeItem(k) { this.store.delete(k); } } };
savePosition('book-1', { cfi: 'epubcfi(/6/4!/4/2/2/2)', percent: 44, updatedAt: 1700000000000 });
const positions = loadPositions();
assert.equal(positions['book-1'].percent, 44);
assert.equal(positions['book-1'].cfi, 'epubcfi(/6/4!/4/2/2/2)');
savePosition('book-2', { cfi: 'x', percent: 900, updatedAt: 0 });
assert.equal(loadPositions()['book-2'].percent, 100, 'percent clamps to 0..100');
console.log('✓ positions round-trip and clamp');

console.log('\nAll reader typography tests passed.');
