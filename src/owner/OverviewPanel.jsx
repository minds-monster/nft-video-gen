import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ownerAnalyticsHeal, ownerOverview } from '../services/owner';
import { StatTile } from './charts.jsx';
import { formatCount } from './support-copy.js';

// The analytics foundation, as tiles: today / 7 days / 30 days for each event the Worker
// records, each with its 30-day sparkline, and the lifetime seeds from records the site
// already kept. Everything here comes from worker/analytics.js's `overview()`.
//
// Every tile is a COUNT of events. The three that involve money also show the dollars under
// the count (`amount: true`) — those used to be the tile's number, which is how "Top-ups"
// once read as a dollar figure.

const METRICS = [
  { key: 'uniques', label: 'Unique visitors' },
  { key: 'page_view', label: 'Page views' },
  { key: 'connect_init', label: 'Connect attempts' },
  { key: 'connect_approved', label: 'Minds connected' },
  { key: 'budget_set', label: 'Budgets set' },
  { key: 'checkout_started', label: 'Checkouts started', amount: true },
  { key: 'budget_topup', label: 'Top-ups paid', amount: true },
  { key: 'storyboard_started', label: 'Storyboards started' },
  { key: 'film_shot', label: 'Films delivered', amount: true },
  { key: 'support_submitted', label: 'Support tickets' },
  { key: 'support_resolved', label: 'Tickets resolved' },
];

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'last7', label: '7 days' },
  { key: 'last30', label: '30 days' },
];

const usd = (value) => `$${(Number(value) || 0).toFixed(2)}`;

const dayLabel = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

const OverviewPanel = ({ token }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [range, setRange] = useState('last7');
  const [healing, setHealing] = useState(false);
  const [healNote, setHealNote] = useState(null);
  const [loads, setLoads] = useState(0);

  useEffect(() => {
    let active = true;
    ownerOverview(token)
      .then((result) => active && setData(result))
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [token, loads]);

  // The nightly job repairs a batch of days on its own; this does the same batch now.
  const heal = useCallback(async () => {
    setHealing(true);
    try {
      const { healed, failed, remaining } = await ownerAnalyticsHeal(token);
      setHealNote(
        `Rebuilt ${healed.length} day${healed.length === 1 ? '' : 's'}` +
          (failed.length ? `, ${failed.length} failed (${failed[0].error})` : '') +
          (remaining ? `, ${remaining} still to do — run it again` : '') +
          '.',
      );
      setLoads((n) => n + 1);
    } catch (err) {
      setHealNote(`Rebuild failed: ${err.message}`);
    } finally {
      setHealing(false);
    }
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
  const staleDays = data.days.filter((day) => day.stale).length;
  const repairable = data.readable && missingDays + staleDays > 0;
  const tileSub = (metric) => {
    if (metric.amount) return usd(data[range]?.amounts?.[metric.key]);
    if (metric.key === 'uniques' && range !== 'today' && !data.uniquesDistinct) return 'sum of daily uniques';
    return undefined;
  };

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
          {data.readable && staleDays > 0 && `${staleDays} days use the old rollup, which counted dollars as events. `}
          {healNote}
        </span>
        {repairable && (
          <button
            type="button"
            onClick={heal}
            disabled={healing}
            className="chip flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-purple-300 hover:text-white disabled:opacity-60"
          >
            {healing && <Loader2 className="h-3 w-3 animate-spin" />}
            Rebuild from raw events
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {METRICS.map((metric) => (
          <StatTile key={metric.key} label={metric.label} value={data[range]?.[metric.key] ?? 0} sub={tileSub(metric)} series={series(metric.key)} />
        ))}
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Lifetime, from the site&apos;s own records</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Minds ever connected" value={data.lifetime.connectedMinds} />
          <StatTile label="Minds with a budget" value={data.lifetime.budgets} />
          <StatTile label="Unclaimed guest top-ups" value={data.lifetime.guestBudgets ?? 0} />
          <StatTile label="Productions opened" value={data.lifetime.films} />
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
                  <td className="py-1 pr-3 text-slate-300">{dayLabel(day.day)}{day.live ? ' (live)' : day.missing ? ' ·' : day.stale ? ' *' : ''}</td>
                  {METRICS.map((metric) => (
                    <td key={metric.key} className="py-1 pr-3">
                      {formatCount(metric.key === 'uniques' ? day.uniques : (day.counts?.[metric.key] ?? 0))}
                      {metric.amount && day.amounts?.[metric.key] ? ` · ${usd(day.amounts[metric.key])}` : ''}
                    </td>
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
