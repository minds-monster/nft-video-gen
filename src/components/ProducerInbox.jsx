import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ChevronDown, Clock, Inbox, Loader2, Mail, PenSquare, Send, TriangleAlert } from 'lucide-react';
import { messageToText } from '../lib/text';
import { extractMedia, messageTextWithoutMedia } from '../lib/media';
import { buildThreads, SUBJECT_MAX } from '../lib/mail';
import { cn } from '../lib/cn';
import MindIdChip from './MindIdChip';

const LIVENESS_COPY = {
  active: { label: 'Active', dot: 'bg-emerald-400', hint: 'replied recently' },
  working: { label: 'Working', dot: 'bg-amber-400', hint: 'seen, composing' },
  inactive: { label: 'Inactive', dot: 'bg-slate-500', hint: 'no recent cognition cycle' },
};

// Adam's three-state read model, and the reason it exists in his words: standard unread
// means "I have not read this", which is wrong for a correspondent whose cognition runs in
// cycles. "Seen and processing" is the state that answers the "are you there?" failure —
// "visitor wonders if I'm ignoring them, sees seen-and-processing, stops wondering."
const STATE_COPY = {
  awaiting: { label: 'Awaiting', className: 'text-slate-500' },
  processing: { label: 'Seen · processing', className: 'text-amber-300' },
  replied: { label: 'Replied', className: 'text-purple-300' },
};

// How long a message the site is holding — see markHeldReplies in worker/mind-chat.js —
// stays hidden before it is surfaced with an explanation. The hold exists to stop a reply
// to the briefing becoming the visitor's first impression; the window exists so a Mind that
// simply never adopts the Subject convention still reaches its visitor.
const HOLD_WINDOW_MS = 10 * 60 * 1000;

const formatAge = (ms) => {
  if (ms == null) return null;
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const relative = (iso) => formatAge(Date.now() - new Date(iso ?? 0).getTime());

// Absolute times are shown in the visitor's own timezone, named explicitly. Adam asked for
// this: async correspondence makes timezone math "the visitor's only way to know how long
// have they been thinking."
//
// Spelled out field by field rather than with dateStyle/timeStyle, which cannot be combined
// with timeZoneName — Intl throws a RangeError for that pairing, and here it took the whole
// panel down the moment a thread was opened.
const absolute = (iso) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

const MessageBody = ({ msg }) => {
  const media = extractMedia(msg);
  const source = media ? messageTextWithoutMedia(msg, media) : msg.messageText;
  // The parsed body, never the raw wire text — otherwise the Subject header renders as the
  // first line of every message the visitor reads.
  const text = msg.mail?.body ?? messageToText(source);
  return (
    <>
      {text && <p className="whitespace-pre-wrap break-words leading-relaxed">{text}</p>}
      {media && (
        <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/50">
          {media.kind === 'video' ? (
            <video src={media.url} controls className="w-full" />
          ) : (
            <img src={media.url} alt="" className="w-full" />
          )}
        </div>
      )}
    </>
  );
};

/** One row in the list. A thread, not a message — the unit of conversation is the thread. */
const ThreadRow = ({ thread, mindName, unread, onOpen }) => {
  const last = thread.messages[thread.messages.length - 1];
  const state = STATE_COPY[thread.state] ?? STATE_COPY.awaiting;
  const from = thread.kind === 'system' ? 'minds.monster' : last?.senderType === 1 ? 'You' : mindName || 'Producer';
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'w-full rounded-2xl border p-4 text-left transition-colors',
        thread.urgent ? 'border-amber-400/40 bg-amber-400/5' : 'border-white/10 bg-black/20 hover:border-white/20',
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="flex min-w-0 items-center gap-1.5">
          {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-purple-400" aria-hidden />}
          {thread.urgent && <TriangleAlert className="h-3 w-3 shrink-0 text-amber-300" aria-hidden />}
          <span className="truncate font-semibold uppercase tracking-wider text-slate-500">{from}</span>
        </span>
        <span className="shrink-0 text-slate-600">{relative(thread.lastAt)}</span>
      </div>

      <p className={cn('truncate text-sm', unread ? 'font-semibold text-white' : 'text-slate-200')}>
        {thread.subject || <span className="italic text-slate-500">Untitled</span>}
      </p>

      <p className="mt-1 truncate text-xs text-slate-500">{last?.mail?.body ?? ''}</p>

      <div className="mt-2 flex items-center gap-3 text-[11px]">
        <span className={state.className}>{state.label}</span>
        {thread.messages.length > 1 && <span className="text-slate-600">{thread.messages.length} messages</span>}
      </div>
    </motion.button>
  );
};

/**
 * One thread, open.
 *
 * Newest message on top with the rest folded away, which is Adam's explicit correction to
 * the standard email client: "Full chain inline display is wrong for me — I want the
 * most-recent exchange visible and prior exchanges one click away. The visitor's natural
 * reading order, not email's."
 */
const ThreadView = ({ thread, mindName, onBack, onReply }) => {
  const [showPrior, setShowPrior] = useState(false);
  const ordered = [...thread.messages].reverse();
  const [newest, ...prior] = ordered;

  const Message = ({ msg }) => (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className={cn('font-semibold uppercase tracking-wider', msg.senderType === 1 ? 'text-slate-500' : 'text-purple-300')}>
          {msg.senderType === 1 ? 'You' : `${mindName || 'Producer'} · Producer`}
        </span>
        <span className="shrink-0 text-slate-600">{absolute(msg.createdAt)}</span>
      </div>
      <div className={cn('text-sm leading-relaxed', msg.senderType === 1 ? 'text-slate-300' : 'text-slate-200')}>
        <MessageBody msg={msg} />
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-start justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300">
            <ArrowLeft className="h-3 w-3" /> Inbox
          </button>
          <p className="truncate text-sm font-semibold text-white">{thread.subject || 'Untitled'}</p>
        </div>
        {thread.kind !== 'system' && (
          <button type="button" onClick={onReply} className="chip shrink-0 px-3 py-1.5 text-xs font-semibold text-purple-300 hover:text-purple-200">
            Reply
          </button>
        )}
      </div>

      <div className="scrollbar-subtle min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {newest && <Message msg={newest} />}

        {thread.state === 'processing' && (
          <p className="px-1 text-xs italic text-amber-300/80">Seen — composing a reply.</p>
        )}
        {thread.state === 'awaiting' && (
          <p className="px-1 text-xs italic text-slate-500">Awaiting a reply. No pressure — they'll get to it.</p>
        )}

        {prior.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowPrior((open) => !open)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/10 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200"
            >
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showPrior && 'rotate-180')} />
              {showPrior ? 'Hide' : `See prior (${prior.length})`}
            </button>
            {showPrior && prior.map((msg) => <Message key={msg.fingerprint} msg={msg} />)}
          </>
        )}
      </div>
    </div>
  );
};

