import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { ownerMind } from '../services/owner';
import { StatTile } from './charts.jsx';

// The support Mind, as the owner can see it through the builder API: balance, 30-day
// cognition, spend by tool, equipped skills, and the liveness of its Producer conversation.
// Cached nightly by the cron; the refresh button rebuilds it live.

const LIVENESS = {
  active: { label: 'Active', dot: 'bg-emerald-400' },
  working: { label: 'Working', dot: 'bg-amber-400' },
  inactive: { label: 'Inactive', dot: 'bg-slate-500' },
};

const MindPanel = ({ token }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = (refresh = false) => {
    setBusy(true);
    ownerMind(token, { refresh })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (error) return <p className="text-sm text-amber-300">{error}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  const liveness = LIVENESS[data.producerLiveness] ?? LIVENESS.inactive;
  const series = (data.usageSeries ?? []).map((item) => ({ label: item.bucket?.slice(5, 10) ?? '', value: item.value }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-white">{data.name ?? 'Support Mind'}</p>
          <p className="text-xs text-slate-500">
            {data.email ?? data.mindId} · {data.isEnabled === false ? 'disabled' : 'enabled'} · snapshot {data.builtAt ? new Date(data.builtAt).toLocaleString() : '—'}
          </p>
        </div>
        <button type="button" onClick={() => load(true)} disabled={busy} className="chip flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white disabled:opacity-50">
          <RefreshCw className={busy ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> Refresh
        </button>
      </div>

      {data.error && <p className="text-sm text-amber-300">{data.error}</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Cognition balance" value={data.cognitionBalance} />
        <StatTile label="Cognition, 30 days" value={data.cognition30d} series={series} />
        <div className="glass-panel rounded-2xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Producer conversation</p>
          <p className="mt-2 flex items-center gap-2 text-sm text-white">
            <span className={`h-2 w-2 rounded-full ${liveness.dot}`} /> {liveness.label}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">the same three-state read the Producer Inbox shows visitors</p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="glass-panel rounded-2xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Spend by tool · 30 days</p>
          {data.byTool?.length ? (
            <table className="mt-2 w-full text-left text-xs tabular-nums">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="py-1">Tool</th>
                  <th className="py-1 text-right">Calls</th>
                  <th className="py-1 text-right">Credits</th>
                </tr>
              </thead>
              <tbody>
                {data.byTool.map((row) => (
                  <tr key={row.tool} className="border-t border-white/5 text-slate-300">
                    <td className="py-1">{row.tool}</td>
                    <td className="py-1 text-right">{row.callCount}</td>
                    <td className="py-1 text-right">{Number(row.creditsUsed).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-2 text-xs text-slate-500">No per-tool usage reported.</p>
          )}
        </div>
        <div className="glass-panel rounded-2xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Equipped skills</p>
          {data.skills?.length ? (
            <ul className="mt-2 space-y-1 text-xs text-slate-300">
              {data.skills.map((skill) => (
                <li key={skill.skillId} className="flex items-center justify-between gap-3">
                  <span className="truncate">{skill.name ?? skill.skillId}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-500">{skill.source ?? ''}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-500">None reported.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default MindPanel;
