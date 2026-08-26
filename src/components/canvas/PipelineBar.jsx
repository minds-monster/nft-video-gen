import { AlertTriangle, ChevronRight, Loader2, Send } from 'lucide-react';
import { STATE, formatElapsed } from '../../hooks/useProductionPipeline';
import { cn } from '../../lib/cn';

/**
 * The run, across the top, always.
 *
 * Cast → Read → Review → Write → Block. One chip per step, each saying what that agent is
 * doing right now and how long it has been doing it. The step holding the run pulses; a step
 * that failed goes amber HERE, whether or not the panel it belongs to is open, collapsed, or
 * scrolled a thousand pixels away — which is the whole point, since every error in this canvas
 * previously had exactly one mount point and vanished with its panel.
 *
 * Clicking a chip expands and scrolls to the panel that owns it, so the bar is navigation as
 * well as status: "what is happening" and "show me" are the same gesture.
 *
 * The Block chip is also the run's primary CTA. It used to be a button inside a 100px panel in
 * the fourth slot of a five-panel rail, with nothing anywhere pointing at it — the single most
 * important action in the product, hidden in the least prominent square inch of it.
 */

const DOT = {
  [STATE.IDLE]: 'bg-slate-700',
  [STATE.READY]: 'bg-purple-400',
  [STATE.RUNNING]: 'bg-purple-500',
  [STATE.DONE]: 'bg-emerald-400',
  [STATE.FAILED]: 'bg-amber-400',
};

const LABEL = {
  [STATE.IDLE]: 'text-slate-600',
  [STATE.READY]: 'text-purple-200',
  [STATE.RUNNING]: 'text-white',
  [STATE.DONE]: 'text-slate-400',
  [STATE.FAILED]: 'text-amber-300',
};

const Dot = ({ state }) => (
  <span className="relative flex h-1.5 w-1.5 shrink-0">
    {state === STATE.RUNNING && (
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
    )}
    <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', DOT[state] ?? DOT.idle)} />
  </span>
);

/** One step.
 *
 * ALWAYS CLICKABLE, including while idle. A step that has not run yet still has a panel, and
 * "where does the Screenwriter live?" is exactly the question somebody has on their first pass
 * — so every chip is a way to go and look, not just a readout. An idle chip is drawn muted, but
 * it is not disabled: the bar is the map as well as the status. */
const StepChip = ({ step, onFocus }) => {
  const elapsed = formatElapsed(step.elapsed);

  return (
    <button
      type="button"
      onClick={() => onFocus(step.panel)}
      title={step.error ?? `${step.label} — ${step.detail}`}
      className={cn(
        'group flex min-w-0 shrink items-center gap-1.5 rounded-full px-2 py-1 transition-colors hover:bg-white/10',
        step.state === STATE.FAILED && 'bg-amber-400/10',
        step.state === STATE.RUNNING && 'bg-white/5',
      )}
    >
      {step.state === STATE.FAILED ? (
        <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
      ) : (
        <Dot state={step.state} />
      )}
      <span
        className={cn(
          'shrink-0 font-mono text-[10px] uppercase tracking-[0.2em]',
          LABEL[step.state] ?? LABEL.idle,
        )}
      >
        {step.label}
      </span>
      {/* The detail is the first thing to go when the bar runs out of room — the step name
          and its state are what must survive at any width. */}
      <span className="hidden min-w-0 truncate text-[10px] text-slate-600 lg:inline">
        {step.detail}
      </span>
      {elapsed && (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-purple-300/80">
          {elapsed}
        </span>
      )}
    </button>
  );
};

/** The Block step when it is ready to fire: a real button carrying tier, cost and time. */
const BlockAction = ({ action, onFocus, panel }) => (
  <div className="flex min-w-0 items-center gap-2">
    <button
      type="button"
      onClick={action.disabled ? () => onFocus(panel) : action.onClick}
      title={action.reason ?? action.hint ?? undefined}
      className={cn(
        'sticker sticker-hover flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors',
        action.disabled
          ? 'bg-purple-600/30 text-white/60'
          : 'bg-purple-600 text-white hover:bg-purple-500',
      )}
    >
      <Send className="h-3 w-3" />
      {action.label}
    </button>
    {/* Cost and time are siblings and a visitor decides on both at once, so they ride with
        the button rather than living in a panel the visitor has to go and find. */}
    {action.hint && !action.disabled && (
      <span className="hidden min-w-0 truncate text-[10px] text-slate-500 xl:inline">
        {action.hint}
      </span>
    )}
    {action.reason && (
      <span className="hidden min-w-0 truncate text-[10px] text-amber-300/80 xl:inline">
        {action.reason}
      </span>
    )}
  </div>
);

const PipelineBar = ({ steps, onFocusPanel, composing, onReset }) => {
  const blockStep = steps[steps.length - 1];

  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/10 px-3 py-1.5 md:px-5">
      <span className="mr-1 hidden shrink-0 items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.25em] text-slate-700 xl:flex">
        {composing ? 'Neural canvas' : 'Production'}
      </span>

      {steps.map((step, index) => (
        <div key={step.id} className="flex min-w-0 items-center">
          {index > 0 && (
            <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 text-slate-800" />
          )}
          {step.action ? (
            <BlockAction action={step.action} onFocus={onFocusPanel} panel={step.panel} />
          ) : (
            <StepChip step={step} onFocus={onFocusPanel} />
          )}
        </div>
      ))}

      {blockStep?.state === STATE.RUNNING && (
        <Loader2 className="ml-1 hidden h-3 w-3 shrink-0 animate-spin text-purple-400 md:block" />
      )}

      <button
        type="button"
        onClick={onReset}
        title="Reset every panel to its default size"
        className="ml-auto hidden shrink-0 rounded px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-slate-700 transition-colors hover:bg-white/10 hover:text-slate-300 md:block"
      >
        Reset layout
      </button>
    </div>
  );
};

export default PipelineBar;
