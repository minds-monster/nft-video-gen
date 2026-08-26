import { useEffect, useState } from 'react';
import { setProducerBudget } from '../services/mindConnect';
import { useMindChatContext } from '../context/mindChat';

/**
 * The Producer's money control: a total, a per-render cap, and the deliberate opt-in to the
 * paid model.
 */
const BudgetWidget = ({ token, budget, onUpdated }) => {
  const { checkout } = useMindChatContext();
  const [total, setTotal] = useState(budget?.total ?? '');
  const [perRender, setPerRender] = useState(budget?.perRender ?? '');
  const [paidTier, setPaidTier] = useState(budget?.paidTier ?? false);
  const [saving, setSaving] = useState(false);
  const [addAmount, setAddAmount] = useState('10');

  useEffect(() => {
    setTotal(budget?.total ?? '');
    setPerRender(budget?.perRender ?? '');
    setPaidTier(budget?.paidTier ?? false);
  }, [budget?.total, budget?.perRender, budget?.paidTier]);

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const result = await setProducerBudget(token, {
        total: total === '' ? null : Number(total),
        perRender: perRender === '' ? null : Number(perRender),
        paidTier: total === '' ? false : paidTier,
      });
      onUpdated?.(result.budget);
    } catch {
      // Silently ignored — the fields keep whatever the visitor typed, they can retry.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-4">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Budget Settings</p>
          <p className="text-xs text-slate-500">
            {budget ? 'Your Producer is properly in the loop now.' : "The one thing that gets your Producer properly involved — total spend, a per-render cap, or both."}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Total Budget (Paid)
            <input
              type="text"
              readOnly
              value={total !== '' ? `$${Number(total).toFixed(2)}` : '$0.00'}
              className="w-28 rounded-lg border border-white/5 bg-white/5 px-2 py-1.5 text-sm text-slate-400 outline-none cursor-not-allowed"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Per-render cap
            <input
              type="number"
              min="0"
              step="0.01"
              value={perRender}
              onChange={(e) => setPerRender(e.target.value)}
              placeholder="$"
              className="w-24 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500/50"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="chip px-3 py-1.5 text-xs font-semibold text-purple-300 hover:text-purple-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save Limits'}
          </button>
        </div>

        {/* The model choice */}
        <label className="flex items-start gap-2 border-t border-white/5 pt-3 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={paidTier}
            disabled={total === ''}
            onChange={(e) => setPaidTier(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-purple-500 disabled:opacity-40"
          />
          <span>
            <span className={total === '' ? 'text-slate-600' : 'text-slate-300'}>
              Use full-quality generation
            </span>
            <span className="block text-[11px] leading-relaxed text-slate-500">
              {total === ''
                ? 'Add budget credits first — paid generation always runs under a ceiling.'
                : 'Runs the storyboard on GPT-5.6-Sol, about $0.26 a scene, and allows longer scenes. Leave this off and it stays free.'}
            </span>
          </span>
        </label>
      </form>

      {/* Top-up Balance section */}
      <div className="mt-4 border-t border-white/5 pt-4 flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 font-medium">Add Budget Credits</p>
        <div className="flex flex-wrap items-center gap-2">
          {['5', '10', '25', '50'].map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => setAddAmount(amt)}
              className={`chip px-2.5 py-1.5 text-xs ${addAmount === amt ? 'bg-purple-600/30 text-purple-200 border-purple-500/50' : 'text-slate-400 hover:text-slate-300'}`}
            >
              ${amt}
            </button>
          ))}
          <label className="flex items-center gap-1.5 text-xs text-slate-400 ml-auto">
            Custom: $
            <input
              type="number"
              min="1"
              max="1000"
              value={addAmount}
              onChange={(e) => setAddAmount(e.target.value)}
              className="w-16 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white outline-none focus:border-purple-500/50"
            />
          </label>
          <button
            type="button"
            disabled={!addAmount || Number(addAmount) < 1}
            onClick={() => checkout(Number(addAmount))}
            className="chip bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add & Pay
          </button>
        </div>
      </div>
    </div>
  );
};

export default BudgetWidget;
