import { useState } from 'react';
import { Inbox, Sparkles } from 'lucide-react';
import AssistantChat from './AssistantChat';
import ProducerInbox from './ProducerInbox';
import { cn } from '../lib/cn';

const TABS = [
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'assistant', label: 'Assistant', icon: Sparkles },
];

/**
 * The two parallel surfaces — Producer Inbox (the Mind, async, in its own words) and
 * the assistant (instant, mediated) — switched via a simple toggle rather than shown
 * side by side, which read as too confusing in practice. Connection state (session,
 * pending) stays global — owned by MindChatProvider, just passed through here — only
 * the view choice is local to wherever this is mounted. Shared by ConnectMindModal and
 * ProducerPanel so the toggle looks and behaves identically everywhere it appears.
 */
const ProducerSurface = ({
  session,
  pending,
  messages,
  isInitializing,
  error,
  send,
  isSending,
  assistantPlaceholder,
  defaultTab = 'inbox',
}) => {
  const [tab, setTab] = useState(defaultTab);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors',
              tab === key ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200',
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === 'inbox' ? (
        <ProducerInbox
          session={session}
          pending={pending}
          messages={messages}
          isInitializing={isInitializing}
          error={error}
          send={send}
          isSending={isSending}
        />
      ) : (
        <AssistantChat
          connectionId={pending?.connectionId}
          token={session?.token}
          mindName={session?.mindName ?? pending?.mindName}
          placeholder={assistantPlaceholder}
        />
      )}
    </div>
  );
};

export default ProducerSurface;
