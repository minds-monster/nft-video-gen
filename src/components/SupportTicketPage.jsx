import { useEffect, useState } from 'react';
import { Check, Clock, LifeBuoy, Loader2, Mail } from 'lucide-react';
import { fetchTicket, replyToTicket } from '../services/support';
import { cn } from '../lib/cn';

// The visitor's own view of one ticket, reached from the signed link in every support email
// (`#/support/<ticketId>/<token>`). This is Adam's "did you get my message?" path: rather
// than a second ticket, the visitor sees when it was seen and when to expect a reply, and
// can add to the thread. Writing back on a resolved ticket reopens it.

const STATUS_COPY = {
  received: { label: 'Received', tone: 'text-slate-300', hint: (t) => `Expect it seen by ${when(t.expectSeenBy)}.` },
  seen: { label: 'Seen — being looked at', tone: 'text-amber-300', hint: (t) => `Seen ${when(t.seenAt)}. Expect a reply by ${when(t.expectRepliedBy)}.` },
  awaiting: { label: 'Your message is waiting to be read', tone: 'text-slate-300', hint: () => 'It will be read within a few hours.' },
  replied: { label: 'Replied', tone: 'text-purple-300', hint: () => 'The reply is below, and in your email.' },
  'replied-unmarked': { label: 'Replied', tone: 'text-purple-300', hint: () => 'The site is checking whether it went out by email.' },
  escalated: { label: 'Being looked at by the team', tone: 'text-amber-300', hint: () => 'It needed a second pair of eyes; you will hear back by email.' },
  forwarded: { label: 'Answered, with a word from the site owner', tone: 'text-purple-300', hint: () => 'The answer is below, and in your email.' },
  resolved: { label: 'Resolved', tone: 'text-emerald-300', hint: () => 'Write back below if it is not.' },
  reopened: { label: 'Reopened', tone: 'text-amber-300', hint: () => 'It will be picked up again.' },
};

const when = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

const SupportTicketPage = ({ ticketId, token }) => {
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null);

  useEffect(() => {
    let active = true;
    fetchTicket(ticketId, token)
      .then((data) => active && setTicket(data))
      .catch(() => active && setError('That ticket link is not valid any more.'));
    return () => {
      active = false;
    };
  }, [ticketId, token]);

  const reply = async ({ humanRequested = false } = {}) => {
    if (sending || message.trim().length < 2) return;
    setSending(true);
    setError(null);
    try {
      const data = await replyToTicket(ticketId, token, { message, humanRequested });
      setTicket(data);
      setSent(humanRequested ? 'human' : 'reply');
      setMessage('');
    } catch (err) {
      setError(err.code === 'rate_limited' ? 'Give that a moment — too many messages in a row.' : 'Could not send that. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const status = ticket ? STATUS_COPY[ticket.status] ?? STATUS_COPY.received : null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 font-sans text-slate-50">
      <header className="border-b border-white/10 bg-slate-950/70 backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-3xl items-center justify-between px-6">
          <a href="#top" className="flex items-center">
            <img src="/brand/minds-monster-lockup.png" alt="minds.MONSTER" className="h-10 w-auto" />
          </a>
          <span className="flex items-center gap-2 text-sm text-slate-400">
            <LifeBuoy className="h-4 w-4 text-purple-400" /> Contact
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        {error && !ticket && <p className="text-sm text-amber-300">{error}</p>}
        {!ticket && !error && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Opening your ticket…
          </p>
        )}

        {ticket && (
          <div className="space-y-5">
            <div className="glass-panel rounded-2xl p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Ticket #{ticket.ticketId}</p>
              <h1 className="mt-1 text-xl font-semibold text-white">{ticket.subject}</h1>
              <p className={cn('mt-3 flex items-center gap-2 text-sm font-semibold', status.tone)}>
                <Clock className="h-4 w-4" /> {status.label}
              </p>
              <p className="mt-1 text-xs text-slate-400">{status.hint(ticket)}</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">You wrote · {when(ticket.receivedAt)}</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{ticket.message}</p>
            </div>

            {ticket.replies.map((entry) => (
              <div key={entry.at} className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-4">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-purple-300">
                  <Mail className="h-3.5 w-3.5" /> Reply · {when(entry.at)}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{entry.body}</p>
              </div>
            ))}

            {sent && (
              <p className="flex items-center gap-2 text-xs text-emerald-300">
                <Check className="h-4 w-4" />
                Added to your message.
              </p>
            )}

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Add to this ticket</p>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                disabled={sending}
                placeholder={ticket.status === 'resolved' ? 'Not actually resolved? Say what is still wrong.' : 'Anything to add?'}
                className="scrollbar-subtle w-full resize-none rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:border-purple-500/50 disabled:opacity-50"
              />
              {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => reply()}
                  disabled={sending || message.trim().length < 2}
                  className="sticker sticker-hover rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-purple-600/40"
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default SupportTicketPage;
