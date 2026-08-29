import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, Cpu, Activity, Terminal, AlertTriangle } from 'lucide-react';
import HudCard from './HudCard';
import RevealText, { RevealOnce } from './RevealText';
import { cn } from '../../lib/cn';

// One card for every agent whose thinking the user is allowed to read.
//
// The card is the same DOM node from the moment the agent starts until the user closes it.
// It streams live, then settles IN PLACE. Re-opening shows clean, settled text — no permanent
// matrix glitch.
//
// IT USED TO AUTO-FOLD THE INSTANT THE AGENT FINISHED, and it used to refuse to let you close
// a live card. Both are backwards. The moment a stream settles is the first moment the text is
// worth reading — it has stopped moving and stopped scrambling — and that was precisely the
// moment the card shut itself under the reader's cursor. Meanwhile the one card you might
// genuinely want out of the way, a long stream you have finished with, was the one nailed
// open. Now nothing folds itself and everything can be closed: the panel moves when the user
// moves it, and at no other time.

// Two vocabularies land here, and CastingLog falls back from one to the other: the server's
// PHASE, streamed as the agent works, and — for a piece with no stream at all, which is what a
// warm cache hit looks like — the client's STATUS. They used to collide on `watching`, so an
// unstarted piece announced that it was watching its film; the client's is now `casting`.
//
// Exported because useProductionPipeline names the same phases in the pipeline bar, and two
// hand-kept copies of this map would drift the first time a phase was renamed.
export const PHASE_LABEL = {
  // Server phases (worker/casting-director.js, worker/screenwriter.js).
  looking: 'reading the artwork',
  watching: 'watching its film',
  formalising: 'writing it up',
  drafting: 'thinking the film through',
  reviewing: 'checking the cast against the prompt',
  paying: 'paying asset creator',
  paid: 'paid asset creator',
  payfailed: 'payment failed',
  // Client statuses (src/hooks/useScreenwriter.js), seen only when nothing streamed.
  casting: 'reading the artwork',
  done: 'known already',
  failed: 'couldn’t be read',
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

const Header = ({ status, phaseName, label, isLive, isCompiling, phase, message }) => (
  <>
    <div className="flex items-center gap-2 min-w-0">
      <ChevronRight
        className={cn(
          'h-3.5 w-3.5 shrink-0 text-purple-300 transition-transform duration-200 group-open:rotate-90',
        )}
      />
      <StatusDot status={status} />
      <span className="truncate font-semibold text-purple-300">{label}</span>
      {/* Container query, not a viewport one. This card lives inside a panel the user can
          drag to any width, so `sm:` was answering a question nobody asked — how wide the
          BROWSER is — and hiding the phase name in a wide panel on a narrow laptop while
          showing it in a 200px panel on a 4K display. */}
      {phaseName && (
        <span className="hidden shrink-0 font-normal text-slate-500 @sm:inline">· {phaseName}</span>
      )}
      {phase === 'paid' && message && (
        <a
          href={message}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden shrink-0 text-xs text-blue-400 hover:text-blue-300 hover:underline @sm:inline"
          onClick={(e) => e.stopPropagation()}
        >
          · Tx: {message.split('/').pop().slice(0, 6)}...{message.split('/').pop().slice(-4)}
        </a>
      )}
      {phase === 'payfailed' && message && (
        <span className="hidden shrink-0 text-xs text-red-400 @sm:inline">· {message}</span>
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
  message,
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

  // Controlled open state. A card opens itself once, when its agent starts talking, and after
  // that it only ever moves because somebody clicked it.
  const [open, setOpen] = useState(isLive);
  const openedOnStart = useRef(isLive);

  // Open when a stream begins — but only the first time, so a card the reader has deliberately
  // closed does not spring back open on the next delta.
  useEffect(() => {
    if (isLive && !openedOnStart.current) {
      openedOnStart.current = true;
      setOpen(true);
    }
    if (!isLive) openedOnStart.current = false;
  }, [isLive]);



  // No settle handler. Settling is not an instruction to hide the result.
  const handleToggle = (event) => setOpen(event.target.open);

  const summary = (
    <Header
      status={status}
      phaseName={phaseName}
      label={label}
      isLive={isLive}
      isCompiling={isCompiling}
      phase={phase}
      message={message}
    />
  );

  return (
    // Fades in without sliding. The 10px y-offset this replaces nudged every card below it
    // downward for the length of the animation, which in a log that gains a card per cast
    // member meant the line you were reading crept away from you several times a minute.
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
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
                    <span>{phase === 'paying' ? 'Paying' : 'Working'}</span>
                  </div>
                  <div className="text-sm leading-relaxed text-slate-300">
                    {phase === 'paying' && message ? (
                      <span>{message}</span>
                    ) : (
                      <RevealText text="" settling placeholder />
                    )}
                  </div>
                </div>
              )}

              {!reasoning?.trim() && !content?.trim() && !isCompiling && (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-purple-500" />
                  <span>{phase === 'paying' && message ? message : 'Establishing connection…'}</span>
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
