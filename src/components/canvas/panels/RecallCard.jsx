import { useState } from 'react';
import { Brain, Check, ChevronDown, Loader2, TriangleAlert } from 'lucide-react';

import { cn } from '../../../lib/cn';

/**
 * The memory check. The Mind is asked what it remembers producing; its answer is laid beside
 * the record, film by film.
 *
 * WHY THE RECORD IS NEVER CHANGED BY THIS. The Mind's memory is a conversation, and a
 * conversation can be pruned. What it recalls is a cross-check on the record, and the interesting
 * result is the disagreement either way: a film the Mind has forgotten, or one it names that the
 * record does not have. Both are shown; neither is "fixed".
 */

const elapsed = (since) => {
  const seconds = Math.max(0, Math.round((Date.now() - since) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const RecallCard = ({ recall, mindName, className }) => {
  const [showReply, setShowReply] = useState(false);
  if (!recall) return null;
  const { status, askedAt, result, error, ask, reset } = recall;
  const audit = result?.audit ?? null;
  const name = mindName || 'your Mind';

  const busy = status === 'asking' || status === 'waiting';

  return (
    <div
      className={cn(
        'rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-left',
        audit && (audit.agrees ? 'border-emerald-500/30' : 'border-amber-500/30'),
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Brain className="h-3.5 w-3.5 shrink-0 text-purple-400" />
          <p className="truncate font-mono text-[9px] uppercase tracking-widest text-slate-500">
            Memory check
          </p>
        </div>
        {status === 'idle' || status === 'error' || status === 'timeout' ? (
          <button
            type="button"
            onClick={ask}
            className="chip shrink-0 px-2.5 py-1 text-[10px] font-semibold text-purple-300 hover:text-purple-200"
          >
            Ask {name} what it remembers
          </button>
        ) : (
          <button
            type="button"
            onClick={reset}
            className="shrink-0 text-[10px] text-slate-500 transition-colors hover:text-white"
          >
            {status === 'done' ? 'Ask again' : 'Cancel'}
          </button>
        )}
      </div>

      {status === 'idle' && (
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          {name} keeps its own record of every take in its conversation memory. Ask it to recite
          the filmography from memory alone, and the answer is checked against the record here.
        </p>
      )}

      {busy && (
        <p className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          {status === 'asking' ? 'Asking…' : `Waiting for ${name} to answer from memory · ${elapsed(askedAt)}`}
        </p>
      )}

      {status === 'timeout' && (
        <p className="mt-1.5 text-[11px] text-amber-300/90">
          No answer yet. The question is in {name}&apos;s inbox; it will reply in its own time.
        </p>
      )}
      {status === 'error' && <p className="mt-1.5 text-[11px] text-rose-300/90">{error}</p>}

      {audit && (
        <div className="mt-2 space-y-1.5">
          <p className={cn('text-[11px] font-semibold', audit.agrees ? 'text-emerald-300' : 'text-amber-300')}>
            {audit.recordCount === 0 && audit.claimedNothing
              ? `${name} reports nothing produced — and the record agrees.`
              : `${name} recalled ${audit.recalledCount} of ${audit.recordCount} film${audit.recordCount === 1 ? '' : 's'} on record` +
                (audit.unknown.length ? `, and named ${audit.unknown.length} the record does not have.` : '.')}
          </p>
          <ul className="space-y-1">
            {audit.rows.map((row) => (
              <li
                key={row.filmId}
                className="flex items-center gap-2 rounded-lg border border-white/5 bg-black/30 px-2 py-1 text-[11px]"
              >
                {row.recalled ? (
                  <Check className="h-3 w-3 shrink-0 text-emerald-400" />
                ) : (
                  <TriangleAlert className="h-3 w-3 shrink-0 text-amber-400" />
                )}
                <span className="min-w-0 flex-1 truncate text-slate-300">
                  {row.logline ?? `Film ${row.filmId}`}
                </span>
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-slate-600">
                  {row.recalled ? `recalled by ${row.matchedBy.join(', ')}` : 'on record, not recalled'}
                </span>
              </li>
            ))}
            {audit.unknown.map((id) => (
              <li
                key={id}
                className="flex items-center gap-2 rounded-lg border border-white/5 bg-black/30 px-2 py-1 text-[11px]"
              >
                <TriangleAlert className="h-3 w-3 shrink-0 text-amber-400" />
                <span className="min-w-0 flex-1 truncate font-mono text-slate-300">{id}</span>
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-slate-600">
                  recalled, not on record
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setShowReply((on) => !on)}
            className="flex items-center gap-1 text-[10px] text-slate-500 transition-colors hover:text-slate-300"
          >
            <ChevronDown className={cn('h-3 w-3 transition-transform', showReply && 'rotate-180')} />
            {showReply ? 'Hide' : 'Read'} what {name} said
          </button>
          {showReply && (
            <pre className="scrollbar-subtle max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-slate-400">
              {audit.text}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

export default RecallCard;
