import { MessageSquare } from 'lucide-react';
import CanvasPanel from './CanvasPanel';
import AssistantChat from '../../AssistantChat';
import { useMindChatContext } from '../../../context/mindChat';

/**
 * The Producer: the site assistant, mediating whatever state the Mind connection is
 * currently in — idle, pending, or approved. It never shows the Mind's raw
 * conversation directly; see /Users/adamplace/.claude/plans/a-third-party-mind-agent-floating-seal.md.
 */
const ProducerPanel = () => {
  const { session, pending, openModal } = useMindChatContext();

  return (
    <CanvasPanel title="Producer" icon={MessageSquare} bodyClassName="flex flex-1 min-h-0 flex-col gap-3">
      {session ? (
        <p className="text-xs text-slate-500">
          Connected to <span className="text-slate-300">{session.mindName || 'your Mind'}</span>
        </p>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <p className="text-xs text-slate-400">Connect your Mind to direct the film.</p>
          <button
            type="button"
            onClick={openModal}
            className="chip shrink-0 px-3 py-1.5 text-xs font-semibold text-purple-300 hover:text-purple-200"
          >
            Connect Mind
          </button>
        </div>
      )}

      <AssistantChat
        connectionId={pending?.connectionId}
        token={session?.token}
        mindName={session?.mindName ?? pending?.mindName}
        placeholder="Direct the film…"
      />
    </CanvasPanel>
  );
};

export default ProducerPanel;
