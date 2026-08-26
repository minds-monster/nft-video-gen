import { useMemo, useState } from 'react';
import { ChevronDown, Inbox, Sparkles, Wallet } from 'lucide-react';
import AssistantChat from './AssistantChat';
import ProducerInbox from './ProducerInbox';
import BudgetWidget from './BudgetWidget';
import { buildThreads } from '../lib/mail';
import { useMindStatusBadge } from '../hooks/useMindStatusBadge';
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
 *
 * ALSO THE HOME OF THE BUDGET. It sits above the tabs rather than inside either one, because
 * money is a fact about the production and not about whichever surface you happen to be
 * reading — and because the Storyboarder used to carry its own copy of the same form, so the
 * control existed twice with two different framings. Above the tabs it is reachable from the
 * Inbox and the Assistant alike, and from both mount points (the canvas panel and the connect
 * modal), while existing exactly once.
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
  const [budgetOpen, setBudgetOpen] = useState(false);
  const token = session?.token;

  // Owned here rather than in ProducerInbox, which is the only thing that used to poll for it.
  // The Inbox still needs it for liveness and queue depth, so it now arrives as a prop — one
  // poll feeding both the budget control and the header.
  const badge = useMindStatusBadge({ token, active: Boolean(token) });
  const budget = badge?.budget;

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
      {/* Budget. Collapsed by default — it is a form, and this panel is often narrow — but the
          current ceiling is on the row itself, so the number is readable without opening it. */}
      {token && (
        <div className="shrink-0 space-y-2">
          <button
            type="button"
            onClick={() => setBudgetOpen((v) => !v)}
            aria-expanded={budgetOpen}
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300 transition-colors hover:border-purple-500/40 hover:text-white"
          >
            <span className="flex min-w-0 items-center gap-1.5 font-semibold">
              <Wallet className="h-3.5 w-3.5 shrink-0 text-purple-400" />
              Budget
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className={cn('font-mono', budget?.total != null ? 'text-white' : 'text-slate-600')}>
                {budget?.total != null ? `$${budget.total}` : 'not set'}
              </span>
              {budget?.paidTier && (
                <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-300">
                  paid
                </span>
              )}
              <ChevronDown
                className={cn('h-3.5 w-3.5 transition-transform', budgetOpen && 'rotate-180')}
              />
            </span>
          </button>
          {budgetOpen && <BudgetWidget token={token} budget={budget} />}
        </div>
      )}

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
          badge={badge}
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
