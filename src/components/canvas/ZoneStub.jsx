import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * What a collapsed side zone leaves behind.
 *
 * THE BUG THIS EXISTS TO KILL: both outer zones were `collapsible` with no `collapsedSize`,
 * which in react-resizable-panels means zero. Drag the right rail past its minimum and the
 * entire inspector column — Casting Director, Writers' room, Screenplay, Storyboarder,
 * Producer — went to nothing, with no stub, no toggle and no menu item to bring it back. The
 * only route home was a 4px transparent separator pinned to the edge of the screen.
 *
 * So a collapsed zone is now a 44px rail that says what it is and whether anything inside it
 * is working. It is the same affordance a collapsed panel gets, turned on its side.
 */

/** Matches the `collapsedSize` PromptCanvas passes to the two outer Panels. */
export const ZONE_STUB_WIDTH = 44;

const ZoneStub = ({ label, icon: Icon, side = 'left', running = false, failed = false, onExpand }) => {
  const Chevron = side === 'left' ? ChevronRight : ChevronLeft;

  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={`Expand ${label}`}
      aria-expanded="false"
      title={`Expand ${label}`}
      className="group flex h-full w-full flex-col items-center gap-3 border-white/10 bg-slate-950/60 py-3 text-slate-600 transition-colors hover:bg-white/5 hover:text-white"
    >
      <Chevron className="h-3.5 w-3.5 shrink-0" />

      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-purple-400" />}

      {/* Rotated rather than one-letter-per-line: a vertical stack of capitals is slower to
          read than the same word turned ninety degrees, and this rail is a wayfinding label,
          not a decoration. */}
      <span
        className="min-h-0 flex-1 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.25em]"
        style={{ writingMode: 'vertical-rl' }}
      >
        {label}
      </span>

      {(running || failed) && (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          {running && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
          )}
          <span
            className={cn(
              'relative inline-flex h-1.5 w-1.5 rounded-full',
              failed ? 'bg-amber-400' : 'bg-purple-500',
            )}
          />
        </span>
      )}
    </button>
  );
};

export default ZoneStub;
