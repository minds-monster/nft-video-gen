import { MessageSquare } from 'lucide-react';
import CanvasPanel from './CanvasPanel';
import PromptBar from '../../PromptBar';
import ChatThread from '../../ChatThread';
import { useMindChatContext } from '../../../context/mindChat';
import { PROMPT_IDEAS } from '../../../data/prompts';

/**
 * The Producer: a persistent chat with the mind.
 *
 * This is the same conversation that powers the Studio overlay, surfaced as a canvas panel.
 */
const ProducerPanel = () => {
  const { session, openModal, messages, isSending, isInitializing, error, send } = useMindChatContext();

  if (!session) {
    return (
      <CanvasPanel title="Producer" icon={MessageSquare} bodyClassName="flex flex-col gap-3">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-6 text-center">
          <MessageSquare className="h-8 w-8 text-slate-600" />
          <p className="text-sm text-slate-400">Connect your Mind to direct the film here.</p>
          <button
            type="button"
            onClick={openModal}
            className="chip px-4 py-2 text-xs font-semibold text-purple-300 hover:text-purple-200"
          >
            Connect Mind
          </button>
        </div>
      </CanvasPanel>
    );
  }

  return (
    <CanvasPanel title="Producer" icon={MessageSquare} bodyClassName="flex flex-col gap-3">
      <PromptBar
        onSubmit={send}
        suggestions={PROMPT_IDEAS}
        busy={isSending}
        disabled={isInitializing || Boolean(error)}
        size="sm"
        placeholder="Direct the film…"
      />
      <ChatThread
        messages={messages}
        isSending={isSending}
        isInitializing={isInitializing}
        error={error}
        emptyHint="Send a direction and the film appears here."
        className="min-h-0 flex-1 rounded-2xl border border-white/10 bg-black/20 p-3"
      />
    </CanvasPanel>
  );
};

export default ProducerPanel;
