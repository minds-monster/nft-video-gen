import { ClipboardCheck, PenLine } from 'lucide-react';
import AgentThought from '../AgentThought';
import CanvasPanel from './CanvasPanel';
import { PREVIS, SCREENWRITER } from '../../../hooks/useScreenwriter';

/**
 * The Writers' room: the Previs Supervisor and the Screenwriter, in the order they run.
 *
 * NAMED FOR WHAT IS IN IT. This panel was called "Screenwriter" while holding two agents, and
 * the one it did not name is the one that can hold the run for two minutes — measured on a real
 * five-piece cast: 23s to review, 60-120s to re-cast one flagged piece cold, 23s to re-check.
 * For all of that the panel carried another agent's name and the cast cards read "known
 * already", so the only surface describing the wait was describing the wrong thing. An agent
 * that can hold the run has to be able to say so, under its own name, where it runs.
 */
const ScreenwriterPanel = ({ id, live, thoughts, error, collapsed, onToggle, status }) => {
  const writerStream = live.find((stream) => stream.owner === SCREENWRITER);
  const writerThought = thoughts[SCREENWRITER];
  const previsStream = live.find((stream) => stream.owner === PREVIS);
  const previsThought = thoughts[PREVIS];

  return (
    <CanvasPanel
      id={id}
      title="Writers' room"
      icon={PenLine}
      collapsed={collapsed}
      onToggle={onToggle}
      status={status}
    >
      <div className="space-y-3">
        {/* Ahead of the Screenwriter's own card, because it runs before it. */}
        {(previsStream || previsThought) && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.25em] text-slate-600">
              <ClipboardCheck className="h-3 w-3 shrink-0 text-purple-400" />
              Previs Supervisor
            </p>
            <AgentThought
              label="Previs Supervisor"
              phase={previsStream?.phase ?? previsThought?.phase}
              status={previsStream ? 'live' : 'done'}
              reasoning={previsStream?.reasoning ?? previsThought?.reasoning}
              content={previsStream?.content ?? previsThought?.content}
              compiling={Boolean(previsStream) && !previsStream.reasoning?.trim() && !previsStream.content?.trim()}
            />
          </div>
        )}

        {(writerStream || writerThought) && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.25em] text-slate-600">
              <PenLine className="h-3 w-3 shrink-0 text-purple-400" />
              Screenwriter
            </p>
            {writerStream ? (
              <AgentThought
                label="Screenwriter"
                phase={writerStream.phase}
                status="live"
                reasoning={writerStream.reasoning}
                content={writerStream.content}
                compiling={!writerStream.reasoning?.trim() && !writerStream.content?.trim()}
              />
            ) : (
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
          </div>
        )}

        {/* One of two places a failed run is visible — the other is the pipeline bar, which
            reports it whether or not this panel is open, collapsed or scrolled away. `error`
            had no mount point anywhere in the canvas until recently, so a run that threw after
            casting left every card looking healthy and simply never produced a screenplay. */}
        {error && (
          <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
            {error}
          </p>
        )}

        {!writerStream && !writerThought && !previsStream && !previsThought && !error && (
          <p className="py-6 text-center text-xs text-slate-500">
            The Previs Supervisor checks the cast against your prompt, then the Screenwriter
            drafts the film.
          </p>
        )}
      </div>
    </CanvasPanel>
  );
};

export default ScreenwriterPanel;
