import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, Cpu, Activity, Terminal, AlertTriangle } from 'lucide-react';
import HudCard from './HudCard';
import RevealText, { RevealOnce } from './RevealText';
import { cn } from '../../lib/cn';

// One card for every agent whose thinking the user is allowed to read.
//
// The card is the same DOM node from the moment the agent starts until the user closes it.
// It streams live, then auto-folds when the agent finishes. Re-opening shows clean, settled
// text — no permanent matrix glitch.

const PHASE_LABEL = {
  looking: 'reading the artwork',
  watching: 'watching its film',
  formalising: 'writing it up',
  drafting: 'thinking the film through',
};

const StatusDot = ({ status }) => (
  <span className="relative flex h-2 w-2">
    {status === 'live' && (
      <span className="absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75 animate-ping" />
    )}
    <span
      className={cn(
        'relative inline-flex h-2 w-2 rounded-full',
        status === 'live' && 'bg-purple-500',
        status === 'done' && 'bg-emerald-400',
        status === 'failed' && 'bg-amber-400',
      )}
    />
  </span>
);

const Header = ({ status, phaseName, label, isLive, isCompiling }) => (
  <>
    <div className="flex items-center gap-2 min-w-0">
      <ChevronRight
        className={cn(
          'h-3.5 w-3.5 shrink-0 text-purple-300 transition-transform duration-200 group-open:rotate-90',
        )}
      />
      <StatusDot status={status} />
      <span className="truncate font-semibold text-purple-300">{label}</span>
      {phaseName && (
        <span className="hidden shrink-0 font-normal text-slate-500 sm:inline">· {phaseName}</span>
      )}
    </div>
    <div className="flex items-center gap-1.5 text-slate-500">
      <Terminal className={cn('h-3.5 w-3.5', isLive && 'animate-pulse')} />
      <span>{isLive ? (isCompiling ? 'COMPILING' : 'LIVE STREAM') : 'LOG'}</span>
    </div>
  </>
);

/**
 * @param label       card title, e.g. "Casting Director · piece name"
 * @param phase       agent phase key
 * @param status      'live' | 'done' | 'failed'
 * @param reasoning   the agent's internal reasoning stream
 * @param content     the agent's outward content stream
 * @param compiling   true when the agent is working but has no token stream
 * @param children    settled summary shown inside the card
 * @param className
 */
const AgentThought = ({
  label,
  phase,
  status = 'live',
  reasoning,
  content,
  compiling = false,
  children,
  className,
}) => {
  const phaseName = PHASE_LABEL[phase] ?? phase;
  const isLive = status === 'live';
  const hasThought = Boolean(reasoning?.trim() || content?.trim());
  const isCompiling = compiling && !hasThought;

  // Controlled open state so we can auto-fold on settle without remounting the card.
  const [open, setOpen] = useState(isLive);
  const wasLive = useRef(isLive);

  // Live cards stay open.
  useEffect(() => {
    if (isLive) setOpen(true);
  }, [isLive]);

  // Fold once when the agent finishes.
  useEffect(() => {
    if (wasLive.current && !isLive) {
      setOpen(false);
    }
    wasLive.current = isLive;
  }, [isLive]);

  const handleToggle = (event) => {
    if (isLive) {
      // Ignore user attempts to close a live card; the stream must stay visible.
      return;
    }
    setOpen(event.target.open);
  };

  const summary = (
    <Header
      status={status}
      phaseName={phaseName}
      label={label}
      isLive={isLive}
      isCompiling={isCompiling}
    />
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={className}
    >
      <HudCard summary={summary} open={open} onToggle={handleToggle}>
        <div className="space-y-3">
          {isLive ? (
            <>
              {reasoning?.trim() && (
                <div className="rounded-lg border border-purple-500/10 bg-purple-950/10 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-purple-400/80">
                    <Cpu className="h-3 w-3 shrink-0" />
                    <span>Thinking Process</span>
                  </div>
                  <div className="scrollbar-subtle max-h-48 overflow-y-auto text-xs leading-relaxed text-purple-200/60">
                    <RevealText text={reasoning} settling />
                  </div>
                </div>
              )}

              {content?.trim() && (
                <div className="rounded-lg border border-white/5 bg-white/[0.01] p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-slate-500">
                    <Activity className="h-3 w-3 shrink-0 animate-pulse text-purple-400" />
                    <span>Output</span>
                  </div>
                  <div className="text-sm leading-relaxed text-slate-200">
                    <RevealText text={content} settling />
                  </div>
                </div>
              )}

              {isCompiling && (
                <div className="rounded-lg border border-white/5 bg-white/[0.01] p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-slate-500">
                    <Activity className="h-3 w-3 shrink-0 animate-pulse text-purple-400" />
                    <span>Working</span>
                  </div>
                  <div className="text-sm leading-relaxed text-slate-300">
                    <RevealText text="" settling placeholder />
                  </div>
                </div>
              )}

              {!reasoning?.trim() && !content?.trim() && !isCompiling && (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-purple-500" />
                  <span>Establishing connection…</span>
                </div>
              )}
            </>
          ) : (
            <>
              {children}

              {status === 'failed' && !hasThought && (
                <div className="flex items-start gap-2 text-xs text-amber-200/90">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>This piece could not be read.</span>
                </div>
              )}

              {hasThought && (
                <div className="rounded-lg border border-purple-500/10 bg-purple-950/10 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-purple-400/80">
                    <Cpu className="h-3 w-3 shrink-0" />
                    <span>Thinking</span>
                  </div>
                  {reasoning?.trim() && (
                    <div className="scrollbar-subtle max-h-64 overflow-y-auto text-xs leading-relaxed text-purple-200/60">
                      <RevealOnce text={reasoning} />
                    </div>
                  )}
                  {content?.trim() && (
                    <div
                      className={cn(
                        'scrollbar-subtle max-h-64 overflow-y-auto text-sm leading-relaxed text-slate-300',
                        reasoning?.trim() && 'mt-3',
                      )}
                    >
                      <RevealOnce text={content} />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </HudCard>
    </motion.div>
  );
};

export default AgentThought;
