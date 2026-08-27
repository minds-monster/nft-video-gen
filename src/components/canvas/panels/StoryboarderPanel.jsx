import { useState } from 'react';
import { ChevronDown, Clapperboard, Clock, Loader2 } from 'lucide-react';
import CanvasPanel from './CanvasPanel';
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
 * Blocking is still free on the Zero Budget tier, and it is no longer free unconditionally,
 * which is why the estimate is stated rather than implied.
 *
 * THE BUDGET FORM IS NOT HERE. It belongs to the Producer, which is the agent whose job is the
 * money; carrying a second copy of the control in the rail of the agent about to spend it meant
 * the same form existed twice, framed two different ways, each going stale until its own poll
 * caught up. What is left is the part that is genuinely this panel's business — the cost and
 * time of THIS run, and a pointer to the Producer when the tier is what is standing in the way.
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
  onOpenProducer,
}) => {
  const { frames, phase, running, error, spend, stageLabel, elapsedSeconds, events } = storyboarder ?? {};
  const { plan, capped, capViolations } = pipeline ?? {};
  const [showEvents, setShowEvents] = useState(false);
  const nudgeFrame = (frames ?? []).find((f) => f.regenCount === 3);

  const send = () => {
    if (!spec || !cast?.length || !token || capped) return;
    storyboarder.run({ spec, cast, token });
  };

  const shell = (children) => (
    <CanvasPanel
      id={id}
      // CanvasPanel renders `title` in the open header AND in the collapsed strip, so putting
      // Beta here covers both states — a collapsed panel is exactly where an unfinished feature
      // would otherwise lose its label.
      title="Storyboarder (Beta)"
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
          Optional. Once the Screenwriter finishes a shot spec you can block it into a
          shot-by-shot technical spec here — or skip it and let the Director shoot the
          screenplay directly.
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
          {/* THE OPT-IN, and the caveat comes BEFORE the button rather than under it.
              This is the last surface a visitor sees before committing several minutes, and the
              honest facts about that commitment are: it is slower than not doing it, and not
              doing it costs them nothing downstream. Round 11 measured the first (1.8-3x slower
              than shooting straight from the screenplay) and the pipeline has always been true
              about the second — the Director reads the screenplay, never the geometry.

              Deliberately not a pitch. The gains are real (better shot variety, framing that
              matches the geometry) but a visitor who wanted those went looking for this panel;
              a visitor who did not is owed the reason to walk away, up front. */}
          <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-amber-200/90">
            <span className="font-semibold">Beta.</span> Blocks every shot in 3D, and takes
            several minutes longer than shooting straight from the screenplay. The Director does
            not need it — this is for seeing the scene before you spend on it.
          </p>
          <button
            type="button"
            onClick={send}
            disabled={capped}
            title={capped ? 'This scene is too long for the current tier' : undefined}
            className="sticker sticker-hover w-full rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-purple-600/40"
          >
            {capped ? 'Scene exceeds Zero Budget limits' : 'Try the Storyboarder (Beta)'}
          </button>
          {capped && (
            <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-amber-200">
              {(capViolations ?? []).map((v) => v.detail).join(' ')}{' '}
              {onOpenProducer ? (
                <button
                  type="button"
                  onClick={onOpenProducer}
                  className="underline underline-offset-2 transition-colors hover:text-white"
                >
                  Set a budget in the Producer
                </button>
              ) : (
                'Set a budget in the Producer'
              )}{' '}
              to unlock the full scene, or shorten the prompt.
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

      {!budget && !frames?.length && !running && (
        <p className="text-[10px] leading-relaxed text-slate-600">
          Blocking on Zero Budget costs nothing.{' '}
          {onOpenProducer ? (
            <button
              type="button"
              onClick={onOpenProducer}
              className="text-purple-300 underline underline-offset-2 transition-colors hover:text-white"
            >
              Set a budget in the Producer
            </button>
          ) : (
            'Set a budget in the Producer'
          )}{' '}
          to unlock full-quality generation and per-frame sketch previews — those spend real
          money.
        </p>
      )}

      {running && (
        <div className="space-y-1 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-400">
          <p className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400" />
            {stageLabel ?? STAGE_LABEL[phase] ?? 'Working…'}
          </p>
          {/* Proof of life. The client-side timer keeps climbing even if the SSE stream is quiet,
              and the worker heartbeat corrects it if the two drift apart. */}
          <p className="pl-6 font-mono text-[10px] uppercase tracking-wider text-slate-600">
            {elapsedSeconds > 0 ? `${elapsedSeconds}s · still working` : 'starting'}
          </p>
        </div>
      )}

      {(running || error) && events?.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-2 text-[10px] text-slate-500">
          <button
            type="button"
            onClick={() => setShowEvents((on) => !on)}
            className="flex w-full items-center justify-between py-1 text-slate-400 hover:text-slate-300"
          >
            <span className="font-semibold uppercase tracking-wider">What is happening?</span>
            <ChevronDown className={cn('h-3 w-3 transition-transform', showEvents && 'rotate-180')} />
          </button>
          {showEvents && (
            <ul className="mt-1 space-y-1 font-mono leading-relaxed">
              {events.slice(-10).map((event, i) => (
                <li key={i} className="truncate">
                  <span className="text-slate-600">{event.type}</span>
                  {' '}
                  <span className="text-slate-500">
                    {event.type === 'reasoning'
                      ? String(event.data?.delta ?? '').slice(0, 60)
                      : JSON.stringify(event.data).slice(0, 80)}
                  </span>
                </li>
              ))}
            </ul>
          )}
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
