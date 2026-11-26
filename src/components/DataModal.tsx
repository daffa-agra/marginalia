import { useEffect, useState } from 'react';
import type { JournalStore } from '../useJournal';
import type { useToasts } from '../lib/toasts';
import { Modal } from './Modal';
import { sanitizeData, mergeData } from '../storage';
import { exportCsv, exportJson, exportMarkdown, exportQuotesCsv, downloadTextFile } from '../lib/exporters';
import type { ExportFile } from '../lib/exporters';
import { Icon } from './icons';

export function DataModal({
  store,
  onClose,
  notify,
  returnFocusTo,
}: {
  store: JournalStore;
  onClose: () => void;
  notify: ReturnType<typeof useToasts>['notify'];
  returnFocusTo?: string;
}) {
  const [confirming, setConfirming] = useState(false);

  const doExport = (make: () => ExportFile) => {
    const file = make();
    downloadTextFile(file);
    notify(`Downloaded ${file.filename}`);
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = sanitizeData(JSON.parse(String(reader.result)));
        if (incoming.books.length === 0 && incoming.quotes.length === 0) {
          notify('That file has no books or quotes', { tone: 'danger' });
          return;
        }
        store.replaceAll(mergeData(store.data, incoming));
        notify(
          `Merged ${incoming.books.length} book${incoming.books.length === 1 ? '' : 's'} and ${incoming.quotes.length} quote${incoming.quotes.length === 1 ? '' : 's'}`,
        );
      } catch {
        notify('Could not read that file — expected a Marginalia JSON export', { tone: 'danger' });
      }
    };
    reader.readAsText(file);
  };

  return (
    <Modal title="Your data" onClose={onClose} returnFocusTo={returnFocusTo}>
      <p className="muted">
        Your writing is kept in this browser's IndexedDB — nothing leaves the device. Export
        regularly to keep a backup.
      </p>

      <div className="data-section">
        <h3>Storage</h3>
        <StorageRow />
      </div>

      <div className="data-section">
        <h3>Export</h3>
        <div className="data-actions">
          <button type="button" className="btn" onClick={() => doExport(() => exportJson(store.data))}>
            <Icon name="shelf" size={14} /> Full backup (JSON)
          </button>
          <button type="button" className="btn" onClick={() => doExport(() => exportMarkdown(store.data))}>
            Journal (Markdown)
          </button>
          <button type="button" className="btn" onClick={() => doExport(() => exportCsv(store.data))}>
            Books (CSV)
          </button>
          <button type="button" className="btn" onClick={() => doExport(() => exportQuotesCsv(store.data))}>
            Quotes (CSV)
          </button>
        </div>
      </div>

      <div className="data-section">
        <h3>Restore</h3>
        <label className="btn file-label">
          Choose a JSON backup
          <input
            type="file"
            accept=".json,application/json"
            className="visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImport(file);
            }}
          />
        </label>
        <p className="muted">Books and quotes are merged in. Entries with an existing id are kept as they are.</p>
      </div>

      <div className="data-section">
        <h3>Reset</h3>
        {confirming ? (
          <div className="confirm-box">
            <p>
              Delete every book and quote and return to the sample shelf? This cannot be undone.
            </p>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                Keep my data
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  store.clearAll();
                  setConfirming(false);
                  notify('Journal reset to the sample shelf', { tone: 'danger' });
                }}
              >
                Delete everything
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
            Clear all data
          </button>
        )}
      </div>
    </Modal>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StorageRow() {
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const storage = navigator.storage;
    if (!storage?.estimate) return;
    storage
      .estimate()
      .then((estimate) => {
        if (cancelled) return;
        setQuota({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 });
      })
      .catch(() => {});
    if (storage.persisted) {
      storage
        .persisted()
        .then((value) => {
          if (!cancelled) setPersisted(value);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, []);

  if (!quota || quota.quota === 0) return null;
  return (
    <div className="storage-row">
      <span className="numeric">
        {formatBytes(quota.usage)} used of {formatBytes(quota.quota)}
      </span>
      <span className="muted">
        {persisted === false
          ? 'Books may be cleared by the browser when space runs short — exports stay safe.'
          : 'Durable storage granted; books survive space pressure.'}
      </span>
    </div>
  );
}
