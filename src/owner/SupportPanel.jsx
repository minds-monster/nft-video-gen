import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, User } from 'lucide-react';
import { ownerSupportList, ownerSupportStats } from '../services/owner';
import { StatTile, Histogram } from './charts.jsx';
import { STATUS_COPY, formatAge } from './support-copy.js';
import { cn } from '../lib/cn';

// The support inbox, the way Adam asked for it: aggregates first, the list of STATES under
// them, and the content of a ticket only on an explicit click (TicketView). No message
// text on this screen.

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'replied-unmarked', label: 'Unmarked' },
  { key: 'resolved', label: 'Resolved' },
  { key: '', label: 'All' },
];

// Pinned to the top regardless of age: the states that are waiting on the OWNER.
const PIN_RANK = (row) => (row.humanRequested && row.open ? 0 : row.status === 'escalated' ? 1 : row.status === 'replied-unmarked' ? 2 : row.slaBreached ? 3 : 4);

const Row = ({ row, onOpen }) => {
  const state = STATUS_COPY[row.status] ?? STATUS_COPY.received;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
        row.humanRequested && row.open
          ? 'border-red-400/40 bg-red-400/5 hover:border-red-400/60'
          : row.status === 'escalated' || row.slaBreached
            ? 'border-amber-400/40 bg-amber-400/5 hover:border-amber-400/60'
            : 'border-white/10 bg-black/20 hover:border-white/20',
      )}
    >
      <span className="w-16 shrink-0 font-mono text-[11px] text-slate-500">#{row.ticketId}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {row.humanRequested && <User className="h-3 w-3 shrink-0 text-red-300" aria-label="asked for a human" />}
          {row.urgent && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-300" aria-label="urgent" />}
          <span className="truncate text-sm text-slate-200">{row.subject || 'Untitled'}</span>
        </span>
        <span className="mt-0.5 block text-[11px] text-slate-500">
          received {formatAge(row.ageMs)} ago
          {row.seenAt && ' · seen'}
          {row.replies > 0 && ` · ${row.replies} repl${row.replies === 1 ? 'y' : 'ies'}`}
          {row.reopenCount > 0 && ` · reopened ×${row.reopenCount}`}
          {row.mindId && ` · mind ${row.mindId}…`}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className={cn('block text-xs font-semibold', state.className)}>{state.label}</span>
        {row.status === 'escalated' && <span className="block text-[10px] text-amber-300/80">{formatAge(row.escalatedAgeMs)} · SLA 4h</span>}
        {row.slaBreached && <span className="block text-[10px] text-red-300">SLA breached · {row.slaBreached}</span>}
      </span>
    </button>
  );
};

const pct = (value) => `${Math.round((value ?? 0) * 100)}%`;

const SupportPanel = ({ token, onOpenTicket }) => {
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [filter, setFilter] = useState('open');
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    ownerSupportStats(token)
      .then((data) => active && setStats(data))
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    let active = true;
    setRows(null);
    ownerSupportList(token, { status: filter || undefined })
      .then((data) => {
        if (!active) return;
        setRows(data.tickets);
        setCursor(data.cursor);
      })
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [token, filter]);

  const loadMore = async () => {
    const data = await ownerSupportList(token, { status: filter || undefined, cursor });
    setRows((prev) => [...(prev ?? []), ...data.tickets]);
    setCursor(data.cursor);
  };

  const sorted = rows ? [...rows].sort((a, b) => PIN_RANK(a) - PIN_RANK(b)) : null;
  const window = stats?.last7;

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-amber-300">{error}</p>}

      {stats && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Open" value={stats.open} sub={Object.entries(stats.byState).filter(([s]) => s !== 'resolved').map(([s, n]) => `${n} ${STATUS_COPY[s]?.label?.toLowerCase() ?? s}`).join(' · ') || 'nothing waiting'} />
            <StatTile label="SLA breaches" value={stats.breaches.total} tone={stats.breaches.total ? 'text-red-300' : undefined} sub={`${stats.breaches.seen} unseen >4h · ${stats.breaches.replied} unanswered >8h · ${stats.breaches.escalation} on you >4h`} />
            <StatTile label="Escalation rate · 7d" value={pct(window?.escalationRate)} formatter={(v) => v} sub={`${window?.escalated ?? 0} of ${window?.tickets ?? 0} tickets`} />
            <StatTile label="Reopened after resolved · 30d" value={pct(stats.last30?.reopenRate)} formatter={(v) => v} sub={`${stats.last30?.reopened ?? 0} of ${stats.last30?.resolved ?? 0} resolved — Adam's quality signal`} />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="glass-panel rounded-2xl p-4 lg:col-span-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Time to first action · 30 days</p>
              <p className="mt-0.5 text-xs text-slate-500">
                received → [seen]. Median {stats.last30?.medianFirstActionMs != null ? formatAge(stats.last30.medianFirstActionMs) : '—'} across {stats.last30?.seen ?? 0} seen tickets.
              </p>
              <div className="mt-3">
                <Histogram buckets={stats.last30?.histogram ?? []} />
              </div>
            </div>
            <div className="glass-panel rounded-2xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Cost per ticket</p>
              {stats.costBand ? (
                <>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
                    {stats.costBand.low}–{stats.costBand.high} <span className="text-sm font-normal text-slate-400">credits</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{stats.costBand.basis}</p>
                </>
              ) : (
                <p className="mt-2 text-xs text-slate-500">Shown once there are five tickets in 30 days — fewer and the division says nothing.</p>
              )}
              <p className="mt-3 text-[11px] text-slate-500">
                A band, not a number — “cheaper replies ≠ better replies.” {window?.humanRequested ?? 0} asked for a human this week; {window?.unmarked ?? 0} had unmarked replies.
              </p>
            </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setFilter(option.key)}
            className={filter === option.key ? 'chip px-3 py-1.5 text-xs font-semibold text-purple-300' : 'chip px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-white'}
          >
            {option.label}
          </button>
        ))}
      </div>

      {!sorted ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading tickets…
        </p>
      ) : sorted.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-black/10 py-10 text-center text-sm text-slate-500">Nothing here.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((row) => (
            <Row key={row.ticketId} row={row} onOpen={() => onOpenTicket(row.ticketId)} />
          ))}
          {cursor && (
            <button type="button" onClick={loadMore} className="chip w-full px-3 py-2 text-xs font-semibold text-slate-400 hover:text-white">
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SupportPanel;
