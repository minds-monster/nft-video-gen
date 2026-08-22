import { MessageSquare } from 'lucide-react';
import CanvasPanel from './CanvasPanel';
import PromptBar from '../../PromptBar';
import ChatThread from '../../ChatThread';
import { useMindChatContext } from '../../../context/mindChat';

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
      {/* Front-loads the "someone else has to reply" expectation before the visitor ever
          sends anything — Adam's own diagnosis of why a slow-but-working reply reads as
          broken: the waiting state alone never explained who it was waiting on. */}
      {!isInitializing && messages.length === 0 && (
        <p className="text-xs text-slate-500">
          Connected to <span className="text-slate-300">{session.mindName || 'your Mind'}</span> ·
          typical reply ~1 min
        </p>
      )}
      <PromptBar
        onSubmit={send}
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
        elapsedLabel="Waiting for Mind reply (~1 min typical)…"
        elapsedLongWaitHint="some Minds take a few minutes — still normal"
        mindName={session.mindName}
        className="min-h-0 flex-1 rounded-2xl border border-white/10 bg-black/20 p-3"
      />
    </CanvasPanel>
  );
};

export default ProducerPanel;