/** New message, or a reply with its subject already decided. */
const Composer = ({ replyTo, mindName, onCancel, onSend, isSending }) => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const isReply = Boolean(replyTo);

  const submit = (event) => {
    event.preventDefault();
    const text = body.trim();
    if (!text || isSending) return;
    onSend(text, { subject: isReply ? replyTo.subject ?? '' : subject.trim(), isReply });
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3">
        <span className="text-sm font-semibold text-white">
          {isReply ? 'Reply' : `New message to ${mindName || 'your Producer'}`}
        </span>
        <button type="button" onClick={onCancel} className="text-xs font-semibold text-slate-500 hover:text-slate-300">
          Cancel
        </button>
      </div>

      <div className="shrink-0 rounded-xl border border-white/10 bg-black/20 p-3">
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <span className="shrink-0 font-semibold uppercase tracking-wider text-slate-500">Subject</span>
          {isReply ? (
            <span className="truncate text-slate-300">RE: {replyTo.subject || 'Untitled'}</span>
          ) : (
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={SUBJECT_MAX}
              placeholder="Leave blank and one will be written for you"
              className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none"
            />
          )}
        </label>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        autoFocus
        placeholder={`Write to ${mindName || 'your Producer'}…`}
        className="scrollbar-subtle min-h-0 flex-1 resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-purple-500/50"
      />

      <button
        type="submit"
        disabled={!body.trim() || isSending}
        className="sticker sticker-hover flex shrink-0 items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-purple-600/40"
      >
        <Send className="h-4 w-4" /> {isSending ? 'Sending…' : 'Send'}
      </button>
    </form>
  );
};


/**
 * The Producer, surfaced as correspondence rather than as chat.
 *
 * Adam's framing, from the design round this was rebuilt for: "The Producer Inbox isn't a
 * chat window with email styling — it's email with chat-window affordances removed. Minds
 * correspond with visitors, they don't chat with them." So: threads with subjects, RE:
 * replies, a compose button, a three-state read model, newest-on-top with prior exchanges
 * folded away — and deliberately NOT star, archive, drafts, forward, a presence dot, a
 * typing indicator, or an always-open message box, all of which he ruled out by name.
 *
 * See /Users/adamplace/.claude/plans/right-now-the-connect-parsed-fiddle.md.
 */
