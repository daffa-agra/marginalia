import { useEffect, useState } from 'react';
import type { JournalStore } from '../useJournal';
import { Modal } from './Modal';
import { parseAnnotationFile } from '../lib/playbooks';
import type { ParsedFile } from '../lib/playbooks';
import { makeId } from '../lib/utils';
import type { Book } from '../types';

interface ImportRow {
  quoteText: string;
  note?: string;
  position?: string;
}

interface ImportTarget {
  key: string;
  bookTitle: string;
  author?: string;
  rows: ImportRow[];
  /** Existing book id if we matched one by title. */
  matchedBookId?: string;
  /** When no book matched, the user can create one with an author override. */
  newAuthor: string;
  createNew: boolean;
}

function baseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[:：].*$/, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Match imports to books, ignoring subtitles/punctuation differences. */
function findMatch(bookTitle: string, books: Book[]): Book | undefined {
  const wanted = baseTitle(bookTitle);
  if (!wanted) return undefined;
  return books.find((b) => baseTitle(b.title) === wanted);
}

export function ImportModal({
  store,
  onClose,
  onOpenBook,
}: {
  store: JournalStore;
  onClose: () => void;
  onOpenBook: (id: string) => void;
}) {
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [targets, setTargets] = useState<ImportTarget[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [warning, setWarning] = useState('');
  const [done, setDone] = useState<Array<{ bookId: string; count: number }>>([]);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? '');
      try {
        const result = parseAnnotationFile(file.name, content);
        if (result.docs.length === 0) {
          setWarning(`Nothing importable found in "${file.name}".`);
          return;
        }
        setParsed(result);
        setWarning('');
        setDone([]);
        setTargets(
          result.docs.map((doc) => {
            const match = findMatch(doc.bookTitle, store.data.books);
            return {
              key: makeId('t'),
              bookTitle: doc.bookTitle,
              author: doc.author,
              rows: doc.highlights.map((h) => ({ quoteText: h.text, note: h.note, position: h.position })),
              matchedBookId: match?.id,
              newAuthor: doc.author ?? '',
              createNew: !match,
            };
          }),
        );
      } catch (err) {
        setWarning(`Could not read that file: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    };
    reader.readAsText(file);
  };

  const importAll = () => {
    const results: Array<{ bookId: string; count: number }> = [];
    for (const target of targets) {
      if (target.rows.length === 0) continue;
      let bookId = target.matchedBookId;
      if (!bookId && target.createNew) {
        const created = store.addBook({
          title: target.bookTitle,
          author: target.newAuthor.trim() || target.author || 'Unknown author',
          status: 'want-to-read',
          currentPage: 0,
          genres: ['Imported'],
          color: '#704f8f',
        });
        bookId = created.id;
      }
      if (!bookId) continue;
      const existing = new Set(
        (store.quotesByBook.get(bookId) ?? []).map((q) => q.text.toLowerCase()),
      );
      const fresh = target.rows.filter((r) => !existing.has(r.quoteText.toLowerCase()));
      if (fresh.length > 0) {
        store.addQuotes(
          bookId,
          fresh.map((r) => ({ text: r.quoteText, note: r.note, position: r.position })),
        );
      }
      results.push({ bookId, count: fresh.length });
    }
    setDone(results);
  };

  const setTarget = (key: string, patch: Partial<ImportTarget>) =>
    setTargets((ts) => ts.map((t) => (t.key === key ? { ...t, ...patch } : t)));

  useEffect(() => {
    if (done.length === 0) return;
    const timer = window.setTimeout(() => {
      const first = done[0];
      if (first) onOpenBook(first.bookId);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [done, onOpenBook]);

  const step: 'pick' | 'review' | 'done' = done.length > 0 ? 'done' : parsed ? 'review' : 'pick';
  const totalCount = targets.reduce((sum, t) => sum + t.rows.length, 0);

  return (
    <Modal title="Import Play Books highlights" onClose={onClose} wide>
      {step === 'pick' && (
        <div
          className={`dropzone ${dragOver ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
        >
          <p className="dropzone-icon" aria-hidden="true">
            ⬇
          </p>
          <p>Drop your Play Books notes export here, or</p>
          <label className="btn btn-primary file-label">
            Choose a file
            <input
              type="file"
              accept=".txt,.md,.csv,.json,.html,.htm,text/plain,text/html,text/csv,application/json"
              className="visually-hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </label>
          <p className="muted">
            In the Play Books app: open a book → Notes → Export notes. It saves a document to
            your Google Drive — download it (or any .txt/.md/.csv/.json/.html notes file) and drop
            it here.
          </p>
          {warning && (
            <p className="form-error" role="alert">
              {warning}
            </p>
          )}
        </div>
      )}

      {step === 'review' && parsed && (
        <div>
          <p className="muted">
            <strong>{parsed.filename}</strong> — {totalCount} highlight{totalCount === 1 ? '' : 's'} found.
          </p>
          {parsed.warnings.map((w, i) => (
            <p key={i} className="import-warning">
              {w}
            </p>
          ))}
          {targets.map((target) => (
            <div key={target.key} className="import-target">
              <div className="import-target-head">
                <div>
                  <strong>{target.bookTitle}</strong>
                  {target.author && <span className="muted"> · {target.author}</span>}
                  <p className="muted">
                    {target.rows.length} highlight{target.rows.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="import-target-controls">
                  {target.matchedBookId ? (
                    <>
                      <span className="match-chip">Matches your copy</span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setTarget(target.key, { matchedBookId: undefined, createNew: true })}
                      >
                        Create new instead
                      </button>
                    </>
                  ) : (
                    <>
                      <select
                        aria-label={`Attach ${target.bookTitle} highlights to`}
                        className="input select"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) setTarget(target.key, { matchedBookId: e.target.value, createNew: false });
                        }}
                      >
                        <option value="">Create a new book…</option>
                        {store.data.books.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.title}
                          </option>
                        ))}
                      </select>
                      {target.createNew && (
                        <input
                          className="input"
                          aria-label="Author for the new book"
                          placeholder="Author"
                          value={target.newAuthor}
                          onChange={(e) => setTarget(target.key, { newAuthor: e.target.value })}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
              <ul className="import-preview" role="list">
                {target.rows.slice(0, 4).map((row, i) => (
                  <li key={i}>
                    <blockquote>“{row.quoteText}”</blockquote>
                    {row.note && <p className="muted">Note: {row.note}</p>}
                    {row.position && <p className="muted">{row.position}</p>}
                  </li>
                ))}
                {target.rows.length > 4 && <li className="muted">…and {target.rows.length - 4} more</li>}
              </ul>
            </div>
          ))}
          <div className="form-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setParsed(null);
                setTargets([]);
              }}
            >
              Pick another file
            </button>
            <button type="button" className="btn btn-primary" onClick={importAll}>
              Import {totalCount} highlight{totalCount === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="import-done" role="status">
          <p className="dropzone-icon" aria-hidden="true">
            ✓
          </p>
          {done.map((d) => (
            <p key={d.bookId}>
              Imported{' '}
              <strong>
                {d.count} highlight{d.count === 1 ? '' : 's'}
              </strong>{' '}
              into <strong>{store.data.books.find((b) => b.id === d.bookId)?.title ?? 'your journal'}</strong>.
            </p>
          ))}
          <p className="muted">Opening the book…</p>
        </div>
      )}
    </Modal>
  );
}
