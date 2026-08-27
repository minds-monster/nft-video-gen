import ChatThread from './ChatThread';
import PromptBar from './PromptBar';
import RevealText from './canvas/RevealText';
import { useAssistantChat } from '../hooks/useAssistantChat';
import { useMindStatusBadge } from '../hooks/useMindStatusBadge';
import { cn } from '../lib/cn';
import { parseBrief } from '../lib/directorBrief';

// The assistant's displayed name is tied to the connected Mind — "Adam Assistant" when
// Adam's Mind is connected, "Production Assistant" before a Mind has been brought in.
// Keep in sync with the naming rule in worker/assistant-brief.js.
const assistantNameFor = (mindName) => `${mindName || 'Production'} Assistant`;

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
/**
 * A scope the assistant has proposed, and the button that is the whole boundary of its authority.
 *
 * The assistant writes a `[BRIEF]` block into its own reply — the same machine-read-marker-inside-
 * prose convention as the Producer's `[seen …]` and the Screenwriter's `[CUT TO BLACK]`. Parsing
 * one does NOT apply it. It cannot reach the endpoint that stores this; the visitor pressing here
 * is the only path, which is what keeps "the assistant helps you scope the film" from quietly
 * becoming "the assistant spends your money".
 */
const ProposedBrief = ({ brief, onAccept, accepted }) => (
  <div className="mt-2 rounded-xl border border-purple-500/25 bg-purple-950/20 p-2.5">
    <p className="font-mono text-[9px] uppercase tracking-widest text-purple-300/70">Proposed scope</p>
    {brief.intent && <p className="mt-1 text-xs leading-relaxed text-slate-200">{brief.intent}</p>}
    <dl className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-slate-500">
      {brief.duration && <span>{brief.duration}s</span>}
      {brief.resolution && <span>{brief.resolution}</span>}
      {brief.willingToSpend && <span>${brief.willingToSpend} on this film</span>}
    </dl>
    {brief.mustHold?.length > 0 && (
      <ul className="mt-1.5 space-y-0.5">
        {brief.mustHold.map((item) => (
          <li key={item} className="flex items-start gap-1.5 text-[11px] leading-snug text-slate-300">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-purple-400" />
            {item}
          </li>
        ))}
      </ul>
    )}
    <button
      type="button"
      disabled={accepted}
      onClick={() => onAccept?.(brief)}
      className="mt-2 w-full rounded-lg bg-purple-600 px-2 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-purple-500 disabled:bg-white/5 disabled:text-slate-500"
    >
      {accepted ? 'Scope accepted' : 'Use this scope'}
    </button>
  </div>
);

const AssistantChat = ({
  connectionId,
  token,
  mindName,
  threadClassName,
  placeholder = 'Ask the assistant…',
  onAcceptBrief,
  acceptedBriefAt,
}) => {
  const { messages, phase, isSending, send } = useAssistantChat({ connectionId, token });
  const badge = useMindStatusBadge({ connectionId, token, active: Boolean(connectionId || token) });

  const resolvedMindName = mindName || badge?.mindName;
  const name = resolvedMindName || 'your Mind';
  const assistantName = assistantNameFor(resolvedMindName);
  const pillLabel = badge?.mindStatus ? STATUS_LABEL[badge.mindStatus]?.(name) : null;

  // The live reply bubble carries its own progress (the decode caret) — the older
  // dots-and-seconds ElapsedNotice would just be a second, redundant "thinking"
  // indicator stacked underneath it, so ChatThread's own busy state stays off here.
  const renderMessageText = (msg, text) => {
    if (!text && !msg.streaming) return null;

    // A brief is only pulled out once the reply has SETTLED. Parsing mid-stream would flash a
    // half-built scope card as the marker's lines arrive one at a time, and a proposal that
    // rewrites itself while you read it is not one anybody should press a button on.
    const { brief, text: prose } = msg.streaming ? { brief: null, text } : parseBrief(text);

    return (
      <>
        <p className="whitespace-pre-wrap break-words leading-relaxed">
          {msg.streaming ? (
            <RevealText text={text} settling placeholder={!text && phase === 'deciding'} />
          ) : (
            prose
          )}
        </p>
        {brief && onAcceptBrief && (
          <ProposedBrief brief={brief} onAccept={onAcceptBrief} accepted={acceptedBriefAt >= msg.at} />
        )}
      </>
    );
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-3">
      {/* Adam's explicit ask: disclosure up front, not buried in a tooltip, and never
          let a visitor think they're talking to the Mind itself. */}
      <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-slate-400">
        I'm {assistantName} — not {name}. I answer what I can directly and relay real
        messages to {name} when they're meant for them; I can't approve, decide, or speak
        for {token ? 'them' : 'your Mind'}.
        {token ? ` You can also write to ${name} directly in their Inbox.` : ''}
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
        mindName={assistantName}
        renderMessageText={renderMessageText}
        className={cn('min-h-0 flex-1 rounded-2xl border border-white/10 bg-black/20 p-3', threadClassName)}
      />
      <PromptBar onSubmit={send} busy={isSending} size="sm" placeholder={placeholder} />
    </div>
  );
};

export default AssistantChat;
