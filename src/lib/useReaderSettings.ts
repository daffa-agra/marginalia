import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AA_SPACING,
  DEFAULT_SETTINGS,
  PRESETS,
  normaliseTypography,
  typographyFor,
} from './readerSettings';
import type { BookTypography, Columns, ReaderMode, ReaderSettings, ReaderTheme } from './readerSettings';
import { loadReaderSettings, saveReaderSettings } from '../storage';

/**
 * Reader preferences, persisted separately from the journal.
 *
 * Every change is per-book by default; the caller can promote it to the global
 * default with `useForAll`.
 */
export function useReaderSettings(bookId: string) {
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    const stored = loadReaderSettings();
    if (!stored || typeof stored !== 'object') return DEFAULT_SETTINGS;
    const raw = stored as Partial<ReaderSettings>;
    return {
      global: normaliseTypography(raw.global, DEFAULT_SETTINGS.global),
      perBook: Object.fromEntries(
        Object.entries(raw.perBook ?? {}).map(([id, value]) => [
          id,
          normaliseTypography(value, DEFAULT_SETTINGS.global),
        ]),
      ),
      mode: raw.mode === 'own' ? 'own' : 'preserve',
      theme: raw.theme === 'sepia' || raw.theme === 'night' ? raw.theme : 'paper',
      columns: raw.columns === 1 || raw.columns === 2 ? raw.columns : 'auto',
      justifyWarningSeen: Boolean(raw.justifyWarningSeen),
    };
  });

  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveReaderSettings(settings), 300);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [settings]);

  const typography = typographyFor(settings, bookId);

  /** Writes to this book's override, creating one from the global if needed. */
  const update = useCallback(
    (patch: Partial<BookTypography>) => {
      setSettings((current) => {
        const base = typographyFor(current, bookId);
        return {
          ...current,
          perBook: { ...current.perBook, [bookId]: { ...base, ...patch } },
        };
      });
    },
    [bookId],
  );

  /** Promotes the current book's typography to every book that has no override. */
  const useForAll = useCallback(() => {
    setSettings((current) => ({
      ...current,
      global: typographyFor(current, bookId),
    }));
  }, [bookId]);

  /** Drops this book's override, falling back to the global default. */
  const resetThisBook = useCallback(() => {
    setSettings((current) => {
      const next = { ...current.perBook };
      delete next[bookId];
      return { ...current, perBook: next };
    });
  }, [bookId]);

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = PRESETS.find((p) => p.id === presetId);
      if (preset) update(preset.values);
    },
    [update],
  );

  const applyAaSpacing = useCallback(() => update(AA_SPACING), [update]);

  const setMode = useCallback((mode: ReaderMode) => {
    setSettings((c) => ({ ...c, mode }));
  }, []);

  const setTheme = useCallback((theme: ReaderTheme) => {
    setSettings((c) => ({ ...c, theme }));
  }, []);

  const setColumns = useCallback((columns: Columns) => {
    setSettings((c) => ({ ...c, columns }));
  }, []);

  const markJustifyWarningSeen = useCallback(() => {
    setSettings((c) => ({ ...c, justifyWarningSeen: true }));
  }, []);

  const hasOverride = Boolean(settings.perBook[bookId]);

  return {
    settings,
    typography,
    hasOverride,
    update,
    useForAll,
    resetThisBook,
    applyPreset,
    applyAaSpacing,
    setMode,
    setTheme,
    setColumns,
    markJustifyWarningSeen,
  };
}

export type ReaderSettingsStore = ReturnType<typeof useReaderSettings>;
