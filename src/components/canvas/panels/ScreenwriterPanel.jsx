import { PenLine } from 'lucide-react';
import AgentThought from '../AgentThought';
import CanvasPanel from './CanvasPanel';
import { SCREENWRITER } from '../../../hooks/useScreenwriter';

/**
 * The Screenwriter's own live stream and settled thought.
 *
 * During a run this shows the reasoning as it arrives; once settled it shows the draft
 * reasoning behind the screenplay.
 */
const ScreenwriterPanel = ({ live, thoughts, collapsed, onCollapse, onExpand }) => {
  const writerStream = live.find((stream) => stream.owner === SCREENWRITER);
  const writerThought = thoughts[SCREENWRITER];

  return (
    <CanvasPanel title="Screenwriter" icon={PenLine} collapsed={collapsed} onCollapse={onCollapse} onExpand={onExpand}>
      <div className="space-y-3">
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

        {!writerStream && !writerThought && (
          <p className="py-6 text-center text-xs text-slate-500">
            The Screenwriter starts once the Casting Director finishes reading the cast.
          </p>
        )}
      </div>
    </CanvasPanel>
  );
};

export default ScreenwriterPanel;