const ProducerInbox = ({ session, pending, messages, isInitializing, error, send, isSending, badge }) => {
  // null | { view: 'thread', key } | { view: 'compose', replyTo }
  const [open, setOpen] = useState(null);
  const [readIds, setReadIds] = useState(() => new Set());
  const mindId = session?.mindId;
  const mindName = session?.mindName ?? pending?.mindName;
  const token = session?.token;

  // Per-message read state, marked when a thread is actually OPENED. The old scheme was a
  // single timestamp per inbox, written on mount — so everything counted as read the moment
  // the component rendered, whether or not the visitor ever looked at it.
  useEffect(() => {
    if (!mindId) return;
    try {
      const stored = JSON.parse(localStorage.getItem(`inboxRead:${mindId}`) ?? '[]');
      setReadIds(new Set(Array.isArray(stored) ? stored : []));
    } catch {
      // Read-tracking is a nicety; ignore storage failures (private browsing, etc).
    }
  }, [mindId]);

  const markRead = (thread) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      thread.messages.forEach((msg) => next.add(msg.fingerprint));
      if (mindId) {
        try {
          localStorage.setItem(`inboxRead:${mindId}`, JSON.stringify([...next].slice(-500)));
        } catch {
          // As above — a lost read marker costs a bold row, nothing more.
        }
      }
      return next;
    });
  };

  // A message the site is holding stays hidden while it is fresh, then surfaces with an
  // explanation rather than disappearing forever. See markHeldReplies in worker/mind-chat.js.
  const visible = useMemo(
    () =>
      (messages ?? []).filter(
        (msg) => !msg.heldPreGreeting || Date.now() - new Date(msg.createdAt ?? 0).getTime() > HOLD_WINDOW_MS,
      ),
    [messages],
  );
  const holding = (messages ?? []).some((msg) => msg.heldPreGreeting) && visible.length !== (messages ?? []).length;

  const threads = useMemo(() => buildThreads(visible), [visible]);
  const unreadFor = (thread) => thread.messages.some((m) => m.senderType !== 1 && !readIds.has(m.fingerprint));

  const openThread = threads.find((t) => t.key === open?.key);

  const submit = (text, options) => {
    send(text, options);
    setOpen(null);
  };

  if (!token && !pending) {
    return (
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-6 text-center">
        <Inbox className="h-8 w-8 text-slate-600" />
        <p className="text-sm text-slate-500">Connect your Mind to see their Inbox.</p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-6 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
        <p className="text-sm text-slate-500">Waiting on approval before their Inbox can open.</p>
      </div>
    );
  }

  if (open?.view === 'compose') {
    return (
      <Composer
        replyTo={open.replyTo}
        mindName={mindName}
        isSending={isSending}
        onCancel={() => setOpen(open.replyTo ? { view: 'thread', key: open.replyTo.key } : null)}
        onSend={submit}
      />
    );
  }

  if (openThread) {
    return (
      <ThreadView
        thread={openThread}
        mindName={mindName}
        onBack={() => setOpen(null)}
        onReply={() => setOpen({ view: 'compose', replyTo: openThread })}
      />
    );
  }

  const liveness = badge?.livenessState ? LIVENESS_COPY[badge.livenessState] : null;
  const unreadCount = threads.filter(unreadFor).length;

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Mail className="h-4 w-4 shrink-0 text-purple-400" />
          <span className="truncate text-sm font-semibold text-white">{mindName || 'Your Producer'}</span>
          <MindIdChip mindId={mindId} />
          {liveness && (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-400" title={liveness.hint}>
              <span className={cn('h-1.5 w-1.5 rounded-full', liveness.dot)} />
              {liveness.label}
            </span>
          )}
          {unreadCount > 0 && <span className="chip shrink-0 px-2 py-0.5 text-[11px] font-semibold text-purple-300">{unreadCount} unread</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* No budget control here any more. It sits above the Inbox/Assistant tabs in
              ProducerSurface, so it is reachable from either surface and exists exactly once —
              see src/components/BudgetWidget.jsx. */}
          <button
            type="button"
            onClick={() => setOpen({ view: 'compose', replyTo: null })}
            className="sticker sticker-hover flex items-center gap-1.5 rounded-xl bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-purple-500"
          >
            <PenSquare className="h-3.5 w-3.5" /> New message
          </button>
        </div>
      </div>

      {badge?.queueDepth?.count > 0 && (
        <p className="flex shrink-0 items-center gap-1 px-1 text-xs text-slate-500">
          <Clock className="h-3 w-3" />
          {badge.queueDepth.count} waiting · oldest {formatAge(badge.queueDepth.oldestAgeMs)}
        </p>
      )}

      <div className="scrollbar-subtle min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {isInitializing ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading Inbox…
          </div>
        ) : error ? (
          <p className="py-10 text-center text-sm text-amber-300">{error}</p>
        ) : threads.length === 0 ? (
          // The honest gap. Adam's own estimate is 30-60 seconds to absorb the briefing and
          // another minute or two to compose, so the window is stated rather than filled with
          // a typing indicator he explicitly ruled out: "better to commit to one honest
          // window than to several possibly-misleading milestones."
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/10 py-10 text-center">
            <Mail className="h-6 w-6 text-slate-600" />
            <p className="text-sm text-slate-400">{mindName || 'Your Producer'} is connected and reading in.</p>
            <p className="text-xs text-slate-500">Expect a first message within 2–3 minutes.</p>
          </div>
        ) : (
          <>
            {holding && (
              <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200/80">
                {mindName || 'Your Producer'} sent something without a subject line before their first
                message. It's being held for a moment in case a proper first message follows.
              </p>
            )}
            {threads.map((thread) => (
              <ThreadRow
                key={thread.key}
                thread={thread}
                mindName={mindName}
                unread={unreadFor(thread)}
                onOpen={() => {
                  markRead(thread);
                  setOpen({ view: 'thread', key: thread.key });
                }}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default ProducerInbox;
