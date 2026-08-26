import { useEffect, useState } from 'react';
import { setProducerBudget } from '../services/mindConnect';

/**
 * The Producer's money control: a total, a per-render cap, and the deliberate opt-in to the
 * paid model.
 *
 * ONE MOUNT POINT, IN THE PRODUCER. This used to render in two unrelated places — behind a
 * Wallet toggle in the Inbox header, and again inline in the Storyboarder rail — which meant
 * the same form appeared twice with two different framings, and setting a budget in one left
 * the other looking untouched until its own poll caught up. Budget is a production-wide fact
 * the Producer owns, not a property of whichever agent happens to be about to spend it, so it
 * now lives in ProducerSurface and nowhere else. Agents that are gated on it point at the
 * Producer instead of growing their own copy of the control.
 */
const BudgetWidget = ({ token, budget, onUpdated }) => {
  const [total, setTotal] = useState(budget?.total ?? '');
  const [perRender, setPerRender] = useState(budget?.perRender ?? '');
  const [paidTier, setPaidTier] = useState(budget?.paidTier ?? false);
  const [saving, setSaving] = useState(false);

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
        // Never inferred from the money. A visitor who has not ticked this box is on the free
        // model no matter how large their budget is.
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
    <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Budget</p>
      <p className="mb-3 text-xs text-slate-500">
        {budget ? 'Your Producer is properly in the loop now.' : "The one thing that gets your Producer properly involved — total spend, a per-render cap, or both."}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Total
          <input
            type="number"
            min="0"
            step="0.01"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            placeholder="$"
            className="w-24 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500/50"
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
          disabled={saving || (total === '' && perRender === '')}
          className="chip px-3 py-1.5 text-xs font-semibold text-purple-300 hover:text-purple-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? 'Saving…' : budget ? 'Update' : 'Set budget'}
        </button>
      </div>

      {/* The model choice, separate from the money and off by default.
          The free storyboarder is not a degraded toy — on the same test films it matched the paid
          one on screen-position accuracy — so paid is a different trade-off rather than an
          upgrade, and it gets its own deliberate click instead of arriving silently with a
          budget. Needs a total, because spending real money with no ceiling is the exact thing
          the budget exists to prevent. */}
      <label className="mt-3 flex items-start gap-2 border-t border-white/5 pt-3 text-xs text-slate-400">
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
              ? 'Set a total budget first — paid generation always runs under a ceiling.'
              : 'Runs the storyboard on GPT-5.6-Sol, about $0.26 a scene, and allows longer scenes. Leave this off and it stays free.'}
          </span>
        </span>
      </label>
    </form>
  );
};

export default BudgetWidget;
