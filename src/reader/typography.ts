import { clamp } from '../lib/utils';

/**
 * The typography data model (READER-TYPOGRAPHY §7). One `BookTypography`
 * describes a whole page layout; a `ReaderSettings` carries the global
 * default, per-book overrides, and the reader-chrome decisions.
 */

export interface BookTypography {
  /** 12–32 px, continuous, snapped to whole px. */
  fontSizePx: number;
  /** Only overridden in *My page* mode. */
  fontFamily: 'book' | 'serif' | 'sans' | 'dyslexic';
  /** 40–90 characters, applied as max-inline-size in ch. */
  measureCh: number;
  /** 1.2–2.2 */
  lineHeight: number;
  /** −0.01–0.12 em (the WCAG floor is the top of the range). */
  letterSpacingEm: number;
  /** 0–0.16 em. */
  wordSpacingEm: number;
  /** 0–2.0 em. */
  paragraphSpacingEm: number;
  alignment: 'book' | 'left' | 'justify';
  hyphenation: 'book' | 'on' | 'off';
  /** 0–2.0 em first-line indent. */
  indentEm: number;
  /** 0–15 % outer page margin. */
  marginPercent: number;
  /** 0–25 % reserved annotation space — the signature control. */
  writingMarginPercent: number;
}

export interface ReaderSettings {
  /** Applies when a book has no override. */
  global: BookTypography;
  /** Keyed by book id. Absent = inherit `global`. */
  perBook: Record<string, BookTypography>;
  theme: 'paper' | 'sepia' | 'night';
  mode: 'preserve' | 'own';
  columns: 'auto' | 1 | 2;
  fullscreen: boolean;
  animateTurns: boolean;
}

export const SIZE_MIN = 12;
export const SIZE_MAX = 32;
export const MEASURE_MIN = 40;
export const MEASURE_MAX = 90;
export const LEADING_MIN = 1.2;
export const LEADING_MAX = 2.2;
export const LETTER_MAX = 0.12;
export const WORD_MAX = 0.16;
export const PARA_MAX = 2.0;
export const MARGIN_MAX = 15;
export const WRITING_MARGIN_MAX = 25;

export const FONT_STACKS: Record<Exclude<BookTypography['fontFamily'], 'book'>, string> = {
  serif: "Iowan Old Style, Palatino Linotype, Palatino, Georgia, 'Times New Roman', serif",
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  dyslexic: "Comic Sans MS, Verdana, 'Atkinson Hyperlegible', Trebuchet MS, sans-serif",
};

export const COMFORTABLE: BookTypography = {
  fontSizePx: 17,
  fontFamily: 'book',
  measureCh: 66,
  lineHeight: 1.55,
  letterSpacingEm: 0,
  wordSpacingEm: 0,
  paragraphSpacingEm: 0.8,
  alignment: 'book',
  hyphenation: 'book',
  indentEm: 0,
  marginPercent: 6,
  writingMarginPercent: 0,
};

/** Named points in the space, not random slider positions (§4.4). */
export const PRESETS: Array<{ id: string; name: string; description: string; typography: BookTypography }> = [
  { id: 'comfortable', name: 'Comfortable', description: 'Default', typography: COMFORTABLE },
  {
    id: 'compact',
    name: 'Compact',
    description: 'More text, denser page',
    typography: { ...COMFORTABLE, fontSizePx: 15, measureCh: 78, lineHeight: 1.4 },
  },
  {
    id: 'large-print',
    name: 'Large print',
    description: 'Low-vision starting point',
    typography: { ...COMFORTABLE, fontSizePx: 24, measureCh: 55, lineHeight: 1.8 },
  },
  {
    id: 'focus',
    name: 'Focus',
    description: 'Narrow measure, generous margin',
    typography: { ...COMFORTABLE, fontSizePx: 19, measureCh: 52, lineHeight: 1.7, marginPercent: 10 },
  },
];

export const DEFAULT_SETTINGS: ReaderSettings = {
  global: COMFORTABLE,
  perBook: {},
  theme: 'paper',
  mode: 'preserve',
  columns: 'auto',
  fullscreen: false,
  animateTurns: false,
};

/** Passes all four WCAG 1.4.12 spacing metrics in one action (§5.1). */
export const TEXT_SPACING_AA = {
  lineHeight: 1.5,
  letterSpacingEm: 0.12,
  wordSpacingEm: 0.16,
  paragraphSpacingEm: 2.0,
} as const;

/** One click passes the criterion; never lowers what the reader already raised. */
export function applyTextSpacingAA(t: BookTypography): BookTypography {
  return {
    ...t,
    lineHeight: Math.max(t.lineHeight, TEXT_SPACING_AA.lineHeight),
    letterSpacingEm: TEXT_SPACING_AA.letterSpacingEm,
    wordSpacingEm: TEXT_SPACING_AA.wordSpacingEm,
    paragraphSpacingEm: TEXT_SPACING_AA.paragraphSpacingEm,
  };
}

export function clampTypography(t: BookTypography): BookTypography {
  return {
    ...t,
    fontSizePx: Math.round(clamp(t.fontSizePx, SIZE_MIN, SIZE_MAX)),
    measureCh: Math.round(clamp(t.measureCh, MEASURE_MIN, MEASURE_MAX)),
    lineHeight: clamp(Math.round(t.lineHeight * 20) / 20, LEADING_MIN, LEADING_MAX),
    letterSpacingEm: clamp(t.letterSpacingEm, -0.01, LETTER_MAX),
    wordSpacingEm: clamp(t.wordSpacingEm, 0, WORD_MAX),
    paragraphSpacingEm: clamp(t.paragraphSpacingEm, 0, PARA_MAX),
    indentEm: clamp(t.indentEm, 0, 2),
    marginPercent: clamp(t.marginPercent, 0, MARGIN_MAX),
    writingMarginPercent: clamp(t.writingMarginPercent, 0, WRITING_MARGIN_MAX),
  };
}

/** `perBook[bookId]` → `global` → Comfortable (§7). */
export function resolveTypography(settings: ReaderSettings, bookId: string | null): BookTypography {
  const base = (bookId && settings.perBook[bookId]) || settings.global;
  return clampTypography(base);
}

/**
 * Theme chrome palettes (§4.2, Layer 2 — colours only, never metrics).
 * Night inverts the book content only, so highlights keep their meaning.
 */
export const THEMES: Record<ReaderSettings['theme'], { bg: string; fg: string; muted: string; contentFilter: string }> = {
  paper: { bg: '#f7f3ec', fg: '#262019', muted: '#6d6255', contentFilter: 'none' },
  sepia: { bg: '#e8d9b5', fg: '#5b4a32', muted: '#8a7659', contentFilter: 'none' },
  night: {
    bg: '#17171c',
    fg: '#d8d5cf',
    muted: '#9a968e',
    // Not pure inversion: avoids the pure-white-on-pure-black halation floor.
    contentFilter: 'invert(0.92) hue-rotate(180deg) brightness(0.9)',
  },
};
