import { useState } from 'react';
import { Clapperboard, Download, FileText } from 'lucide-react';

import CanvasPanel from './CanvasPanel';
import { cn } from '../../../lib/cn';

/**
 * The takes. Every render this production has paid for, in the order they were shot.
 *
 * WHY "DAILIES". It is what the day's raw footage is called on a real set, and it is honest about
 * what this is: not a finished film, but everything shot so far, including the ones that did not
 * work. A failed take stays in the list with what it cost, because the alternative — hiding it —
 * is how a visitor comes to ask "why did my budget run out faster than the films I can see?"
 *
 * EVERY TAKE CARRIES ITS OWN REQUEST. scripts/gen-video.mjs has written the exact request beside
 * every result since the hero was made, for a reason it states in one line: "a good render is
 * worthless if we can't repeat it." The script is one disclosure away on every card here.
 */

const money = (value) => (value == null ? null : `$${Number(value).toFixed(2)}`);

const duration = (seconds) => {
  if (!seconds) return null;
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const STATUS = {
  ready: { label: 'ready', className: 'text-emerald-300' },
  failed: { label: 'failed', className: 'text-amber-300' },
  unsettled: { label: 'unsettled', className: 'text-amber-300' },
  pending: { label: 'running', className: 'text-purple-300' },
};

const Take = ({ take, index }) => {
  const [showScript, setShowScript] = useState(false);
  const state = STATUS[take.status] ?? STATUS.pending;

  return (
    <article className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-3">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-widest text-slate-600">Take {index + 1}</p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-400">
            {take.params?.resolution} · {take.params?.duration}s
            {take.seconds ? ` · shot in ${duration(take.seconds)}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn('font-mono text-[10px] uppercase tracking-wider', state.className)}>{state.label}</p>
          <p className="font-mono text-[11px] text-slate-300">{money(take.costUsd)}</p>
        </div>
      </header>

      {take.url ? (
        <video
          src={take.url}
          controls
          loop
          playsInline
          preload="metadata"
          className="mt-2 block w-full rounded-xl border border-white/10 bg-black/40"
        />
      ) : (
        <p className="mt-2 rounded-xl border border-white/10 bg-black/30 p-3 text-[11px] leading-relaxed text-slate-500">
          {take.reason ?? 'This take produced no film.'}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowScript((on) => !on)}
          className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[9px] uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-300"
        >
          <FileText className="h-3 w-3" />
          {showScript ? 'Hide request' : 'The request'}
        </button>
        {take.url && (
          <a
            href={take.url}
            download={`take-${index + 1}.mp4`}
            className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[9px] uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-300"
          >
            <Download className="h-3 w-3" />
            Save
          </a>
        )}
        {take.taskId && <span className="font-mono text-[9px] text-slate-700">task {take.taskId}</span>}
      </div>

      {showScript && (
        <pre className="scrollbar-subtle mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-slate-400">
          {take.script?.text ?? 'No script recorded for this take.'}
        </pre>
      )}
    </article>
  );
};

const DailiesPanel = ({ id, director, status, tabs }) => {
  const takes = director?.finalTakes ?? [];
  const envelope = director?.envelope ?? null;

  const header = (
    <div className="flex items-center gap-2">
      {tabs}
      {envelope && (
        <span className="font-mono text-[9px] uppercase tracking-wider text-slate-600">
          {money(envelope.spentUsd)}
          {envelope.allowanceUsd ? ` of ${money(envelope.allowanceUsd)}` : ''}
        </span>
      )}
    </div>
  );

  if (!takes.length) {
    return (
      <CanvasPanel id={id} title="Dailies" icon={Clapperboard} headerAction={header} status={status}>
        <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
            <Clapperboard className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">Nothing shot yet</p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
              Every take the Director shoots lands here, with what it cost and the exact request
              that produced it.
            </p>
          </div>
        </div>
      </CanvasPanel>
    );
  }

  return (
    <CanvasPanel
      id={id}
      title="Dailies"
      icon={Clapperboard}
      headerAction={header}
      status={status}
      bodyClassName="flex flex-col gap-3"
    >
      {takes.map((take, index) => (
        <Take key={take.takeId} take={take} index={index} />
      ))}
    </CanvasPanel>
  );
};

export default DailiesPanel;
