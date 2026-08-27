import { Clapperboard } from 'lucide-react';

import CanvasPanel from './CanvasPanel';
import TakeTile from './TakeTile';

/**
 * The takes. Every render this production has paid for, in the order they were shot.
 *
 * WHY "DAILIES". It is what the day's raw footage is called on a real set, and it is honest about
 * what this is: not a finished film, but everything shot so far, including the ones that did not
 * work. A failed take stays in the grid with what it cost, because the alternative — hiding it —
 * is how a visitor comes to ask "why did my budget run out faster than the films I can see?"
 *
 * A GRID OF CARDS, WATCHED IN THE VIEWER. The day's footage is something you scan and then pick
 * from, so the cards carry only what you scan by — which take, whether it worked, what it cost —
 * and clicking one plays it large in the Viewer. That is also where a take's request and its
 * download now live: scripts/gen-video.mjs has written the exact request beside every result
 * since the hero was made, for a reason it states in one line ("a good render is worthless if we
 * can't repeat it"), and the place to read it is the place you are watching the result.
 */

const money = (value) => (value == null ? null : `$${Number(value).toFixed(2)}`);

const DailiesPanel = ({ id, director, status, tabs, activeTakeId, onPreviewTake }) => {
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
      // Three up, matching the storyboard's grid so the two views of the same film share one
      // rhythm as you tab between them.
      bodyClassName="grid grid-cols-3 content-start gap-3"
    >
      {takes.map((take, index) => (
        <TakeTile
          key={take.takeId}
          take={take}
          active={take.takeId === activeTakeId}
          onOpen={onPreviewTake}
        >
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate font-mono text-[10px] uppercase tracking-widest text-slate-400">
              Take {index + 1}
            </p>
            <p className="shrink-0 font-mono text-[10px] text-slate-500">{money(take.costUsd)}</p>
          </div>
          <p className="truncate font-mono text-[9px] text-slate-600">
            {take.params?.resolution} · {take.params?.duration}s
          </p>
        </TakeTile>
      ))}
    </CanvasPanel>
  );
};

export default DailiesPanel;
