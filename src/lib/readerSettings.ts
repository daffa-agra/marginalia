/**
 * Reader typography.
 *
 * Three layers, resolved in order: the book's own styling, the reader's theme,
 * then these overrides. Every control is per-book with an opt-in "use for all
 * books", because you read poetry differently from a 900-page history.
 *
 * Ranges come from the typography specification; the defaults are the
 * "Comfortable" preset.
 */
export type FontFamilyChoice = 'book' | 'serif' | 'sans' | 'dyslexic';
export type Alignment = 'book' | 'left' | 'justify';
export type Hyphenation = 'book' | 'on' | 'off';
export type Columns = 'auto' | 1 | 2;

export interface BookTypography {
  fontSizePx: number;
  fontFamily: FontFamilyChoice;
  /** Line length in characters (ch units). */
  measureCh: number;
  lineHeight: number;
  letterSpacingEm: number;
  wordSpacingEm: number;
  paragraphSpacingEm: number;
  alignment: Alignment;
  hyphenation: Hyphenation;
  indentEm: number;
  /** Page margin as a percentage of the frame width. */
  marginPercent: number;
  /** Extra outer margin reserved for writing, as a percentage. */
  writingMarginPercent: number;
}

export type ReaderMode = 'preserve' | 'own';
export type ReaderTheme = 'paper' | 'sepia' | 'night';

export interface ReaderSettings {
  /** Applies when a book has no override. */
  global: BookTypography;
  /** Keyed by book id. Absent means inherit `global`. */
  perBook: Record<string, BookTypography>;
  mode: ReaderMode;
  theme: ReaderTheme;
  columns: Columns;
  justifyWarningSeen: boolean;
}

export const DEFAULT_TYPOGRAPHY: BookTypography = {
  fontSizePx: 18,
  fontFamily: 'book',
  measureCh: 66,
  lineHeight: 1.6,
  letterSpacingEm: 0,
  wordSpacingEm: 0,
  paragraphSpacingEm: 0.8,
  alignment: 'book',
  hyphenation: 'book',
  indentEm: 0,
  marginPercent: 6,
  writingMarginPercent: 0,
};

export const DEFAULT_SETTINGS: ReaderSettings = {
  global: { ...DEFAULT_TYPOGRAPHY },
  perBook: {},
  mode: 'preserve',
  theme: 'paper',
  columns: 'auto',
  justifyWarningSeen: false,
};

export interface Preset {
  id: string;
  name: string;
  values: Partial<BookTypography>;
}

/** Named points in the space, not random slider positions. */
export const PRESETS: Preset[] = [
  {
    id: 'comfortable',
    name: 'Comfortable',
    values: { fontSizePx: 18, measureCh: 66, lineHeight: 1.6, paragraphSpacingEm: 0.8 },
  },
  {
    id: 'compact',
    name: 'Compact',
    values: { fontSizePx: 15, measureCh: 78, lineHeight: 1.4, paragraphSpacingEm: 0.5 },
  },
  {
    id: 'large',
    name: 'Large print',
    values: { fontSizePx: 24, measureCh: 55, lineHeight: 1.8, paragraphSpacingEm: 1 },
  },
  {
    id: 'focus',
    name: 'Focus',
    values: { fontSizePx: 19, measureCh: 52, lineHeight: 1.7, paragraphSpacingEm: 0.9 },
  },
];

/**
 * WCAG 1.4.12 Text Spacing: the four metrics a reader must be able to reach.
 * One click sets all four, so passing the criterion is not four sliders.
 */
export const AA_SPACING: Partial<BookTypography> = {
  lineHeight: 1.5,
  paragraphSpacingEm: 2,
  letterSpacingEm: 0.12,
  wordSpacingEm: 0.16,
};

export const LIMITS = {
  fontSizePx: [12, 32],
  measureCh: [40, 90],
  lineHeight: [1.2, 2.2],
  letterSpacingEm: [-0.01, 0.12],
  wordSpacingEm: [0, 0.16],
  paragraphSpacingEm: [0, 2.0],
  indentEm: [0, 2.0],
  marginPercent: [0, 15],
  writingMarginPercent: [0, 25],
} as const;

function clamp(value: number, [min, max]: readonly [number, number]): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/** Coerces an untrusted value into a usable typography object. */
export function normaliseTypography(input: unknown, base: BookTypography = DEFAULT_TYPOGRAPHY): BookTypography {
  if (!input || typeof input !== 'object') return { ...base };
  const raw = input as Partial<BookTypography>;
  const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;

  return {
    fontSizePx: Math.round(clamp(num(raw.fontSizePx, base.fontSizePx), LIMITS.fontSizePx)),
    fontFamily: oneOf(raw.fontFamily, ['book', 'serif', 'sans', 'dyslexic'] as const, base.fontFamily),
    measureCh: Math.round(clamp(num(raw.measureCh, base.measureCh), LIMITS.measureCh)),
    lineHeight: clamp(num(raw.lineHeight, base.lineHeight), LIMITS.lineHeight),
    letterSpacingEm: clamp(num(raw.letterSpacingEm, base.letterSpacingEm), LIMITS.letterSpacingEm),
    wordSpacingEm: clamp(num(raw.wordSpacingEm, base.wordSpacingEm), LIMITS.wordSpacingEm),
    paragraphSpacingEm: clamp(num(raw.paragraphSpacingEm, base.paragraphSpacingEm), LIMITS.paragraphSpacingEm),
    alignment: oneOf(raw.alignment, ['book', 'left', 'justify'] as const, base.alignment),
    hyphenation: oneOf(raw.hyphenation, ['book', 'on', 'off'] as const, base.hyphenation),
    indentEm: clamp(num(raw.indentEm, base.indentEm), LIMITS.indentEm),
    marginPercent: clamp(num(raw.marginPercent, base.marginPercent), LIMITS.marginPercent),
    writingMarginPercent: clamp(
      num(raw.writingMarginPercent, base.writingMarginPercent),
      LIMITS.writingMarginPercent,
    ),
  };
}

/** Which typography applies to a book: its own override, else the global one. */
export function typographyFor(settings: ReaderSettings, bookId: string): BookTypography {
  const override = settings.perBook[bookId];
  return override ? normaliseTypography(override, settings.global) : normaliseTypography(settings.global);
}
