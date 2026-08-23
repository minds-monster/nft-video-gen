import ChatThread from './ChatThread';
import PromptBar from './PromptBar';
import RevealText from './canvas/RevealText';
import { useAssistantChat } from '../hooks/useAssistantChat';
import { useMindStatusBadge } from '../hooks/useMindStatusBadge';
import { cn } from '../lib/cn';

// Literal, including the braces — a stylized wordmark, not a template placeholder.
// Keep in sync with ASSISTANT_NAME in worker/assistant-brief.js.
export const ASSISTANT_NAME = '{minds} Assistant';

// Adam's own requirement from the design brainstorm (see
// scripts/brainstorm-adam-assistant.mjs): "seen" is a real signal his Mind commits to
// sending, not a guess — worth its own label distinct from plain silence.
const STATUS_LABEL = {
  waiting_on_mind: (name) => `Waiting on ${name}…`,
  mind_seen: (name) => `${name} has seen it, working on it`,
  mind_replied: (name) => `${name} replied`,
};

/**
 * The assistant — the one chat surface visitors talk to, in both ConnectMindModal and
 * ProducerPanel. It fully replaces raw access to the Mind's own conversation; see the
 * plan doc for why. `connectionId`/`token` come from whichever connect state the caller
 * is currently in (undefined is fine — the assistant still works pre-connection).
 */
const AssistantChat = ({ connectionId, token, mindName, threadClassName, placeholder = 'Ask the assistant…' }) => {
  const { messages, phase, isSending, send } = useAssistantChat({ connectionId, token });
  const badge = useMindStatusBadge({ connectionId, token, active: Boolean(connectionId || token) });

  const name = mindName || badge?.mindName || 'your Mind';
  const pillLabel = badge?.mindStatus ? STATUS_LABEL[badge.mindStatus]?.(name) : null;

  // The live reply bubble carries its own progress (the decode caret) — the older
  // dots-and-seconds ElapsedNotice would just be a second, redundant "thinking"
  // indicator stacked underneath it, so ChatThread's own busy state stays off here.
  const renderMessageText = (msg, text) => {
    if (!text && !msg.streaming) return null;
    return (
      <p className="whitespace-pre-wrap break-words leading-relaxed">
        {msg.streaming ? (
          <RevealText text={text} settling placeholder={!text && phase === 'deciding'} />
        ) : (
          text
        )}
      </p>
    );
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-3">
      {/* Adam's explicit ask: disclosure up front, not buried in a tooltip, and never
          let a visitor think they're talking to the Mind itself. */}
      <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-slate-400">
        I'm {ASSISTANT_NAME} — not {name}. I answer what I can directly and relay real
        messages to {name} when they're meant for them; I can't approve, decide, or speak
        for {token ? 'them' : 'your Mind'}.
        {token ? ` You can also reach ${name} directly through their own channels.` : ''}
      </div>

      {pillLabel && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-purple-400" />
          {pillLabel}
        </div>
      )}

      <ChatThread
        messages={messages}
        isSending={false}
        emptyHint="Ask anything — about the site, the connection, or what to tell your Mind."
        mindName={ASSISTANT_NAME}
        renderMessageText={renderMessageText}
        className={cn('min-h-0 flex-1 rounded-2xl border border-white/10 bg-black/20 p-3', threadClassName)}
      />
      <PromptBar onSubmit={send} busy={isSending} size="sm" placeholder={placeholder} />
    </div>
  );
};

export default AssistantChat;
