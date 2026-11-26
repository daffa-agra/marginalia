import {
  clampTypography,
  DEFAULT_SETTINGS,
  type BookTypography,
  type ReaderSettings,
} from './typography';

/**
 * Reader settings persistence (READER-TYPOGRAPHY §7).
 *
 * Reading preferences are device-specific by design — a phone and a monitor
 * want different sizes — so these live in localStorage only, never synced,
 * and never near the journal data. On a device where they should become
 * durable, they move to IDB `meta` in their own migration.
 */

const LS_KEY = 'marginalia.reader.v1';

export function sanitizeTypography(input: unknown): BookTypography {
  const base = { ...DEFAULT_SETTINGS.global };
  if (!input || typeof input !== 'object') return clampTypography(base);
  const raw = input as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const family = raw.fontFamily;
  const alignment = raw.alignment;
  const hyphenation = raw.hyphenation;
  return clampTypography({
    fontSizePx: num(raw.fontSizePx, base.fontSizePx),
    fontFamily:
      family === 'serif' || family === 'sans' || family === 'dyslexic' ? family : 'book',
    measureCh: num(raw.measureCh, base.measureCh),
    lineHeight: num(raw.lineHeight, base.lineHeight),
    letterSpacingEm: num(raw.letterSpacingEm, base.letterSpacingEm),
    wordSpacingEm: num(raw.wordSpacingEm, base.wordSpacingEm),
    paragraphSpacingEm: num(raw.paragraphSpacingEm, base.paragraphSpacingEm),
    alignment: alignment === 'left' || alignment === 'justify' ? alignment : 'book',
    hyphenation: hyphenation === 'on' || hyphenation === 'off' ? hyphenation : 'book',
    indentEm: num(raw.indentEm, base.indentEm),
    marginPercent: num(raw.marginPercent, base.marginPercent),
    writingMarginPercent: num(raw.writingMarginPercent, base.writingMarginPercent),
  });
}

export function sanitizeSettings(input: unknown): ReaderSettings {
  if (!input || typeof input !== 'object') return { ...DEFAULT_SETTINGS, perBook: {} };
  const raw = input as Record<string, unknown>;
  const perBookRaw = raw.perBook && typeof raw.perBook === 'object' ? raw.perBook : {};
  const perBook: Record<string, BookTypography> = {};
  for (const [id, value] of Object.entries(perBookRaw as Record<string, unknown>)) {
    if (typeof id === 'string' && id.length > 0) perBook[id] = sanitizeTypography(value);
  }
  return {
    global: sanitizeTypography(raw.global ?? DEFAULT_SETTINGS.global),
    perBook,
    theme: raw.theme === 'sepia' || raw.theme === 'night' ? raw.theme : 'paper',
    mode: raw.mode === 'own' ? 'own' : 'preserve',
    columns: raw.columns === 1 || raw.columns === 2 ? raw.columns : 'auto',
    fullscreen: raw.fullscreen === true,
    animateTurns: raw.animateTurns === true,
  };
}

function loadLocal(): ReaderSettings | null {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveLocal(settings: ReaderSettings): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(settings));
  } catch {
    // Nothing durable available; the session keeps the settings in memory.
  }
}

export function loadSettings(): ReaderSettings {
  return loadLocal() ?? { ...DEFAULT_SETTINGS, perBook: {} };
}

export function saveSettings(settings: ReaderSettings): void {
  saveLocal(settings);
}

export interface ReadingPosition {
  cfi: string;
  percent: number;
  updatedAt: number;
}

const POSITIONS_KEY = 'marginalia.reader.positions.v1';

export function loadPositions(): Record<string, ReadingPosition> {
  try {
    const raw = window.localStorage.getItem(POSITIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, ReadingPosition> = {};
    for (const [bookId, value] of Object.entries(parsed)) {
      if (value && typeof value === 'object') {
        const v = value as Record<string, unknown>;
        if (typeof v.cfi === 'string' && v.cfi && typeof v.percent === 'number') {
          out[bookId] = {
            cfi: v.cfi,
            percent: Math.max(0, Math.min(100, v.percent)),
            updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0,
          };
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function savePosition(bookId: string, position: ReadingPosition): void {
  try {
    const all = loadPositions();
    all[bookId] = position;
    window.localStorage.setItem(POSITIONS_KEY, JSON.stringify(all));
  } catch {
    // Losing a position record must never interrupt reading.
  }
}
