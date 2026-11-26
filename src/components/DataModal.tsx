import { useState } from 'react';
import type { JournalStore } from '../useJournal';
import { Modal } from './Modal';
import { sanitizeData, mergeData } from '../storage';
import { exportCsv, exportJson, exportMarkdown, exportQuotesCsv, downloadTextFile } from '../lib/exporters';
import type { ExportFile } from '../lib/exporters';

export function DataModal({ store, onClose }: { store: JournalStore; onClose: () => void }) {
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);

  const doExport = (make: () => ExportFile) => {
    downloadTextFile(make());
    setMessage('Download started.');
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = sanitizeData(JSON.parse(String(reader.result)));
        if (incoming.books.length === 0 && incoming.quotes.length === 0) {
          setMessage('That file has no books or quotes.');
          return;
        }
        store.replaceAll(mergeData(store.data, incoming));
        setMessage(
          `Merged ${incoming.books.length} book${incoming.books.length === 1 ? '' : 's'} and ${incoming.quotes.length} quote${incoming.quotes.length === 1 ? '' : 's'}.`,
        );
      } catch {
        setMessage('Could not read that file — expected a Marginalia JSON export.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <Modal title="Your data" onClose={onClose}>
      <p className="muted">
        Everything lives in this browser's local storage — there is no server. Export regularly to
        keep a backup.
      </p>

      <div className="data-section">
        <h3>Export</h3>
        <div className="data-actions">
          <button type="button" className="btn" onClick={() => doExport(() => exportJson(store.data))}>
            Full backup (JSON)
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
          Choose a JSON backup…
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
        <p className="muted">Books and quotes are merged in; duplicates by id are skipped.</p>
      </div>

      <div className="data-section">
        <h3>Reset</h3>
        {confirming ? (
          <div className="confirm-box">
            <p>
              Delete all books and quotes and restore the sample shelf? This cannot be undone —
              export first if in doubt.
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
                  setMessage('Journal reset to the sample shelf.');
                }}
              >
                Delete everything
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
            Clear all data…
          </button>
        )}
      </div>

      {message && (
        <p className="data-message" role="status">
          {message}
        </p>
      )}
    </Modal>
  );
}
