import { useState } from 'react';
import { lookupMetadata } from '../lib/bookLookup';
import type { BookMetadata } from '../lib/bookLookup';
import { Icon } from './icons';

/**
 * "Search the web" for a book's details, shared by every add/edit path.
 *
 * The panel owns the asking: it queries the Open Library with whatever title
 * and author the form currently holds, shows the hits, and hands the chosen
 * one to the form through `onApply`. The form decides what to fill — the
 * panel never writes fields itself, because the two forms keep different
 * state and different rules about what may be overwritten.
 *
 * `onApply` returns a short human summary of what it filled ("author,
 * publisher, cover"), which is shown as the result so the reader can see
 * exactly what the lookup changed.
 */
export function MetadataLookup({
  queryTitle,
  queryAuthor,
  onApply,
  buttonLabel = 'Search the web for details',
}: {
  queryTitle: string;
  queryAuthor: string;
  onApply: (match: BookMetadata) => string;
  buttonLabel?: string;
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [matches, setMatches] = useState<BookMetadata[]>([]);
  const [message, setMessage] = useState('');
  const [applied, setApplied] = useState('');

  const canSearch = queryTitle.trim().length > 0;

  const run = async () => {
    if (!canSearch || status === 'loading') return;
    setStatus('loading');
    setMessage('');
    setApplied('');
    const outcome = await lookupMetadata(queryTitle, queryAuthor);
    if (!outcome.ok) {
      setMessage(outcome.message ?? 'The lookup failed.');
      setStatus('done');
      return;
    }
    setMatches(outcome.matches);
    setStatus('done');
    if (outcome.matches.length === 0) {
      setMessage('No match found. Check the spelling, or fill the details by hand.');
    } else if (outcome.matches.length === 1) {
      // One hit and it is almost certainly the book: apply it and say what
      // changed, rather than making the reader confirm a list of one.
      setApplied(onApply(outcome.matches[0]) || 'details were already filled');
    }
  };

  const pick = (match: BookMetadata) => {
    setApplied(onApply(match) || 'details were already filled');
    setMatches([]);
  };

  return (
    <div className="lookup">
      <div className="lookup-row">
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => void run()}
          disabled={!canSearch || status === 'loading'}
        >
          <Icon name="import" size={12} />
          {status === 'loading' ? 'Searching…' : buttonLabel}
        </button>
        {applied && <span className="lookup-hint">From the Open Library: {applied}</span>}
        {message && <span className="lookup-hint">{message}</span>}
      </div>

      {matches.length > 1 && (
        <ul className="lookup-results">
          {matches.map((m, i) => (
            <li key={`${m.title}-${i}`}>
              <button type="button" className="lookup-option" onClick={() => pick(m)}>
                {m.coverUrl ? (
                  <img className="lookup-thumb" src={m.coverUrl} alt="" loading="lazy" />
                ) : (
                  <span className="lookup-thumb lookup-thumb-empty" aria-hidden="true" />
                )}
                <span className="lookup-facts">
                  <span className="lookup-title">{m.title ?? 'Untitled'}</span>
                  <span className="muted">
                    {m.author ?? 'Unknown author'}
                    {m.publisher ? ` · ${m.publisher}` : ''}
                    {m.publishedYear ? ` · ${m.publishedYear}` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
