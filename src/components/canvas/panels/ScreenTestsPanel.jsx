import { FlaskConical } from 'lucide-react';

import CanvasPanel from './CanvasPanel';
import TakeTile from './TakeTile';
import { cn } from '../../../lib/cn';
import { ANSWER_TONE, UNANSWERED_TONE } from '../../../lib/takeTone';
import { VERDICTS } from '../../../../worker/screen-test.js';

/**
 * What the experiments cost, and what they said.
 *
 * THE CARD ANSWERS TWO QUESTIONS AND NO MORE: what did this buy, and did anybody read it. That is
 * what a visitor scanning the grid needs, and both are legible without pressing play — the
 * question is the title, the price sits beside it, and an unjudged test wears an amber pill.
 *
 * AN UNANSWERED TEST IS SHOWN AS UNANSWERED. A test nobody judged is money spent and nothing
 * learned, and the surface should make that uncomfortable rather than tidy it away.
 *
 * THE VERDICT BUTTONS ARE IN THE VIEWER, NOT HERE. They used to sit under a thumbnail-sized
 * player, which asked people to answer "did the face survive its framing?" from a clip the size
 * of a stamp. Clicking a card plays it large; the three answers are waiting underneath it there.
 */

const money = (value) => (value == null ? null : `$${Number(value).toFixed(2)}`);

const ScreenTestsPanel = ({ id, director, status, tabs, activeTakeId, onPreviewTake }) => {
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
      bodyClassName="grid grid-cols-3 content-start gap-3"
    >
      {tests.map((test) => {
        const verdict = test.verdict?.answer;
        return (
          <TakeTile
            key={test.takeId}
            take={test}
            active={test.takeId === activeTakeId}
            onOpen={onPreviewTake}
          >
            <p className="mt-1.5 line-clamp-2 text-[11px] font-semibold leading-snug text-white">
              {test.question ?? 'An unnamed test'}
            </p>
            <div className="mt-1 flex items-center justify-between gap-1.5">
              {verdict ? (
                <span
                  className={cn(
                    'min-w-0 truncate rounded-full border px-1.5 py-0.5 text-[9px] font-semibold',
                    ANSWER_TONE[verdict],
                  )}
                >
                  {VERDICTS.find((entry) => entry.id === verdict)?.label ?? verdict}
                </span>
              ) : test.status === 'ready' ? (
                // Amber is reserved for a test that CAME BACK and nobody read. One that is still
                // shooting has not earned the reproach, and its tile already says so.
                <span
                  className={cn(
                    'min-w-0 truncate rounded-full border px-1.5 py-0.5 text-[9px] font-semibold',
                    UNANSWERED_TONE,
                  )}
                >
                  Unanswered
                </span>
              ) : (
                <span />
              )}
              <span className="shrink-0 font-mono text-[10px] text-slate-500">
                {money(test.costUsd)}
              </span>
            </div>
          </TakeTile>
        );
      })}
    </CanvasPanel>
  );
};

export default ScreenTestsPanel;
