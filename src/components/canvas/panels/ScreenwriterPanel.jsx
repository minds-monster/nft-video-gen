import { PenLine } from 'lucide-react';
import AgentThought from '../AgentThought';
import CanvasPanel from './CanvasPanel';
import { PREVIS, SCREENWRITER } from '../../../hooks/useScreenwriter';

/**
 * The Screenwriter's own live stream and settled thought.
 *
 * During a run this shows the reasoning as it arrives; once settled it shows the draft
 * reasoning behind the screenplay.
 */
/**
 * The Screenwriter's own live stream and settled thought — plus the Previs Supervisor's, because
 * that is the agent actually holding the run in the gap this panel used to explain wrongly.
 *
 * The old placeholder said the Screenwriter "starts once the Casting Director finishes reading the
 * cast", which is false in the one case where somebody is staring at it: the Casting Director HAS
 * finished, and the Previs Supervisor is reviewing what it produced. Naming the right agent is the
 * difference between a wait and a hang.
 */
const ScreenwriterPanel = ({ live, thoughts, error, collapsed, onCollapse, onExpand }) => {
  const writerStream = live.find((stream) => stream.owner === SCREENWRITER);
  const writerThought = thoughts[SCREENWRITER];
  const previsStream = live.find((stream) => stream.owner === PREVIS);
  const previsThought = thoughts[PREVIS];

  return (
    <CanvasPanel title="Screenwriter" icon={PenLine} collapsed={collapsed} onCollapse={onCollapse} onExpand={onExpand}>
      <div className="space-y-3">
        {/* Ahead of the Screenwriter's own card, because it runs before it. */}
        {(previsStream || previsThought) && (
          <AgentThought
            label="Previs Supervisor"
            phase={previsStream?.phase ?? previsThought?.phase}
            status={previsStream ? 'live' : 'done'}
            reasoning={previsStream?.reasoning ?? previsThought?.reasoning}
            content={previsStream?.content ?? previsThought?.content}
            compiling={Boolean(previsStream) && !previsStream.reasoning?.trim() && !previsStream.content?.trim()}
          />
        )}

        {writerStream && (
          <AgentThought
            label="Screenwriter"
            phase={writerStream.phase}
            status="live"
            reasoning={writerStream.reasoning}
            content={writerStream.content}
            compiling={!writerStream.reasoning?.trim() && !writerStream.content?.trim()}
          />
        )}

        {!writerStream && writerThought && (
          <AgentThought
            label="Screenwriter"
            phase={writerThought.phase}
            status="done"
            reasoning={writerThought.reasoning}
            content={writerThought.content}
          >
            <p className="text-xs leading-relaxed text-slate-500">
              Draft complete. The screenplay is in the adjacent panel.
            </p>
          </AgentThought>
        )}

        {/* The one place a failed run is visible at all. `error` had no mount point anywhere in
            the canvas until now, so a run that threw after casting left every card looking healthy
            and simply never produced a screenplay. */}
        {error && (
          <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
            {error}
          </p>
        )}

        {!writerStream && !writerThought && !previsStream && !previsThought && !error && (
          <p className="py-6 text-center text-xs text-slate-500">
            The Screenwriter starts once the cast has been read and checked against your prompt.
          </p>
        )}
      </div>
    </CanvasPanel>
  );
};

export default ScreenwriterPanel;
