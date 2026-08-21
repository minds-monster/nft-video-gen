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
  const { messages, isSending, isInitializing, error, send } = useMindChatContext();

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
