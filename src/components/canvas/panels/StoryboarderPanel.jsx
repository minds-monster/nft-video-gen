import { Clapperboard, Clock, Loader2 } from 'lucide-react';
import CanvasPanel from './CanvasPanel';
import { BudgetWidget } from '../../ProducerInbox';
import { cn } from '../../../lib/cn';

import { STAGE_LABEL } from '../../../hooks/useStoryboarder';

/**
 * Trigger + status rail for the Storyboarder.
 *
 * The whole film is written in ONE call, which takes three to five minutes, so what this rail
 * says BEFORE the click matters as much as what it says during. Adam's rule: cost and time are
 * sibling facts and a visitor decides on both at once, so they appear together, up front, along
 * with the model that will actually do the work. Nobody should discover the tier from the bill
 * afterwards.
 *
 * Blocking is still free on the Zero Budget tier — the BudgetWidget below is an offer, not a
 * gate — but it is no longer free unconditionally, which is why the estimate is stated rather
 * than implied.
 *
 * THE TIER AND CAP DECISIONS ARE NOT MADE HERE ANY MORE. They live in useProductionPipeline,
 * because the pipeline bar's Block button and this panel's button are the same action and were
 * pricing it from two independent reads that could disagree — and the bar is the one most
 * people will actually click, since this panel spent its life as a 100px slot in the fourth
 * position of a five-panel rail with nothing anywhere pointing at it.
 */
const StoryboarderPanel = ({
  id,
  spec,
  cast,
  storyboarder,
  pipeline,
  token,
  budget,
  collapsed,
  onToggle,
  status,
}) => {
  const { frames, phase, running, error, spend, stageLabel, elapsedSeconds } = storyboarder ?? {};
  const { plan, capped, capViolations } = pipeline ?? {};
  const nudgeFrame = (frames ?? []).find((f) => f.regenCount === 3);

  const send = () => {
    if (!spec || !cast?.length || !token || capped) return;
    storyboarder.run({ spec, cast, token });
  };

  const shell = (children) => (
    <CanvasPanel
      id={id}
      title="Storyboarder"
      icon={Clapperboard}
      collapsed={collapsed}
      onToggle={onToggle}
      status={status}
    >
      {children}
    </CanvasPanel>
  );

  if (!spec) {
    return shell(
      <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
          <Clapperboard className="h-5 w-5" />
        </span>
        <p className="mx-auto max-w-xs text-xs leading-relaxed text-slate-500">
          Once the Screenwriter finishes a shot spec, send it here to block it into a
          shot-by-shot technical spec.
        </p>
      </div>,
    );
  }

  if (!token) {
    return shell(
      <p className="py-6 text-center text-xs text-slate-500">
        Connect your Mind to enable the Storyboarder.
      </p>,
    );
  }

  return shell(
    <div className="space-y-3">
      {!frames?.length && !running && (
        <>
          <button
            type="button"
            onClick={send}
            disabled={capped}
            title={capped ? 'This scene is too long for the current tier' : undefined}
            className="sticker sticker-hover w-full rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-purple-600/40"
          >
            {capped ? 'Scene exceeds Zero Budget limits' : 'Send to Storyboarder'}
          </button>
          {capped && (
            <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-amber-200">
              {(capViolations ?? []).map((v) => v.detail).join(' ')}
              {' Set a budget to unlock the full scene, or shorten the prompt.'}
            </p>
          )}
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
          {!capped && plan?.overCapCopy && (
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
          Blocking on Zero Budget costs nothing. Set a budget below to unlock full-quality
          generation, or to try an actual sketch preview for a frame later — those spend real
          money.
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
          You&rsquo;ve regenerated beat {nudgeFrame.beatIndex + 1}&rsquo;s sketch 3 times — want
          help refining the prompt, or is this exploration?
        </p>
      )}

      {frames?.length > 0 && (
        <p className="text-[10px] uppercase tracking-widest text-slate-600">
          {frames.length} beat{frames.length === 1 ? '' : 's'} blocked — sketch previews are
          opt-in, per frame.
        </p>
      )}
    </div>,
  );
};

export default StoryboarderPanel;
