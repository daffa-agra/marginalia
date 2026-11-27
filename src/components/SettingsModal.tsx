import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JournalData } from '../types';
import { Icon } from './icons';
import { Modal } from './Modal';
import {
  adoptKey,
  formatKeyForDisplay,
  forgetKey,
  generateKey,
  keyFingerprint,
  loadOrCreateKey,
  normaliseKeyInput,
} from '../lib/capabilityKey';
import { apiBase, loadSyncState, pendingCount, runSync, resolveConflict } from '../lib/syncEngine';
import type { SyncState } from '../lib/syncEngine';
import { estimateStorage, requestPersistentStorage } from '../lib/bookFiles';
import type { useToasts } from '../lib/toasts';

/**
 * Settings: where the writing goes, and the key that lets another device reach
 * it.
 *
 * Two ideas drive this screen. First, the reader must be able to see exactly
 * where their journal lives — "your Cloudflare account, which is yours" is a
 * different promise from "some server", and the difference should be visible.
 * Second, the key is a secret with no recovery, so it is shown plainly, with the
 * consequence spelled out, rather than buried.
 */
export function SettingsModal({
  rawData,
  onClose,
  onSynced,
  notify,
}: {
  /** The stored journal, tombstones included — what the sync pushes. */
  rawData: JournalData;
  onClose: () => void;
  /** Hands the merged journal back after a successful sync. */
  onSynced: (next: JournalData) => void;
  notify: ReturnType<typeof useToasts>['notify'];
}) {
  const [state, setState] = useState<SyncState>(() => loadSyncState());
  const [key, setKey] = useState(() => loadOrCreateKey());
  const [linkInput, setLinkInput] = useState('');
  const [linkError, setLinkError] = useState('');
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const pending = useMemo(() => pendingCount(rawData, state.pushedAt), [rawData, state.pushedAt]);

  useEffect(() => {
    void (async () => {
      const est = await estimateStorage();
      setStorage(est);
      setPersisted(est.persisted);
    })();
  }, []);

  const syncNow = useCallback(async () => {
    setBusy(true);
    try {
      // The raw journal, tombstones included: a delete is exactly the record
      // the sync has to push, and the filtered view no longer carries it.
      const outcome = await runSync(rawData, setState);
      if (outcome.data) {
        onSynced(outcome.data);
        notify('Journal synced');
      } else if (outcome.state.phase === 'idle') {
        notify('Already up to date');
      } else {
        notify(outcome.state.message ?? 'Could not sync just now', { tone: 'danger' });
      }
    } finally {
      setBusy(false);
    }
  }, [rawData, onSynced, notify]);

  const linkDevice = useCallback(() => {
    const candidate = normaliseKeyInput(linkInput);
    if (!candidate) {
      setLinkError('Paste the key from the other device.');
      return;
    }
    const adopted = adoptKey(candidate);
    if (!adopted) {
      setLinkError('That does not look like a key — it should be 43 characters.');
      return;
    }
    setKey(adopted);
    setLinkInput('');
    setLinkError('');
    // The old revision belonged to the previous journal.
    setState({ ...loadSyncState(), revision: 0 });
    notify('This device is linked. Press Sync to pull the journal.');
  }, [linkInput, notify]);

  const rotate = useCallback(() => {
    const fresh = generateKey();
    if (!adoptKey(fresh.value)) return;
    setKey(fresh);
    setState({ ...loadSyncState(), revision: 0 });
    notify('New key created. Other devices will need this one to sync again.', { duration: 9000 });
  }, [notify]);

  const enablePersistence = useCallback(async () => {
    const granted = await requestPersistentStorage();
    setPersisted(granted);
    notify(
      granted
        ? 'This browser will keep your books.'
        : 'The browser declined. Your writing is still synced.',
      { tone: granted ? 'neutral' : 'danger' },
    );
  }, [notify]);

  const usedMb = storage ? storage.usage / 1024 / 1024 : 0;
  const quotaMb = storage ? storage.quota / 1024 / 1024 : 0;

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings-body">
        {/* ── where the writing lives ── */}
        <section className="settings-group" aria-labelledby="settings-where">
          <h3 id="settings-where">Where your journal lives</h3>
          <p className="muted settings-note">
            Reading and writing work offline from this browser. When the server is reachable, your
            journal syncs to your own Cloudflare account — not to us.
          </p>
          <dl className="settings-facts">
            <div>
              <dt>Server</dt>
              <dd className="numeric settings-mono">{apiBase()}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                {state.phase === 'syncing'
                  ? 'Syncing…'
                  : state.lastSyncAt
                    ? `Last synced ${new Date(state.lastSyncAt).toLocaleString()}`
                    : 'Never synced'}
              </dd>
            </div>
            <div>
              <dt>Waiting to sync</dt>
              <dd className="numeric">{pending === 0 ? 'Nothing' : `${pending} change${pending === 1 ? '' : 's'}`}</dd>
            </div>
          </dl>
          <div className="settings-actions">
            <button type="button" className="btn btn-primary btn-small" onClick={syncNow} disabled={busy}>
              <Icon name="sync" size={14} /> {busy ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
          {state.message && state.phase !== 'idle' && (
            <p className={state.phase === 'offline' ? 'settings-hint muted' : 'settings-hint danger-text'}>
              {state.message}
            </p>
          )}
        </section>

        {/* ── conflicts ── */}
        {state.conflicts.length > 0 && (
          <section className="settings-group" aria-labelledby="settings-conflicts">
            <h3 id="settings-conflicts">Edited on two devices</h3>
            <p className="muted settings-note">
              These were changed on two devices at the same moment. Nothing was discarded —
              keeping the one shown here dismisses the notice.
            </p>
            <ul className="settings-conflicts">
              {state.conflicts.map((conflict) => (
                <li key={`${conflict.kind}-${conflict.id}`}>
                  <span>
                    A {conflict.kind.replace(/s$/, '')} edited on both devices.
                  </span>
                  <button
                    type="button"
                    className="btn btn-small btn-quiet"
                    onClick={() => setState(resolveConflict(conflict.id))}
                  >
                    Keep this one
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── the key ── */}
        <section className="settings-group" aria-labelledby="settings-key">
          <h3 id="settings-key">Your key</h3>
          <p className="muted settings-note">
            There is no password. This key <em>is</em> the account: anyone who has it can read and
            write this journal, so keep it somewhere safe. Losing it means this journal cannot be
            reached from another device — export a backup as well.
          </p>
          <div className="settings-key">
            <code aria-label="Your journal key">{formatKeyForDisplay(key.value)}</code>
            <span className="settings-key-fingerprint numeric" title="Fingerprint">
              {keyFingerprint(key.value)}
            </span>
          </div>
          <div className="settings-actions">
            <button
              type="button"
              className="btn btn-small btn-quiet"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(key.value);
                  notify('Key copied');
                } catch {
                  notify('Could not copy — select the key and copy it manually', { tone: 'danger' });
                }
              }}
            >
              Copy key
            </button>
            <button type="button" className="btn btn-small btn-quiet" onClick={rotate}>
              Create a new key
            </button>
          </div>

          <h4 className="settings-subhead">Link another device</h4>
          <p className="muted settings-note">
            On the other device open Settings, copy its key, and paste it here. Both devices then
            share one journal.
          </p>
          <div className="settings-link">
            <label className="visually-hidden" htmlFor="link-key">
              Key from your other device
            </label>
            <input
              id="link-key"
              type="text"
              className="settings-link-input"
              placeholder="Paste the key from the other device"
              value={linkInput}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                setLinkInput(e.target.value);
                setLinkError('');
              }}
            />
            <button type="button" className="btn btn-small" onClick={linkDevice}>
              Link
            </button>
          </div>
          {linkError && (
            <p className="settings-hint danger-text" role="alert">
              {linkError}
            </p>
          )}
          <button
            type="button"
            className="settings-link-forget"
            onClick={() => {
              forgetKey();
              const fresh = loadOrCreateKey();
              setKey(fresh);
              notify('This device forgot its key and made a new one', { tone: 'danger', duration: 8000 });
            }}
          >
            Forget this device's key
          </button>
        </section>

        {/* ── storage ── */}
        <section className="settings-group" aria-labelledby="settings-storage">
          <h3 id="settings-storage">Books on this device</h3>
          {storage ? (
            <>
              <p className="muted settings-note">
                About {usedMb.toFixed(1)} MB used
                {quotaMb > 0 ? ` of roughly ${quotaMb.toFixed(0)} MB available` : ''}. Book files live
                here so reading works offline.
              </p>
              <div
                className="progress-track settings-storage-bar"
                role="progressbar"
                aria-valuenow={quotaMb > 0 ? Math.round((usedMb / quotaMb) * 100) : 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Browser storage used"
              >
                <div
                  className="progress-fill"
                  style={{ transform: `scaleX(${quotaMb > 0 ? Math.min(1, usedMb / quotaMb) : 0})` }}
                />
              </div>
            </>
          ) : (
            <p className="muted settings-note">This browser does not report its storage estimate.</p>
          )}
          {persisted === false && (
            <div className="settings-actions">
              <button type="button" className="btn btn-small" onClick={enablePersistence}>
                Ask the browser to keep books
              </button>
            </div>
          )}
          {persisted === true && (
            <p className="settings-hint muted">This browser has agreed to keep your books.</p>
          )}
        </section>
      </div>
    </Modal>
  );
}
