import { useEffect, useRef } from 'react';
import { runSync } from './syncEngine';
import type { SyncOutcome, SyncState } from './syncEngine';
import type { JournalData } from '../types';

/**
 * Keeps the journal synchronised without anyone pressing a button.
 *
 * Annotations and reading positions only travel between devices if a sync
 * actually runs, and asking the reader to open Settings on every device is
 * how a feature quietly becomes a rumour. So this hook syncs:
 *
 *   - shortly after any local change (debounced: typing a note fires many
 *     writes, the network should see one)
 *   - periodically, so a device that was offline picks up what it missed
 *     without the reader doing anything
 *   - when the browser regains its connection or its tab focus
 *
 * Being offline is normal for a local-first app, so every failure is silent
 * here: the state surface (Settings) already shows phase and pending counts,
 * and a toast per failed attempt would only train the reader to ignore toasts.
 */
export function useAutoSync(
  data: JournalData,
  applyMerged: (next: JournalData) => void,
  onState?: (state: SyncState) => void,
): void {
  // The runSync contract: the caller's journal is the read path; the outcome's
  // merged journal is folded back through applyMerged (store.replaceAll).
  const dataRef = useRef(data);
  dataRef.current = data;
  const applyRef = useRef(applyMerged);
  applyRef.current = applyMerged;
  const stateRef = useRef(onState);
  stateRef.current = onState;

  /** Guard against overlapping runs; a sync in flight makes the tick a no-op. */
  const running = useRef(false);
  /** Set while a timer is pending, so a burst of edits schedules exactly one run. */
  const timer = useRef<number | null>(null);

  /** Sync only fires when there is a journal worth syncing. */
  const empty = dataRef.current.books.length === 0 && dataRef.current.quotes.length === 0;

  const run = async () => {
    if (running.current) return;
    running.current = true;
    try {
      const outcome: SyncOutcome = await runSync(dataRef.current, (s) => stateRef.current?.(s));
      if (outcome.data) applyRef.current(outcome.data);
    } catch {
      // runSync already resolves failures into its state; this is a last resort.
    } finally {
      running.current = false;
    }
  };

  /**
   * The initial pull.
   *
   * Runs once on mount regardless of journal contents, because the device that
   * most needs a sync is the one whose journal is EMPTY: a freshly linked
   * browser has nothing local, and anything gated on "has content" would wait
   * forever for content that only a pull can bring.
   */
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* A change anywhere in the journal schedules a push. */
  useEffect(() => {
    if (empty) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    // Long enough to swallow a burst of writes (a note being typed, a queue
    // drag), short enough that a second device sees the change while the
    // reader is still thinking about it.
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void run();
    }, 2500);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Periodic catch-up, and immediate catch-up on reconnect or re-focus. */
  useEffect(() => {
    if (empty) return;
    const EVERY = 60_000;
    const interval = window.setInterval(() => void run(), EVERY);

    const online = () => void run();
    const visible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [empty]); // eslint-disable-line react-hooks/exhaustive-deps
}
