import { useEffect } from 'react';
import { Clapperboard, Clock, Loader2 } from 'lucide-react';
import CanvasPanel from './CanvasPanel';
import { BudgetWidget } from '../../ProducerInbox';
import { useMindChatContext } from '../../../context/mindChat';
import { useMindStatusBadge } from '../../../hooks/useMindStatusBadge';
import { cn } from '../../../lib/cn';

import { STAGE_LABEL } from '../../../hooks/useStoryboarder';

/**
 * Trigger + status rail for the Storyboarder.
 *
 * ROUND 8: the whole film is written in ONE call, which takes three to five minutes, so what this
 * rail says BEFORE the click matters as much as what it says during. Adam's rule: cost and time
 * are sibling facts and a visitor decides on both at once, so they appear together, up front,
 * along with the model that will actually do the work. Nobody should discover the tier from the
 * bill afterwards.
 *
 * Blocking is still free on the Zero Budget tier — the BudgetWidget below is an offer, not a gate — but
 * it is no longer free unconditionally, which is why the estimate is stated rather than implied.
 */
const StoryboarderPanel = ({ spec, cast, storyboarder, collapsed, onCollapse, onExpand }) => {
  const { session } = useMindChatContext();
  const token = session?.token;
  const badge = useMindStatusBadge({ token, active: Boolean(token) });
  const budget = badge?.budget;

  const { frames, phase, running, error, spend, plan, loadPlan, stageLabel, elapsedSeconds } = storyboarder ?? {};
  const nudgeFrame = (frames ?? []).find((f) => f.regenCount === 3);

  // The tier decision is fetched as soon as there is a spec to price, and again whenever the
  // budget changes — so the estimate on the button is the one the run will actually use, not a
  // stale reading from before the visitor ticked the paid box.
  const beatCount = spec?.beats?.length ?? 0;
  useEffect(() => {
    if (token && beatCount) loadPlan?.({ token, beatCount });
  }, [token, beatCount, budget?.total, budget?.paidTier, loadPlan]);

  const send = () => {
    if (!spec || !cast?.length || !token) return;
    storyboarder.run({ spec, cast, token });
  };

  if (!spec) {
    return (
      <CanvasPanel title="Storyboarder" icon={Clapperboard} collapsed={collapsed} onCollapse={onCollapse} onExpand={onExpand}>
        <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
            <Clapperboard className="h-5 w-5" />
          </span>
          <p className="mx-auto max-w-xs text-xs leading-relaxed text-slate-500">
            Once the Screenwriter finishes a shot spec, send it here to block it into a shot-by-shot technical spec.
          </p>
        </div>
      </CanvasPanel>
    );
  }

  if (!token) {
    return (
      <CanvasPanel title="Storyboarder" icon={Clapperboard} collapsed={collapsed} onCollapse={onCollapse} onExpand={onExpand}>
        <p className="py-6 text-center text-xs text-slate-500">Connect your Mind to enable the Storyboarder.</p>
      </CanvasPanel>
    );
  }

  return (
    <CanvasPanel title="Storyboarder" icon={Clapperboard} collapsed={collapsed} onCollapse={onCollapse} onExpand={onExpand}>
      <div className="space-y-3">
        {!frames?.length && !running && (
          <>
            <button
              type="button"
              onClick={send}
              className="sticker sticker-hover w-full rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500"
            >
              Send to Storyboarder
            </button>
            {plan && (
              <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-wider text-slate-500">
                <span className={plan.tier === 'paid' ? 'text-amber-300' : 'text-emerald-300'}>{plan.label}</span>
                <span className="text-slate-700">·</span>
                <span>{plan.estimateUsd > 0 ? `~$${plan.estimateUsd.toFixed(2)}` : 'no cost'}</span>
                <span className="text-slate-700">·</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />~{Math.round(plan.estimateSeconds / 60)}–{Math.round(plan.estimateSeconds / 60) + 2} min
                </span>
              </p>
            )}
            {plan?.overCapCopy && (
              <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-amber-200">
                {plan.overCapCopy}
              </p>
            )}
            {plan?.downgraded && (
              <p className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-[11px] leading-relaxed text-sky-200">
                {plan.downgradeReason}
              </p>
            )}
          </>
        )}

        {!budget && (
          <p className="text-[10px] leading-relaxed text-slate-600">
            Blocking on Zero Budget costs nothing. Set a budget below to unlock full-quality generation, or to try an actual sketch preview for a frame later — those spend real money.
          </p>
        )}
        {!budget && <BudgetWidget token={token} budget={budget} onUpdated={() => {}} />}

        {running && (
          <div className="space-y-1 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-400">
            <p className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400" />
              {stageLabel ?? STAGE_LABEL[phase] ?? 'Working…'}
            </p>
            {/* Proof of life. The number comes from the worker's own heartbeat rather than a
                client-side timer, so it reports the call that is actually in flight. */}
            <p className="pl-6 font-mono text-[10px] uppercase tracking-wider text-slate-600">
              {elapsedSeconds > 0 ? `${elapsedSeconds}s · still working` : 'starting'}
            </p>
          </div>
        )}

        {error && <p className="text-xs text-amber-300">{error}</p>}

        {spend && (
          <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
            <p className="flex items-center justify-between text-slate-400">
              <span>Production spend</span>
              <span className={cn('font-semibold', budget?.total != null && spend.totalSpent / budget.total >= 0.8 ? 'text-amber-300' : 'text-white')}>
                ${spend.totalSpent.toFixed(2)}{budget?.total != null ? ` / $${budget.total}` : ''}
              </span>
            </p>
          </div>
        )}

        {nudgeFrame && (
          <p className="rounded-xl bg-purple-400/10 p-3 text-xs leading-relaxed text-purple-200">
            You&rsquo;ve regenerated beat {nudgeFrame.beatIndex + 1}&rsquo;s sketch 3 times — want help refining the prompt, or is this exploration?
          </p>
        )}

        {frames?.length > 0 && (
          <p className="text-[10px] uppercase tracking-widest text-slate-600">
            {frames.length} beat{frames.length === 1 ? '' : 's'} blocked — sketch previews are opt-in, per frame.
          </p>
        )}
      </div>
    </CanvasPanel>
  );
};

export default StoryboarderPanel;
