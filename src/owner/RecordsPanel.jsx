import { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, Loader2, X } from 'lucide-react';
import { ownerRecords, ownerRecordsCsv } from '../services/owner';
import { StatTile } from './charts.jsx';
import { formatCount } from './support-copy.js';
import { cn } from '../lib/cn';

// The owner's records, from worker/records.js: which assets were used, which x402 payments went
// through, and who — each visitor, and the Mind they connected. Five views of the same rows.
// Clicking an asset, a visitor or a Mind filters every view to it, so "what did this Mind use,
// and what did it pay" is two clicks: the Mind, then Payments.

const VIEWS = [
  { key: 'assets', label: 'Assets' },
  { key: 'uses', label: 'Uses' },
  { key: 'payments', label: 'Payments' },
  { key: 'minds', label: 'Minds' },
  { key: 'visitors', label: 'Visitors' },
];

const PAGE = 50;
const BASESCAN = 'https://basescan.org';

const when = (ms) =>
  ms ? new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const short = (value, head = 6, tail = 4) => (value && value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value ?? '—');
const tokens = (value) => `${(Number(value) || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} TEST402`;

const STAGE_COPY = { cast: 'Cast', screenplay: 'In a film', rewrite: 'Rewrite' };
const STATUS_TONE = {
  verified: 'text-emerald-300',
  pending: 'text-amber-300',
  reverted: 'text-red-300',
  not_x402: 'text-red-300',
  not_found: 'text-slate-500',
};

/** A value that, clicked, filters every view to it. */
const Pick = ({ onPick, title, children, className }) => (
  <button type="button" onClick={onPick} title={title} className={cn('text-left hover:text-purple-300 hover:underline', className)}>
    {children}
  </button>
);

const AssetCell = ({ row, pick, name = row.name ?? row.asset_name }) => (
  <Pick onPick={() => pick('asset', row.asset_key, name ?? row.asset_key)} title={row.asset_key}>
    <span className="block text-slate-200">{name ?? 'Unnamed piece'}</span>
    <span className="block font-mono text-[10px] text-slate-500">{short(row.asset_key, 18, 8)}</span>
  </Pick>
);
const VisitorCell = ({ id, pick }) =>
  id ? (
    <Pick onPick={() => pick('visitor', id, `Visitor ${id.slice(0, 8)}`)} title={id} className="font-mono text-[11px]">
      {id.slice(0, 8)}
    </Pick>
  ) : (
    <span className="text-slate-600">—</span>
  );
const MindCell = ({ id, name, pick }) =>
  id ? (
    <Pick onPick={() => pick('mind', id, name ?? short(id))} title={id}>
      {name ?? short(id, 8, 4)}
    </Pick>
  ) : (
    <span className="text-slate-600">guest</span>
  );
const Address = ({ value }) =>
  value ? (
    <a href={`${BASESCAN}/address/${value}`} target="_blank" rel="noreferrer" className="font-mono text-[11px] hover:text-purple-300">
      {short(value)}
    </a>
  ) : (
    '—'
  );

