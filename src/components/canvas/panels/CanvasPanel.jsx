import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/cn';

/**
 * Shared chrome for every zone in the FCP-style neural canvas.
 *
 * Each panel gets a small HUD header with a collapse/expand action. The panel body is
 * scrollable by default and fills the space allocated by react-resizable-panels.
 */
const CanvasPanel = ({
  title,
  icon: Icon,
  children,
  className,
  bodyClassName,
  collapsed = false,
  onCollapse,
  onExpand,
  headerAction,
}) => (
  <div
    className={cn(
      'flex h-full flex-col overflow-hidden bg-slate-950/40',
      collapsed && 'items-center justify-center',
      className,
    )}
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
          <div className="flex items-center gap-1">
            {headerAction}
            {onCollapse && (
              <button
                type="button"
                onClick={onCollapse}
                aria-label={`Collapse ${title}`}
                className="rounded p-1 text-slate-600 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className={cn('scrollbar-subtle min-h-0 flex-1 overflow-y-auto p-3', bodyClassName)}>
          {children}
        </div>
      </>
    )}
    {collapsed && onExpand && (
      <button
        type="button"
        onClick={onExpand}
        aria-label={`Expand ${title}`}
        className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-600 transition-colors hover:bg-white/5 hover:text-white"
      >
        {Icon && <Icon className="h-4 w-4 text-purple-400" />}
        <span className="rotate-180 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.2em] [writing-mode:vertical-rl]">
          {title}
        </span>
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    )}
  </div>
);

export default CanvasPanel;
