import { useMemo } from 'react';
import type { JournalData } from '../types';
import { EmptyState } from '../components/EmptyState';
import { formatNumber } from '../lib/utils';

export function StatsView({ data }: { data: JournalData }) {
  const stats = useMemo(() => computeStats(data), [data]);

  if (data.books.length === 0) {
    return (
      <section className="view" aria-labelledby="stats-title">
        <div className="view-head">
          <div>
            <h1 id="stats-title">Reading life</h1>
          </div>
        </div>
        <EmptyState
          title="No stats yet"
          body="Add books and mark them finished — your reading patterns show up here."
        />
      </section>
    );
  }

  const topGenres = stats.genres.slice(0, 6);
  const maxGenre = topGenres[0]?.count ?? 1;
  const rated = stats.avgRating > 0;

  return (
    <section className="view" aria-labelledby="stats-title">
      <div className="view-head">
        <div>
          <h1 id="stats-title">Reading life</h1>
          <p className="muted">{stats.yearLabel}</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-value numeric">{formatNumber(stats.finishedThisYear)}</span>
          <span className="stat-label">finished this year</span>
        </div>
        <div className="stat-card">
          <span className="stat-value numeric">{formatNumber(stats.finishedAllTime)}</span>
          <span className="stat-label">finished all time</span>
        </div>
        <div className="stat-card">
          <span className="stat-value numeric">{formatNumber(stats.pagesThisYear)}</span>
          <span className="stat-label">pages this year</span>
        </div>
        <div className="stat-card">
          <span className="stat-value numeric">{stats.avgDays > 0 ? stats.avgDays : '–'}</span>
          <span className="stat-label">avg days per book</span>
        </div>
        <div className="stat-card">
          <span className="stat-value numeric">{rated ? stats.avgRating.toFixed(1) : '–'}</span>
          <span className="stat-label">avg rating</span>
        </div>
        <div className="stat-card">
          <span className="stat-value numeric">{formatNumber(stats.currentlyReading)}</span>
          <span className="stat-label">in progress now</span>
        </div>
      </div>

      <div className="stats-columns">
        <div className="stats-panel">
          <h2>Genres</h2>
          {topGenres.length === 0 ? (
            <p className="muted">Add genres to your books to see the breakdown.</p>
          ) : (
            <ul className="bar-list">
              {topGenres.map((g) => (
                <li key={g.name}>
                  <span className="bar-label">{g.name}</span>
                  <span className="bar-track">
                    <span
                      className="bar-fill"
                      style={{ width: `${Math.max(4, (g.count / maxGenre) * 100)}%` }}
                    />
                  </span>
                  <span className="bar-value numeric">{g.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="stats-panel">
          <h2>Months</h2>
          <p className="muted">Books finished per month, last twelve months.</p>
          <div
            className="month-chart"
            role="img"
            aria-label={`Books finished per month for the last twelve months. ${stats.months
              .map((m) => `${m.label}: ${m.count}`)
              .join(', ')}.`}
          >
            {stats.months.map((m) => {
              const height =
                stats.maxMonth > 0 && m.count > 0 ? Math.max(6, (m.count / stats.maxMonth) * 100) : 0;
              return (
                <div
                  key={m.key}
                  className={m.isCurrent ? 'month-col current' : 'month-col'}
                  title={`${m.label}: ${m.count} finished`}
                >
                  <span className="month-count numeric">{m.count > 0 ? m.count : ''}</span>
                  <div className="month-bar-slot">
                    {m.count > 0 ? (
                      <div className="month-bar" style={{ height: `${height}%` }} />
                    ) : (
                      <div className="month-bar empty" />
                    )}
                  </div>
                  <span className="month-label">{m.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="stats-panel">
        <h2>{stats.best.rating > 0 ? `Your ${stats.best.rating}-star shelf` : 'Your favourites'}</h2>
        {stats.best.books.length === 0 ? (
          <p className="muted">Rate finished books to build a top shelf.</p>
        ) : (
          <ul className="fave-list">
            {stats.best.books.map((b) => (
              <li key={b.id}>
                <span className="fave-title">{b.title}</span>
                <span className="muted">{b.author}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

interface Stats {
  yearLabel: string;
  finishedThisYear: number;
  finishedAllTime: number;
  pagesThisYear: number;
  avgDays: number;
  avgRating: number;
  currentlyReading: number;
  genres: Array<{ name: string; count: number }>;
  months: Array<{ key: string; label: string; count: number; isCurrent: boolean }>;
  maxMonth: number;
  best: { rating: number; books: Array<{ id: string; title: string; author: string }> };
}

function computeStats(data: JournalData): Stats {
  const now = new Date();
  const year = now.getFullYear();
  const currentKey = `${year}-${`${now.getMonth() + 1}`.padStart(2, '0')}`;

  const finished = data.books.filter((b) => b.status === 'finished');
  const finishedThisYear = finished.filter((b) => b.finishedAt && b.finishedAt.startsWith(`${year}`));
  const pagesThisYear = finishedThisYear.reduce((sum, b) => sum + (b.totalPages ?? 0), 0);

  const dayDiffs = finished
    .filter((b) => b.startedAt && b.finishedAt)
    .map((b) =>
      Math.round(
        (new Date(`${b.finishedAt}T00:00:00`).getTime() -
          new Date(`${b.startedAt}T00:00:00`).getTime()) /
          86_400_000,
      ),
    )
    .filter((d) => d >= 0);
  const avgDays =
    dayDiffs.length > 0 ? Math.round(dayDiffs.reduce((a, b) => a + b, 0) / dayDiffs.length) : 0;

  const rated = data.books.filter((b) => b.rating != null);
  const avgRating =
    rated.length > 0 ? rated.reduce((sum, b) => sum + (b.rating ?? 0), 0) / rated.length : 0;

  const genreCounts = new Map<string, number>();
  for (const b of data.books) {
    for (const g of b.genres) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
  }
  const genres = [...genreCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const months: Stats['months'] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(year, now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`;
    const count = finished.filter((b) => (b.finishedAt ?? '').startsWith(key)).length;
    months.push({
      key,
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      count,
      isCurrent: key === currentKey,
    });
  }
  const maxMonth = Math.max(1, ...months.map((m) => m.count));

  const maxRating = rated.length > 0 ? Math.max(...rated.map((b) => b.rating ?? 0)) : 0;
  const best = {
    rating: maxRating,
    books: rated
      .filter((b) => b.rating === maxRating && maxRating > 0)
      .map((b) => ({ id: b.id, title: b.title, author: b.author })),
  };

  return {
    yearLabel: `${year} so far`,
    finishedThisYear: finishedThisYear.length,
    finishedAllTime: finished.length,
    pagesThisYear,
    avgDays,
    avgRating,
    currentlyReading: data.books.filter((b) => b.status === 'reading').length,
    genres,
    months,
    maxMonth,
    best,
  };
}
