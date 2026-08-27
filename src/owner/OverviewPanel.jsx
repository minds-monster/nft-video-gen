import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ownerOverview } from '../services/owner';
import { StatTile } from './charts.jsx';
import { formatCount } from './support-copy.js';

// The analytics foundation, as tiles: today / 7 days / 30 days for each event the Worker
// records, each with its 30-day sparkline, and the lifetime seeds from records the site
// already kept. Everything here comes from worker/analytics.js's `overview()`.

const METRICS = [
  { key: 'uniques', label: 'Unique visitors' },
  { key: 'page_view', label: 'Page views' },
  { key: 'connect_init', label: 'Connect attempts' },
  { key: 'connect_approved', label: 'Minds connected' },
  { key: 'budget_set', label: 'Budgets set' },
  { key: 'budget_topup', label: 'Top-ups' },
  { key: 'storyboard_started', label: 'Storyboards started' },
  { key: 'film_shot', label: 'Films delivered' },
  { key: 'support_submitted', label: 'Support tickets' },
  { key: 'support_resolved', label: 'Tickets resolved' },
];

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'last7', label: '7 days' },
  { key: 'last30', label: '30 days' },
];

const dayLabel = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

const OverviewPanel = ({ token }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [range, setRange] = useState('last7');

  useEffect(() => {
    let active = true;
    ownerOverview(token)
      .then((result) => active && setData(result))
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [token]);

  if (error) return <p className="text-sm text-amber-300">{error}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  const series = (key) => data.days.map((day) => ({ label: dayLabel(day.day), value: key === 'uniques' ? day.uniques : (day.counts?.[key] ?? 0) }));
  const missingDays = data.days.filter((day) => day.missing).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setRange(option.key)}
            className={range === option.key ? 'chip px-3 py-1.5 text-xs font-semibold text-purple-300' : 'chip px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-white'}
          >
            {option.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-slate-500">
          {!data.recording && 'Not recording (no ANALYTICS binding). '}
          {!data.readable && 'Live reads off (no CF_ANALYTICS_TOKEN). '}
          {data.readable && missingDays > 0 && `${missingDays} of 30 days have no rollup yet. `}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {METRICS.map((metric) => (
          <StatTile key={metric.key} label={metric.label} value={data[range]?.[metric.key] ?? 0} series={series(metric.key)} />
        ))}
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Lifetime, from the site&apos;s own records</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatTile label="Minds ever connected" value={data.lifetime.connectedMinds} />
          <StatTile label="Budgets on file" value={data.lifetime.budgets} />
          <StatTile label="Films on file" value={data.lifetime.films} />
          <StatTile label="Mailing list" value={data.lifetime.subscribers} />
          <StatTile label="Tickets ever" value={data.lifetime.tickets} />
        </div>
      </div>

      <details className="rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-slate-400">
        <summary className="cursor-pointer font-semibold text-slate-300">Table view · last 30 days</summary>
        <div className="scrollbar-subtle mt-3 overflow-x-auto">
          <table className="w-full text-left tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                <th className="py-1 pr-3">Day</th>
                {METRICS.map((metric) => (
                  <th key={metric.key} className="py-1 pr-3">{metric.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...data.days].reverse().map((day) => (
                <tr key={day.day} className="border-t border-white/5">
                  <td className="py-1 pr-3 text-slate-300">{dayLabel(day.day)}{day.live ? ' (live)' : day.missing ? ' ·' : ''}</td>
                  {METRICS.map((metric) => (
                    <td key={metric.key} className="py-1 pr-3">{formatCount(metric.key === 'uniques' ? day.uniques : (day.counts?.[metric.key] ?? 0))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
};

export default OverviewPanel;
