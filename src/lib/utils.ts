/** Small helper for building class-name strings conditionally. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Stable id for new records without pulling in a uuid dependency. */
export function makeId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

/** Clamp n into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Integer input parsing that never NaNs. */
export function parseNonNegativeInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Local YYYY-MM-DD for date inputs. */
export function todayIso(): string {
  const d = new Date();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** "2026-03-07" -> "7 Mar 2026" (falls back to the raw string). */
export function formatDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Difference in whole days between two YYYY-MM-DD strings. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00`).getTime();
  const to = new Date(`${toIso}T00:00:00`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/** "84% · 203 of 242 pages" style summary. */
export function pagesSummary(current: number, total: number | undefined): string {
  if (!total || total <= 0) return `${current} pages`;
  const pct = clamp(Math.round((current / total) * 100), 0, 100);
  return `${pct}% · ${current} of ${total} pages`;
}

/** Count pages left, guarding against bogus totals. */
export function pagesLeft(current: number, total: number | undefined): number {
  if (!total || total <= 0) return 0;
  return Math.max(0, total - current);
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}
