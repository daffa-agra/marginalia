import { useMemo, useState } from 'react';
import type { JournalStore } from '../useJournal';
import type { useToasts } from '../lib/toasts';
import { Modal } from './Modal';
import { InlineAlert } from './EmptyState';
import { Icon } from './icons';
import { ShelfPicker } from './ShelfPicker';
import { looksLikeEpub } from '../lib/epub';
import type { EpubMetadata } from '../lib/epub';
import { extractEpubMetadata } from '../lib/epub';
import { readEpubFile, saveBookBytes } from '../lib/bookFiles';

/**
 * Add a book. Two paths that end in the same place:
 *  - drop an EPUB and its metadata is read from the file
 *  - type it in by hand, as before
 * Both let you choose a shelf, because a book always lands somewhere.
 */
export function UploadBookModal({
  store,
  onClose,
  onSaved,
  notify,
}: {
  store: JournalStore;
  onClose: () => void;
  onSaved: (id: string) => void;
  notify: ReturnType<typeof useToasts>['notify'];
}) {
  const [mode, setMode] = useState<'file' | 'manual'>('file');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{
    file: File;
    metadata: EpubMetadata;
    coverUrl?: string;
  } | null>(null);

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [totalPages, setTotalPages] = useState('');
  const [shelfId, setShelfId] = useState<string | undefined>(undefined);

  const shelves = useMemo(
    () => [...store.data.shelves].sort((a, b) => a.sortOrder - b.sortOrder),
    [store.data.shelves],
  );

  const handleFile = async (file: File) => {
    setError('');
    const check = looksLikeEpub(file.name, file.size);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    setBusy(true);
    try {
      const bytes = await readEpubFile(file);
      const metadata = await extractEpubMetadata(bytes);
      let coverUrl: string | undefined;
      if (metadata.cover) {
        const copy = new Uint8Array(metadata.cover.bytes);
        const blob = new Blob([copy.buffer as ArrayBuffer], { type: metadata.cover.mime });
        coverUrl = URL.createObjectURL(blob);
      }
      setPending({ file, metadata, coverUrl });
      setTitle(metadata.title ?? file.name.replace(/\.epub$/i, ''));
      setAuthor(metadata.author ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that EPUB.');
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const submitFile = async () => {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      const size = pending.file.size;
      const book = store.addBook({
        title: title.trim() || pending.file.name.replace(/\.epub$/i, ''),
        author: author.trim() || 'Unknown author',
        status: 'want-to-read',
        currentPage: 0,
        totalPages: totalPages ? Number.parseInt(totalPages, 10) : undefined,
        genres: [],
        color: '#3f6f71',
        shelfId,
        file: { kind: 'epub', fileName: pending.file.name, size, storage: 'local' },
      });
      // Bytes are stored under the book id so a duplicate title cannot collide.
      const bytes = await readEpubFile(pending.file);
      await saveBookBytes(book.id, bytes);
      notify(`Added “${book.title}”`);
      onSaved(book.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that book.');
    } finally {
      setBusy(false);
    }
  };

  const submitManual = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('Give the book a title.');
      return;
    }
    const book = store.addBook({
      title: title.trim(),
      author: author.trim() || 'Unknown author',
      status: 'want-to-read',
      currentPage: 0,
      totalPages: totalPages ? Number.parseInt(totalPages, 10) : undefined,
      genres: [],
      color: '#3f6f71',
      shelfId,
    });
    notify(`Added “${book.title}”`);
    onSaved(book.id);
  };

  return (
    <Modal title="Add a book" onClose={onClose} wide>
      <div className="segmented" role="group" aria-label="How to add the book">
        <button
          type="button"
          className={mode === 'file' ? 'segment active' : 'segment'}
          aria-pressed={mode === 'file'}
          onClick={() => setMode('file')}
        >
          <Icon name="import" size={14} /> From an EPUB
        </button>
        <button
          type="button"
          className={mode === 'manual' ? 'segment active' : 'segment'}
          aria-pressed={mode === 'manual'}
          onClick={() => setMode('manual')}
        >
          <Icon name="edit" size={14} /> By hand
        </button>
      </div>

      {mode === 'file' ? (
        pending ? (
          <div className="file-preview">
            <div className="file-preview-head">
              {pending.coverUrl ? (
                <img className="file-cover" src={pending.coverUrl} alt="" />
              ) : (
                <div className="file-cover file-cover-empty" aria-hidden="true">
                  <Icon name="shelf" size={22} />
                </div>
              )}
              <div className="file-facts">
                <p className="file-name">{pending.file.name}</p>
                <p className="muted">
                  {(pending.file.size / 1024 / 1024).toFixed(1)} MB ·{' '}
                  {pending.metadata.spineItems > 0
                    ? `${pending.metadata.spineItems} chapters`
                    : 'chapter count unknown'}
                </p>
                {pending.metadata.language && (
                  <p className="muted">Language {pending.metadata.language}</p>
                )}
              </div>
            </div>

            <div className="field">
              <label htmlFor="up-title">Title</label>
              <input
                id="up-title"
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="up-author">Author</label>
                <input
                  id="up-author"
                  className="input"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
              </div>
              <div className="field field-small">
                <label htmlFor="up-pages">Pages</label>
                <input
                  id="up-pages"
                  className="input numeric"
                  type="number"
                  min={0}
                  value={totalPages}
                  onChange={(e) => setTotalPages(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <span className="field-label">Shelf</span>
              <ShelfPicker shelves={shelves} value={shelfId} onChange={setShelfId} />
            </div>

            {error && <InlineAlert>{error}</InlineAlert>}

            <div className="form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setPending(null);
                  setError('');
                }}
              >
                Choose another file
              </button>
              <button type="button" className="btn btn-primary" onClick={submitFile} disabled={busy}>
                {busy ? 'Adding…' : 'Add book'}
              </button>
            </div>
          </div>
        ) : (
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
              if (file) void handleFile(file);
            }}
          >
            <Icon name="import" size={24} className="dropzone-icon" />
            <p className="dropzone-lead">
              {busy ? 'Reading the file…' : 'Drop an EPUB here'}
            </p>
            <label className="btn btn-primary file-label">
              Choose an EPUB
              <input
                type="file"
                accept=".epub,application/epub+zip"
                className="visually-hidden"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
            </label>
            <p className="muted dropzone-help">
              DRM-free EPUB only. Title, author and cover are read from the book itself. The file stays
              in this browser for now.
            </p>
            {error && <InlineAlert>{error}</InlineAlert>}
          </div>
        )
      ) : (
        <form className="form" onSubmit={submitManual} noValidate>
          <div className="field">
            <label htmlFor="mb-title">Title</label>
            <input
              id="mb-title"
              className="input"
              value={title}
              autoFocus
              onChange={(e) => {
                setTitle(e.target.value);
                setError('');
              }}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="mb-author">Author</label>
              <input
                id="mb-author"
                className="input"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>
            <div className="field field-small">
              <label htmlFor="mb-pages">Pages</label>
              <input
                id="mb-pages"
                className="input numeric"
                type="number"
                min={0}
                value={totalPages}
                onChange={(e) => setTotalPages(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <span className="field-label">Shelf</span>
            <ShelfPicker shelves={shelves} value={shelfId} onChange={setShelfId} />
          </div>
          {error && <InlineAlert>{error}</InlineAlert>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Add book
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
