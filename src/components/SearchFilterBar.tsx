import type { ReadStatus } from '../types';
import { STATUS_META, STATUS_ORDER } from '../types';

export function SearchFilterBar({
  query,
  onQuery,
  status,
  onStatus,
  genre,
  genres,
  onGenre,
  sort,
  onSort,
  counts,
  total,
}: {
  query: string;
  onQuery: (v: string) => void;
  status: ReadStatus | 'all';
  onStatus: (s: ReadStatus | 'all') => void;
  genre: string;
  genres: string[];
  onGenre: (g: string) => void;
  sort: string;
  onSort: (s: 'recent' | 'title' | 'author' | 'rating' | 'progress') => void;
  counts: Map<ReadStatus, number>;
  total: number;
}) {
  const statusTabs: Array<{ value: ReadStatus | 'all'; label: string; count: number }> = [
    { value: 'all', label: 'All', count: total },
    ...STATUS_ORDER.map((s) => ({
      value: s,
      label: STATUS_META[s].plural,
      count: counts.get(s) ?? 0,
    })),
  ];

  // A filter group, not a tab control: arrows move between radios.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const group = event.currentTarget;
    const radios = [...group.querySelectorAll<HTMLButtonElement>('button[role="radio"]')];
    // Derive the position from what actually has focus, not from state that
    // may be a render behind.
    const current = radios.indexOf(document.activeElement as HTMLButtonElement);
    const from = current >= 0 ? current : Math.max(0, selectedIndex);
    let next = from;
    if (event.key === 'ArrowRight') next = (from + 1) % radios.length;
    if (event.key === 'ArrowLeft') next = (from - 1 + radios.length) % radios.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = radios.length - 1;
    radios[next]?.focus();
    onStatus(statusTabs[next].value);
  };

  const selectedIndex = statusTabs.findIndex((t) => t.value === status);

  return (
    <div className="filter-bar">
      <div className="filter-row">
        <div className="status-tabs" role="radiogroup" aria-label="Filter by status" onKeyDown={onKeyDown}>
          {statusTabs.map((t, index) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={status === t.value}
              tabIndex={index === selectedIndex ? 0 : -1}
              className={status === t.value ? 'tab active' : 'tab'}
              onClick={() => onStatus(t.value)}
            >
              <span>{t.label}</span>
              <span className="tab-count numeric">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="filter-controls">
          <label className="visually-hidden" htmlFor="library-search">
            Search books
          </label>
          <input
            id="library-search"
            type="search"
            className="input search-input"
            placeholder="Search title, author, series"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
          <label className="visually-hidden" htmlFor="genre-filter">
            Filter by genre
          </label>
          <select
            id="genre-filter"
            className="input select"
            value={genre}
            onChange={(e) => onGenre(e.target.value)}
          >
            <option value="all">All genres</option>
            {genres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <label className="visually-hidden" htmlFor="sort-select">
            Sort books
          </label>
          <select
            id="sort-select"
            className="input select"
            value={sort}
            onChange={(e) => onSort(e.target.value as 'recent' | 'title' | 'author' | 'rating' | 'progress')}
          >
            <option value="recent">Recently added</option>
            <option value="title">Title A–Z</option>
            <option value="author">Author A–Z</option>
            <option value="rating">Highest rated</option>
            <option value="progress">Progress</option>
          </select>
        </div>
      </div>
    </div>
  );
}
