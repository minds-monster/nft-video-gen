import { cn } from '../../lib/cn';

// Shared HUD surface used by agent logs, spec folds, and prompt panels.
//
// Two modes:
//  - Static: `children` only. Renders a panel with corner brackets and scanline.
//  - Fold:   pass `summary` and the card becomes a native <details> fold with the
//            same chrome. Use `open`/`onToggle` for controlled folds, or `defaultOpen`
//            for uncontrolled ones.

const Corners = () => (
  <>
    <div className="pointer-events-none absolute left-2 top-2 h-2 w-2 border-l border-t border-purple-500/40" />
    <div className="pointer-events-none absolute right-2 top-2 h-2 w-2 border-r border-t border-purple-500/40" />
    <div className="pointer-events-none absolute bottom-2 left-2 h-2 w-2 border-b border-l border-purple-500/40" />
    <div className="pointer-events-none absolute bottom-2 right-2 h-2 w-2 border-b border-r border-purple-500/40" />
  </>
);

const Scanline = () => (
  <div className="pointer-events-none absolute inset-0 rounded-xl bg-[linear-gradient(to_bottom,rgba(255,255,255,0),rgba(255,255,255,0)_50%,rgba(0,0,0,0.3)_50%,rgba(0,0,0,0.3))] bg-[length:100%_4px] opacity-20" />
);

/**
 * @param summary    React node rendered as the <summary>; if omitted, the card is static.
 * @param open       Controlled open state (for controlled folds).
 * @param defaultOpen Initial open state for uncontrolled folds.
 * @param onToggle   (e) => void; receives the native toggle event.
 */
const HudCard = ({
  children,
  className,
  summary,
  open,
  defaultOpen,
  onToggle,
}) => {
  const body = summary ? (
    <details
      className="group"
      open={open}
      defaultOpen={defaultOpen}
      onToggle={onToggle}
    >
      <summary className="relative z-10 flex cursor-pointer list-none items-center justify-between p-4 text-[10px] uppercase tracking-widest">
        {summary}
      </summary>
      <div className="relative z-10 border-t border-white/5 p-4">{children}</div>
    </details>
  ) : (
    <div className="relative z-10 p-4">{children}</div>
  );

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-purple-500/20 bg-black/40 text-left shadow-[0_0_20px_rgba(168,85,247,0.05)] backdrop-blur-md',
        className,
      )}
    >
      <Scanline />
      <Corners />
      {body}
    </div>
  );
};

export default HudCard;
