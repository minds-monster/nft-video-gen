import { FlaskConical } from 'lucide-react';

import CanvasPanel from './CanvasPanel';
import { cn } from '../../../lib/cn';
import { VERDICTS } from '../../../../worker/screen-test.js';

/**
 * What the experiments cost, and what they said.
 *
 * THE CARD IS ORDERED: question → price → answer → the clip. That order is the argument. A
 * visitor scrolling this should be able to read what they bought without pressing play, and the
 * clip is the evidence for the answer rather than the point of the card.
 *
 * An unanswered test is shown as unanswered, with the buttons right there. A test nobody judged
 * is money spent and nothing learned, and the surface should make that uncomfortable rather than
 * tidy it away.
 */

const money = (value) => (value == null ? null : `$${Number(value).toFixed(2)}`);

const ANSWER_TONE = {
  held: 'border-emerald-500/25 bg-emerald-500/5 text-emerald-200',
  failed: 'border-amber-400/25 bg-amber-500/5 text-amber-200',
  unclear: 'border-white/10 bg-white/5 text-slate-300',
};

const ScreenTest = ({ test, onJudge }) => {
  const answered = test.verdict?.answer;

  return (
    <article className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-3">
      <header className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-[12px] font-semibold leading-snug text-white">
          {test.question ?? 'An unnamed test'}
        </p>
        <span className="shrink-0 font-mono text-[10px] text-slate-400">{money(test.costUsd)}</span>
      </header>

      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-slate-600">
        {test.params?.duration}s · {test.params?.resolution}
        {test.seconds ? ` · shot in ${test.seconds}s` : ''}
      </p>

      {answered ? (
        <p className={cn('mt-2 rounded-xl border px-2 py-1.5 text-[11px] font-semibold', ANSWER_TONE[answered])}>
          {VERDICTS.find((v) => v.id === answered)?.label ?? answered}
          {test.verdict.note ? <span className="font-normal opacity-80"> — {test.verdict.note}</span> : null}
        </p>
      ) : test.status === 'ready' ? (
        <div className="mt-2">
          <p className="mb-1 font-mono text-[9px] uppercase tracking-widest text-slate-600">Watch it, then answer</p>
          <div className="flex gap-1">
            {VERDICTS.map((verdict) => (
              <button
                key={verdict.id}
                type="button"
                onClick={() => onJudge?.({ takeId: test.takeId, answer: verdict.id })}
                className="flex-1 rounded-lg border border-white/10 bg-black/40 px-1.5 py-1 text-[10px] text-slate-300 transition-colors hover:border-white/25 hover:text-white"
              >
                {verdict.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {test.url ? (
        <video
          src={test.url}
          controls
          loop
          playsInline
          preload="metadata"
          className="mt-2 block w-full rounded-xl border border-white/10 bg-black/40"
        />
      ) : (
        <p className="mt-2 rounded-xl border border-white/10 bg-black/30 p-2 text-[11px] leading-relaxed text-slate-500">
          {test.reason ?? 'Still shooting.'}
        </p>
      )}
    </article>
  );
};

const ScreenTestsPanel = ({ id, director, status, tabs }) => {
  const tests = director?.screenTests ?? [];
  const spent = tests.reduce((sum, test) => sum + (test.costUsd ?? 0), 0);
  const answered = tests.filter((test) => test.verdict?.answer).length;

  const header = (
    <div className="flex items-center gap-2">
      {tabs}
      {tests.length > 0 && (
        <span className="font-mono text-[9px] uppercase tracking-wider text-slate-600">
          {money(spent)} · {answered}/{tests.length} answered
        </span>
      )}
    </div>
  );

  if (!tests.length) {
    return (
      <CanvasPanel id={id} title="Screen Tests" icon={FlaskConical} headerAction={header} status={status}>
        <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
            <FlaskConical className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">No tests run</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
              A screen test buys an answer to one question for about $0.32 — whether a face
              survives its framing, whether flat art reads as a real object, whether the film holds
              as one take. The Director proposes them from the hazards it can actually name.
            </p>
          </div>
        </div>
      </CanvasPanel>
    );
  }

  return (
    <CanvasPanel
      id={id}
      title="Screen Tests"
      icon={FlaskConical}
      headerAction={header}
      status={status}
      bodyClassName="flex flex-col gap-3"
    >
      {tests.map((test) => (
        <ScreenTest key={test.takeId} test={test} onJudge={director?.judge} />
      ))}
    </CanvasPanel>
  );
};

export default ScreenTestsPanel;
