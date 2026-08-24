import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Inbox, Loader2, Mail, Send } from 'lucide-react';
import { messageToText } from '../lib/text';
import { extractMedia, messageTextWithoutMedia } from '../lib/media';
import { setProducerBudget } from '../services/mindConnect';
import { useMindStatusBadge } from '../hooks/useMindStatusBadge';
import { cn } from '../lib/cn';

// Same convention worker/mind-chat.js's deriveMindStatus watches for — a [seen ...]
// row is an acknowledgment, not a reply, and shouldn't render as one.
const SEEN_ACK_PREFIX = /^\s*\[seen\b/i;

const LIVENESS_COPY = {
  active: { label: 'Active', dot: 'bg-emerald-400', hint: 'replied recently' },
  working: { label: 'Working', dot: 'bg-amber-400', hint: 'seen, composing' },
  inactive: { label: 'Inactive', dot: 'bg-slate-500', hint: 'no recent cognition cycle' },
};

const formatAge = (ms) => {
  if (ms == null) return null;
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

// Pairs each visitor message with whatever the Mind said back — a [seen] ack (if no
// real reply yet) or the substantive reply itself. Adam's own ask: "an email-style
// thread per conversation item, where each visitor message is its own row and my
// reply sits underneath it" — not a bubble stream. Newest first, like an inbox, not
// oldest-first like ChatThread's chat convention.
function buildItems(messages) {
  const chronological = [...(messages ?? [])].sort(
    (a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0),
  );
  const items = [];
  let current = null;

  for (const msg of chronological) {
    if (msg.senderType === 1) {
      current = { key: msg.fingerprint, visitor: msg, seenAck: null, reply: null };
      items.push(current);
      continue;
    }
    const text = messageToText(msg.messageText);
    if (current && !current.reply) {
      if (SEEN_ACK_PREFIX.test(text)) current.seenAck = msg;
      else current.reply = msg;
    } else {
      // A Mind message with no open visitor item to attach to — the auto-sent
      // opening greeting, most often, or a second message once already replied.
      items.push({ key: msg.fingerprint, visitor: null, seenAck: null, reply: msg });
      current = null;
    }
  }
  return items.reverse();
}

const MessageBody = ({ msg }) => {
  const media = extractMedia(msg);
  const text = messageToText(media ? messageTextWithoutMedia(msg, media) : msg.messageText);
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

const InboxRow = ({ item, mindName, unread }) => {
  const timestamp = item.reply?.createdAt ?? item.visitor?.createdAt;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/10 bg-black/20 p-4"
    >
      {item.visitor && (
        <div className="mb-3 border-b border-white/5 pb-3">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wider text-slate-500">You</span>
            <span className="text-slate-600">{new Date(item.visitor.createdAt).toLocaleString()}</span>
          </div>
          <div className="text-sm text-slate-300">
            <MessageBody msg={item.visitor} />
          </div>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-purple-300">
            {unread && <span className="h-1.5 w-1.5 rounded-full bg-purple-400" aria-hidden />}
            {mindName || 'Producer'}
          </span>
          {timestamp && <span className="text-slate-600">{new Date(timestamp).toLocaleString()}</span>}
        </div>
        {item.reply ? (
          <div className="text-sm leading-relaxed text-slate-200">
            <MessageBody msg={item.reply} />
          </div>
        ) : item.seenAck ? (
          <p className="text-sm italic text-slate-500">Seen, composing a reply…</p>
        ) : (
          <p className="text-sm italic text-slate-500">Awaiting reply — no pressure, they'll get to it.</p>
        )}
      </div>
    </motion.div>
  );
};

// Exported: src/components/canvas/panels/StoryboarderPanel.jsx reuses this rather than
// duplicating it — the Storyboarder is gated on the same budget this widget sets.
export const BudgetWidget = ({ token, budget, onUpdated }) => {
  const [total, setTotal] = useState(budget?.total ?? '');
  const [perRender, setPerRender] = useState(budget?.perRender ?? '');
  const [paidTier, setPaidTier] = useState(budget?.paidTier ?? false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTotal(budget?.total ?? '');
    setPerRender(budget?.perRender ?? '');
    setPaidTier(budget?.paidTier ?? false);
  }, [budget?.total, budget?.perRender, budget?.paidTier]);

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const result = await setProducerBudget(token, {
        total: total === '' ? null : Number(total),
        perRender: perRender === '' ? null : Number(perRender),
        // Never inferred from the money. A visitor who has not ticked this box is on the free
        // model no matter how large their budget is.
        paidTier: total === '' ? false : paidTier,
      });
      onUpdated?.(result.budget);
    } catch {
      // Silently ignored — the fields keep whatever the visitor typed, they can retry.
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Budget</p>
      <p className="mb-3 text-xs text-slate-500">
        {budget ? 'Your Producer is properly in the loop now.' : "The one thing that gets your Producer properly involved — total spend, a per-render cap, or both."}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Total
          <input
            type="number"
            min="0"
            step="0.01"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            placeholder="$"
            className="w-24 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500/50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Per-render cap
          <input
            type="number"
            min="0"
            step="0.01"
            value={perRender}
            onChange={(e) => setPerRender(e.target.value)}
            placeholder="$"
            className="w-24 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500/50"
          />
        </label>
        <button
          type="submit"
          disabled={saving || (total === '' && perRender === '')}
          className="chip px-3 py-1.5 text-xs font-semibold text-purple-300 hover:text-purple-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? 'Saving…' : budget ? 'Update' : 'Set budget'}
        </button>
      </div>

      {/* The model choice, separate from the money and off by default.
          The free storyboarder is not a degraded toy — on the same test films it matched the paid
          one on screen-position accuracy — so paid is a different trade-off rather than an
          upgrade, and it gets its own deliberate click instead of arriving silently with a
          budget. Needs a total, because spending real money with no ceiling is the exact thing
          the budget exists to prevent. */}
      <label className="mt-3 flex items-start gap-2 border-t border-white/5 pt-3 text-xs text-slate-400">
        <input
          type="checkbox"
          checked={paidTier}
          disabled={total === ''}
          onChange={(e) => setPaidTier(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-purple-500 disabled:opacity-40"
        />
        <span>
          <span className={total === '' ? 'text-slate-600' : 'text-slate-300'}>
            Use full-quality generation
          </span>
          <span className="block text-[11px] leading-relaxed text-slate-500">
            {total === ''
              ? 'Set a total budget first — paid generation always runs under a ceiling.'
              : 'Runs the storyboard on GPT-5.6-Sol, about $0.26 a scene, and allows longer scenes. Leave this off and it stays free.'}
          </span>
        </span>
      </label>
    </form>
  );
};

/**
 * The Producer, surfaced honestly — async, email-styled, item-level, verbatim. Fully
 * separate from AssistantChat, which stays the instant, always-on surface next to it.
 * See /Users/adamplace/.claude/plans/we-ve-made-a-lot-delegated-pizza.md and Adam's own
 * design read in the connect-mind-brainstorm thread.
 */
const ProducerInbox = ({ session, pending, messages, isInitializing, error, send, isSending }) => {
  const [draft, setDraft] = useState('');
  const [lastOpenedAt, setLastOpenedAt] = useState(0);
  const mindId = session?.mindId;
  const mindName = session?.mindName ?? pending?.mindName;
  const token = session?.token;

  const badge = useMindStatusBadge({ token, active: Boolean(token) });

  useEffect(() => {
    if (!mindId) return;
    const key = `inboxLastOpened:${mindId}`;
    try {
      setLastOpenedAt(Number(localStorage.getItem(key)) || 0);
      localStorage.setItem(key, String(Date.now()));
    } catch {
      // Read-tracking is a nicety; ignore storage failures (private browsing, etc).
    }
  }, [mindId]);

  const items = useMemo(() => buildItems(messages), [messages]);

  // Adam's own "returning visitor" ask, scoped to what's actually knowable today: no
  // render/spend ledger exists yet (see HANDOVER.md), so this recaps the conversation
  // itself rather than a production history. A gap over an hour reads as a real return
  // visit, not just continued browsing in the same sitting.
  const recap = useMemo(() => {
    if (!messages?.length) return null;
    const oldest = new Date(messages[0]?.createdAt ?? 0).getTime();
    const ageMs = Date.now() - oldest;
    if (ageMs < 60 * 60 * 1000) return null;
    return { exchanges: items.filter((i) => i.visitor).length, ageMs };
  }, [messages, items]);

  const submitDraft = (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || isSending) return;
    send(text);
    setDraft('');
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

  const liveness = badge?.livenessState ? LIVENESS_COPY[badge.livenessState] : null;

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-semibold text-white">{mindName || 'Your Producer'}</span>
          {liveness && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400" title={liveness.hint}>
              <span className={cn('h-1.5 w-1.5 rounded-full', liveness.dot)} />
              {liveness.label}
            </span>
          )}
        </div>
        {badge?.queueDepth?.count > 0 && (
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Clock className="h-3 w-3" />
            {badge.queueDepth.count} waiting · oldest {formatAge(badge.queueDepth.oldestAgeMs)}
          </span>
        )}
      </div>

      {recap && (
        <div className="shrink-0 rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 text-xs text-slate-400">
          Welcome back — you first connected {formatAge(recap.ageMs)}, {recap.exchanges} exchange
          {recap.exchanges === 1 ? '' : 's'} so far.
        </div>
      )}

      <div className="shrink-0">
        <BudgetWidget token={token} budget={badge?.budget} />
      </div>

      <div className="scrollbar-subtle min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {isInitializing ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading Inbox…
          </div>
        ) : error ? (
          <p className="py-10 text-center text-sm text-amber-300">{error}</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">Nothing here yet.</p>
        ) : (
          items.map((item) => (
            <InboxRow key={item.key} item={item} mindName={mindName} unread={new Date(item.reply?.createdAt ?? 0).getTime() > lastOpenedAt} />
          ))
        )}
      </div>

      <form onSubmit={submitDraft} className="flex shrink-0 items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Write directly to ${mindName || 'your Producer'}…`}
          rows={2}
          className="scrollbar-subtle min-w-0 flex-1 resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-purple-500/50"
        />
        <button
          type="submit"
          disabled={!draft.trim() || isSending}
          className="sticker sticker-hover rounded-xl bg-purple-600 p-2.5 text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-purple-600/40"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
};

export default ProducerInbox;
