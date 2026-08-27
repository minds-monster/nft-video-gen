import { useState } from 'react';

import StoryboardPanel from './StoryboardPanel';
import DailiesPanel from './DailiesPanel';
import ScreenTestsPanel from './ScreenTestsPanel';
import { cn } from '../../../lib/cn';

/**
 * The centre slot, and which view of the film is in it.
 *
 * ONE SLOT, SEVERAL VIEWS, because they are the same thing at different stages: what the film is
 * planned to look like, what it cost to find out, and what came back. Putting the takes in their
 * own panel elsewhere would have meant a visitor comparing a storyboard beat against a rendered
 * take by scrolling between two rails.
 *
 * The tab strip is built HERE and handed down, rather than built by each body. Two reasons, and
 * the second one is the load-bearing one:
 *
 *   1. It has to look identical above every view.
 *   2. StoryboardPanel has an empty-state early return that mounts its OWN <CanvasPanel>, and a
 *      film shot straight from the screenplay — skipping the Storyboarder entirely, which is now
 *      a supported path — reaches Dailies with that storyboard still empty. A strip built inside
 *      the storyboard body would vanish exactly when it is most needed.
 *
 * "Screen Tests" lands here as a third view when the Director starts proposing them. The list is
 * data so that becomes one entry rather than a restructure.
 *
 * DAILIES OPENS FIRST, and sits leftmost. The Storyboarder is Beta and opt-in — a film shot
 * straight from the screenplay never touches it — so opening on an empty Storyboard showed most
 * visitors a view of a step they had deliberately skipped, while the footage they paid for sat
 * behind a tab. The default should be the thing that exists.
 */

const Tabs = ({ views, view, setView }) => (
  <div className="flex items-center gap-0.5 rounded-lg bg-black/40 p-0.5">
    {views.map((entry) => (
      <button
        key={entry.id}
        type="button"
        onClick={() => setView(entry.id)}
        className={cn(
          'rounded-md px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors',
          view === entry.id ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300',
        )}
      >
        {entry.label}
        {entry.count ? <span className="ml-1 text-slate-500">{entry.count}</span> : null}
      </button>
    ))}
  </div>
);

const TimelinePanel = ({
  id,
  storyboarder,
  director,
  token,
  budget,
  status,
  activeTakeId,
  onPreviewTake,
}) => {
  const [view, setView] = useState('dailies');

  const views = [
    { id: 'dailies', label: 'Dailies', count: (director?.finalTakes ?? []).length || null },
    { id: 'tests', label: 'Screen Tests', count: (director?.screenTests ?? []).length || null },
    { id: 'storyboard', label: 'Storyboard' },
  ];

  const tabs = <Tabs views={views} view={view} setView={setView} />;

  if (view === 'tests') {
    return (
      <ScreenTestsPanel
        id={id}
        director={director}
        status={status}
        tabs={tabs}
        activeTakeId={activeTakeId}
        onPreviewTake={onPreviewTake}
      />
    );
  }

  if (view === 'storyboard') {
    return (
      <StoryboardPanel
        id={id}
        storyboarder={storyboarder}
        token={token}
        budget={budget}
        status={status}
        tabs={tabs}
      />
    );
  }

  return (
    <DailiesPanel
      id={id}
      director={director}
      status={status}
      tabs={tabs}
      activeTakeId={activeTakeId}
      onPreviewTake={onPreviewTake}
    />
  );
};

export default TimelinePanel;
