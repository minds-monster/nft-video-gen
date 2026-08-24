import { MessageSquare } from 'lucide-react';
import CanvasPanel from './CanvasPanel';
import ProducerSurface from '../../ProducerSurface';
import { useMindChatContext } from '../../../context/mindChat';

/**
 * Two parallel surfaces (Producer Inbox / Assistant) sharing one narrow panel, via the
 * same toggle ProducerSurface gives ConnectMindModal — see
 * /Users/adamplace/.claude/plans/we-ve-made-a-lot-delegated-pizza.md.
 */
const ProducerPanel = () => {
  const { session, pending, openModal, messages, isInitializing, error, send, isSending } = useMindChatContext();

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

      <ProducerSurface
        session={session}
        pending={pending}
        messages={messages}
        isInitializing={isInitializing}
        error={error}
        send={send}
        isSending={isSending}
        assistantPlaceholder="Direct the film…"
      />
    </CanvasPanel>
  );
};

export default ProducerPanel;
