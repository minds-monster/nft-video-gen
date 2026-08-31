import { Clapperboard } from 'lucide-react';

import CanvasPanel from './CanvasPanel';
import TakeTile from './TakeTile';
import RecallCard from './RecallCard';

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

const when = (ms) =>
  ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;

const DailiesPanel = ({ id, director, token, status, tabs, activeTakeId, onPreviewTake, recall, mindName }) => {
  const takes = director?.finalTakes ?? [];
  const envelope = director?.envelope ?? null;
  // Productions with footage that this tab is not looking at. The list needs no spec, which is
  // the whole point: filmId is a hash of a screenplay this tab may never have seen.
  const earlier = (director?.films ?? []).filter(
    (film) => film.takeCount > 0 && film.filmId !== director?.production?.filmId,
  );

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

          {/* Past productions — the same recovery the Storyboard offers, for the same reason: a
              reload leaves the tab with no spec, and the footage a visitor paid for must not
              need the screenplay regenerated (to a different hash) before it can be seen. */}
          {earlier.length > 0 && token && (
            <div className="mx-auto w-full max-w-sm text-left">
              <p className="mb-2 text-center text-[10px] uppercase tracking-widest text-slate-600">
                Your earlier productions
              </p>
              <ul className="space-y-1">
                {earlier.map((film) => (
                  <li key={film.filmId}>
                    <button
                      type="button"
                      onClick={() => director?.openProduction?.({ token, filmId: film.filmId })}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-left text-xs text-slate-300 transition-colors hover:border-purple-500/40 hover:bg-purple-500/5"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {film.logline ?? `Film ${film.filmId}`}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-slate-600">
                        {film.readyTakes} {film.readyTakes === 1 ? 'take' : 'takes'}
                        {film.spentUsd ? ` · ${money(film.spentUsd)}` : ''}
                        {when(film.lastTakeAt) ? ` · ${when(film.lastTakeAt)}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {token && <RecallCard recall={recall} mindName={mindName} className="mx-auto w-full max-w-sm" />}
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
      {/* The memory check sits above the footage it is about, full width in the grid. */}
      {token && <RecallCard recall={recall} mindName={mindName} className="col-span-3" />}
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