// Each view's columns. `drill` is where clicking the row's own subject takes you.
const COLUMNS = {
  assets: [
    { label: 'Asset', cell: (row, pick) => <AssetCell row={row} pick={pick} /> },
    { label: 'Collection', cell: (row) => row.collection ?? '—' },
    { label: 'Casts', num: true, cell: (row) => formatCount(row.casts) },
    { label: 'In films', num: true, cell: (row) => formatCount(row.screenplays) },
    { label: 'Visitors', num: true, cell: (row) => formatCount(row.visitors) },
    { label: 'Minds', num: true, cell: (row) => formatCount(row.minds) },
    { label: 'Payments', num: true, cell: (row) => formatCount(row.payments) },
    { label: 'Paid', num: true, cell: (row) => tokens(row.paid) },
    { label: 'Last used', cell: (row) => when(row.last_used_at) },
  ],
  uses: [
    { label: 'When', cell: (row) => when(row.at) },
    { label: 'Stage', cell: (row) => `${STAGE_COPY[row.stage] ?? row.stage}${row.is_primary ? ' · lead' : ''}` },
    { label: 'Asset', cell: (row, pick) => <AssetCell row={row} pick={pick} /> },
    { label: 'Visitor', cell: (row, pick) => <VisitorCell id={row.visitor_id} pick={pick} /> },
    { label: 'Mind', cell: (row, pick) => <MindCell id={row.mind_id} name={row.mind_name} pick={pick} /> },
  ],
  payments: [
    { label: 'Reported', cell: (row) => when(row.reported_at) },
    {
      label: 'Status',
      cell: (row) => (
        <span className={STATUS_TONE[row.status] ?? 'text-slate-400'} title={row.note ?? undefined}>
          {row.status.replace('_', ' ')}
        </span>
      ),
    },
    { label: 'Asset', cell: (row, pick) => (row.asset_key ? <AssetCell row={row} pick={pick} /> : '—') },
    { label: 'To', cell: (row) => <>{row.role && <span className="mr-1 text-slate-500">{row.role}</span>}<Address value={row.to_address} /></> },
    { label: 'Amount', num: true, cell: (row) => (row.amount != null ? tokens(row.amount) : '—') },
    {
      label: 'Tx',
      cell: (row) => (
        <a href={`${BASESCAN}/tx/${row.tx_hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] hover:text-purple-300">
          {short(row.tx_hash)} <ExternalLink className="h-3 w-3" />
        </a>
      ),
    },
    { label: 'Visitor', cell: (row, pick) => <VisitorCell id={row.visitor_id} pick={pick} /> },
    { label: 'Mind', cell: (row, pick) => <MindCell id={row.mind_id} name={row.mind_name} pick={pick} /> },
  ],
  minds: [
    { label: 'Mind', cell: (row, pick) => <MindCell id={row.mind_id} name={row.name} pick={pick} /> },
    { label: 'Connections', num: true, cell: (row) => formatCount(row.connections) },
    { label: 'Visitors', num: true, cell: (row) => formatCount(row.visitors) },
    { label: 'Assets', num: true, cell: (row) => formatCount(row.assets) },
    { label: 'Uses', num: true, cell: (row) => formatCount(row.uses) },
    { label: 'Payments', num: true, cell: (row) => formatCount(row.payments) },
    { label: 'Paid', num: true, cell: (row) => tokens(row.paid) },
    { label: 'Last seen', cell: (row) => when(row.last_seen_at) },
  ],
  visitors: [
    { label: 'Visitor', cell: (row, pick) => <VisitorCell id={row.visitor_id} pick={pick} /> },
    {
      label: 'Minds',
      cell: (row, pick) => {
        const ids = row.mind_ids?.split(',') ?? [];
        return ids.length ? <MindCell id={ids[0]} name={ids.length === 1 ? row.minds : `${row.minds}`} pick={pick} /> : <span className="text-slate-600">guest</span>;
      },
    },
    { label: 'Assets', num: true, cell: (row) => formatCount(row.assets) },
    { label: 'Uses', num: true, cell: (row) => formatCount(row.uses) },
    { label: 'Payments', num: true, cell: (row) => formatCount(row.payments) },
    { label: 'Paid', num: true, cell: (row) => tokens(row.paid) },
    { label: 'First seen', cell: (row) => when(row.first_seen_at) },
    { label: 'Last seen', cell: (row) => when(row.last_seen_at) },
  ],
};

const FILTER_NOUN = { asset: 'Asset', visitor: 'Visitor', mind: 'Mind' };

const RecordsPanel = ({ token }) => {
  const [view, setView] = useState('assets');
  // { asset: { value, label }, visitor: …, mind: … } — each optional.
  const [filters, setFilters] = useState({});
  const [rows, setRows] = useState(null);
  const [summary, setSummary] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  const params = useCallback(
    (offset = 0) => ({
      view,
      offset,
      limit: PAGE,
      ...Object.fromEntries(Object.entries(filters).map(([name, filter]) => [name, filter.value])),
    }),
    [view, filters],
  );

  useEffect(() => {
    let active = true;
    setRows(null);
    setError(null);
    ownerRecords(token, params(0))
      .then((data) => {
        if (!active) return;
        setRows(data.rows);
        setHasMore(data.hasMore);
        if (data.summary) setSummary(data.summary);
      })
      .catch((err) => active && setError(err.code === 'records_not_configured' ? 'Records are not configured on this environment (no RECORDS database).' : err.message));
    return () => {
      active = false;
    };
  }, [token, params]);

  const loadMore = async () => {
    const data = await ownerRecords(token, params(rows.length));
    setRows((current) => [...current, ...data.rows]);
    setHasMore(data.hasMore);
  };

  // Picking an asset, visitor or Mind filters to it, and from its own list opens its uses.
  const pick = useCallback((name, value, label) => {
    setFilters((current) => ({ ...current, [name]: { value, label } }));
    setView((current) => ((current === 'assets' && name === 'asset') || (current === 'minds' && name === 'mind') || (current === 'visitors' && name === 'visitor') ? 'uses' : current));
  }, []);
  const clearFilter = (name) =>
    setFilters((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await ownerRecordsCsv(token, params(0));
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement('a'), { href: url, download: `minds-monster-${view}-${new Date().toISOString().slice(0, 10)}.csv` });
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const columns = COLUMNS[view];

  return (
    <div className="space-y-5">
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Assets used" value={summary.assets} />
          <StatTile label="Uses" value={summary.uses} sub="casts and films" />
          <StatTile label="Visitors" value={summary.visitors} />
          <StatTile label="Minds" value={summary.minds} />
          <StatTile label="Verified payments" value={summary.payments} sub={tokens(summary.paid)} />
          <StatTile label="Payments being checked" value={summary.pending_payments} sub="on Base, every 5 minutes" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setView(option.key)}
            className={view === option.key ? 'chip px-3 py-1.5 text-xs font-semibold text-purple-300' : 'chip px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-white'}
          >
            {option.label}
          </button>
        ))}
        {Object.entries(filters).map(([name, filter]) => (
          <span key={name} className="chip flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-200">
            <span className="text-slate-500">{FILTER_NOUN[name]}:</span> {filter.label}
            <button type="button" onClick={() => clearFilter(name)} aria-label={`Clear ${FILTER_NOUN[name]} filter`} className="text-slate-500 hover:text-white">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={exportCsv}
          disabled={exporting || !rows?.length}
          className="chip ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-white disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} CSV
        </button>
      </div>

      {error && <p className="text-sm text-amber-300">{error}</p>}

      {!rows && !error ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading records…
        </p>
      ) : rows?.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-black/10 py-10 text-center text-sm text-slate-500">
          Nothing recorded {Object.keys(filters).length ? 'for this filter' : 'yet'}. Records start from the day they were switched on.
        </p>
      ) : rows ? (
        <div className="scrollbar-subtle overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
          <table className="w-full text-left text-xs text-slate-300">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                {columns.map((column) => (
                  <th key={column.label} className={cn('whitespace-nowrap px-3 py-2 font-semibold', column.num && 'text-right')}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.tx_hash ?? row.asset_key + (row.at ?? '') + index} className="border-t border-white/5 align-top">
                  {columns.map((column) => (
                    <td key={column.label} className={cn('px-3 py-2', column.num && 'text-right tabular-nums')}>
                      {column.cell(row, pick)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore && (
            <button type="button" onClick={loadMore} className="w-full border-t border-white/5 px-3 py-2 text-xs font-semibold text-slate-400 hover:text-white">
              Load more
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default RecordsPanel;
