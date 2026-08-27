import { useState } from 'react';
import { ArrowLeft, Download, FileText } from 'lucide-react';

import { cn } from '../../../lib/cn';
import { ANSWER_TONE } from '../../../lib/takeTone';
import { VERDICTS } from '../../../../worker/screen-test.js';

/**
 * A take, played large. The Viewer's body when what is being viewed came out of the Director
 * rather than off-chain.
 *
 * EVERYTHING ABOUT THE TAKE IS HERE, not on the card that opened it. The request that produced
 * it, the button that saves it, and — for a screen test — the three answers. All three are things
 * you do after watching, so they belong beside the thing you watched, not beside its thumbnail.
 */

const money = (value) => (value == null ? null : `$${Number(value).toFixed(2)}`);

const duration = (seconds) => {
  if (!seconds) return null;
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const TakeView = ({ take, index, onJudge, onClear }) => {
  const [showScript, setShowScript] = useState(false);

  const isTest = take.kind === 'screen-test';
  const answered = take.verdict?.answer;
  const title = isTest ? (take.question ?? 'An unnamed test') : `Take ${index}`;

  return (
    <>
      <div className="relative mx-auto flex min-h-0 w-full max-w-full flex-1 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/40">
        <div className="relative max-h-full max-w-full" style={{ aspectRatio: '16/9' }}>
          {take.url ? (
            <video
              src={take.url}
              // Same reason as the NFT branch: the autoPlay attribute alone is unreliable, so
              // kick playback off once the media is actually ready.
              onCanPlay={(event) => event.currentTarget.play().catch(() => {})}
              controls
              autoPlay
              loop
              muted
              playsInline
              className="block h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center p-6 text-center text-xs leading-relaxed text-slate-500">
              {take.reason ?? 'This take produced no film.'}
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate-600">
              {isTest ? 'Screen test' : 'Daily'}
            </p>
            <h3
              className={cn(
                'mt-0.5 text-white',
                isTest
                  ? 'text-sm font-semibold leading-snug'
                  : 'truncate text-lg uppercase tracking-tight',
              )}
            >
              {title}
            </h3>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              {take.params?.resolution} · {take.params?.duration}s
              {take.seconds ? ` · shot in ${duration(take.seconds)}` : ''}
            </p>
          </div>
          <p className="shrink-0 font-mono text-sm text-slate-300">{money(take.costUsd)}</p>
        </div>

        {isTest && answered && (
          <p
            className={cn(
              'mt-2 rounded-xl border px-2 py-1.5 text-[11px] font-semibold',
              ANSWER_TONE[answered],
            )}
          >
            {VERDICTS.find((entry) => entry.id === answered)?.label ?? answered}
            {take.verdict.note ? (
              <span className="font-normal opacity-80"> — {take.verdict.note}</span>
            ) : null}
          </p>
        )}

        {isTest && !answered && take.status === 'ready' && (
          <div className="mt-2">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-widest text-slate-600">
              You just watched it — now answer
            </p>
            <div className="flex gap-1">
              {VERDICTS.map((verdict) => (
                <button
                  key={verdict.id}
                  type="button"
                  onClick={() => onJudge?.({ takeId: take.takeId, answer: verdict.id })}
                  className="flex-1 rounded-lg border border-white/10 bg-black/40 px-1.5 py-1 text-[10px] text-slate-300 transition-colors hover:border-white/25 hover:text-white"
                >
                  {verdict.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
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
              download={isTest ? `${take.takeId}.mp4` : `take-${index}.mp4`}
              className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[9px] uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-300"
            >
              <Download className="h-3 w-3" />
              Save
            </a>
          )}
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 text-[10px] text-slate-500 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to lead
          </button>
          {take.taskId && (
            <span className="font-mono text-[9px] text-slate-700">task {take.taskId}</span>
          )}
        </div>

        {showScript && (
          <pre className="scrollbar-subtle mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-slate-400">
            {take.script?.text ?? 'No script recorded for this take.'}
          </pre>
        )}
      </div>
    </>
  );
};

export default TakeView;
