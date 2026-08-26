import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/cn';

/**
 * Shared chrome for every zone in the FCP-style neural canvas.
 *
 * COLLAPSE HAS ONE SOURCE OF TRUTH, and it is not this component. `collapsed` is read back
 * from react-resizable-panels' own `isCollapsed()` by the canvas, so a panel dragged below
 * its minimum and a panel closed by its chevron produce byte-identical UI. The previous
 * version kept a second, parallel React flag that only moved when the chevron was clicked —
 * so a drag-collapse left a full header and a scrollable body rendering inside a 35px box
 * with no expand affordance anywhere, which is a state you cannot get out of without
 * finding a 4px separator.
 *
 * A PANEL REPORTS ITS STATUS WHETHER IT IS OPEN OR SHUT. `status` renders in both the
 * header and the collapsed strip, because a collapsed panel with an agent working inside it
 * used to be completely silent — the single worst thing a status surface can do.
 */

/** Exact height of the collapsed strip, in pixels.
 *
 * Shared with PromptCanvas, which passes it to each collapsible Panel as `collapsedSize`, so
 * the strip always fits its own content precisely. Sizing this in percent is what made the
 * snap threshold a moving target — 10% of a five-panel rail is a different number every time
 * a sibling changes. */
export const PANEL_STRIP_HEIGHT = 34;

const TONE = {
  idle: 'bg-slate-700',
  running: 'bg-purple-500',
  done: 'bg-emerald-400',
  failed: 'bg-amber-400',
};

const StatusDot = ({ tone = 'idle' }) => (
  <span className="relative flex h-1.5 w-1.5 shrink-0">
    {tone === 'running' && (
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
    )}
    <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', TONE[tone] ?? TONE.idle)} />
  </span>
);

/** Dot plus short label, e.g. "3 of 5 read". Rendered in the header and in the strip. */
const Status = ({ status, className }) => {
  if (!status?.text && !status?.tone) return null;
  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider',
        status.tone === 'failed' ? 'text-amber-300' : 'text-slate-600',
        className,
      )}
      title={status.title || undefined}
    >
      <StatusDot tone={status.tone} />
      {status.text && <span className="truncate">{status.text}</span>}
    </span>
  );
};

const CanvasPanel = ({
  id,
  title,
  icon: Icon,
  children,
  className,
  bodyClassName,
  collapsed = false,
  onToggle,
  status,
  headerAction,
}) => (
  <div
    id={id}
    data-panel-collapsed={collapsed || undefined}
    className={cn('flex h-full flex-col overflow-hidden bg-slate-950/40', className)}
  >
    {!collapsed && (
      <>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {Icon && <Icon className="h-3 w-3 shrink-0 text-purple-400" />}
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">
              {title}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Status status={status} className="hidden md:flex" />
            {headerAction}
            {onToggle && (
              <button
                type="button"
                onClick={onToggle}
                aria-label={`Collapse ${title}`}
                aria-expanded="true"
                className="shrink-0 rounded p-1 text-slate-600 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div
          className={cn(
            'scrollbar-subtle @container min-h-0 flex-1 overflow-y-auto p-3',
            bodyClassName,
          )}
        >
          {children}
        </div>
      </>
    )}

    {/* A collapsed panel here is a short, full-width strip (stacked vertically with its
        siblings), not a narrow sidebar — so the expand affordance is a single horizontal
        row matching the expanded header's own layout, not rotated sidebar-style text.
        It carries the status, because a panel that has gone quiet is exactly the one whose
        progress you can no longer see any other way. */}
    {collapsed && onToggle && (
      <button
        type="button"
        onClick={onToggle}
        aria-label={`Expand ${title}`}
        aria-expanded="false"
        style={{ height: PANEL_STRIP_HEIGHT }}
        className="flex w-full shrink-0 items-center gap-2 px-3 text-slate-600 transition-colors hover:bg-white/5 hover:text-white"
      >
        {Icon && <Icon className="h-3 w-3 shrink-0 text-purple-400" />}
        <span className="shrink-0 truncate font-mono text-[10px] uppercase tracking-[0.25em]">
          {title}
        </span>
        <Status status={status} className="min-w-0" />
        <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0" />
      </button>
    )}
  </div>
);

export default CanvasPanel;
