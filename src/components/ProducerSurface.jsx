import { useMemo, useState } from 'react';
import { Inbox, Sparkles } from 'lucide-react';
import AssistantChat from './AssistantChat';
import ProducerInbox from './ProducerInbox';
import { buildThreads } from '../lib/mail';
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

  // An unread count on the tab itself, so a visitor sitting in the assistant surface can
  // see that their Producer has actually written back. Read state is per message and lives
  // in localStorage under the same key the Inbox writes — deliberately duplicated here as a
  // read rather than lifted into state, since it changes only when a thread is opened.
  const unread = useMemo(() => {
    if (!session?.mindId) return 0;
    let read = new Set();
    try {
      read = new Set(JSON.parse(localStorage.getItem(`inboxRead:${session.mindId}`) ?? '[]'));
    } catch {
      // No stored markers means everything reads as unread, which is the safe direction.
    }
    return buildThreads(messages).filter((thread) =>
      thread.messages.some((msg) => msg.senderType !== 1 && !read.has(msg.fingerprint)),
    ).length;
  }, [messages, session?.mindId]);

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
            {key === 'inbox' && unread > 0 && (
              <span className={cn(
                'ml-0.5 rounded-full px-1.5 text-[10px] font-bold',
                tab === key ? 'bg-white/20 text-white' : 'bg-purple-500/20 text-purple-300',
              )}>
                {unread}
              </span>
            )}
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
