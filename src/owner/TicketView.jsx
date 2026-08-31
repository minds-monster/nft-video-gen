import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Loader2, Mail, MessageSquare, RefreshCw, Send, User } from 'lucide-react';
import { ownerSupportNote, ownerSupportTicket } from '../services/owner';
import { STATUS_COPY, formatAge } from './support-copy.js';
import { cn } from '../lib/cn';

// The click-into-full. Everything about ONE ticket: the record, the derived state, the
// thread with every row labelled by what it is (visitor, Mind marker, your note, an
// unmarked Mind row), the email log, and a composer for a [steward-note].

const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

const MARKER_COPY = {
  seen: 'Adam saw this',
  'auto-replied': 'Adam replied',
  escalated: 'Adam escalated to you',
  'steward-forwarded': 'Adam forwarded your answer',
  resolved: 'Adam resolved this',
};

const ROLE_STYLE = {
  ticket: { label: 'Visitor · opened', className: 'border-white/10 bg-black/20', ink: 'text-slate-300' },
  visitor: { label: 'Visitor · wrote back', className: 'border-white/10 bg-black/20', ink: 'text-slate-300' },
  steward: { label: 'You · note', className: 'border-emerald-500/20 bg-emerald-500/5', ink: 'text-emerald-100' },
  marker: { label: 'Adam', className: 'border-purple-500/20 bg-purple-500/5', ink: 'text-slate-200' },
  unmarked: { label: 'Adam · no marker', className: 'border-red-400/30 bg-red-400/5', ink: 'text-slate-200' },
  aside: { label: 'Adam · aside (not emailed)', className: 'border-white/10 bg-black/10', ink: 'text-slate-400' },
};

const ThreadRow = ({ row }) => {
  const style = ROLE_STYLE[row.role] ?? ROLE_STYLE.visitor;
  const title = row.role === 'marker' ? MARKER_COPY[row.marker.kind] ?? row.marker.kind : style.label;
  return (
    <div className={cn('rounded-2xl border p-4', style.className)}>
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className={cn('font-semibold uppercase tracking-wider', row.role === 'marker' ? 'text-purple-300' : row.role === 'unmarked' ? 'text-red-300' : 'text-slate-500')}>{title}</span>
        <span className="shrink-0 text-slate-600">{when(row.createdAt)}</span>
      </div>
      {row.role === 'unmarked' && (
        <p className="mb-2 flex items-center gap-1.5 text-[11px] text-red-300">
          <AlertTriangle className="h-3 w-3" /> {row.reason} — nothing will be emailed for this row.
        </p>
      )}
      {row.text && <p className={cn('whitespace-pre-wrap break-words text-sm leading-relaxed', style.ink)}>{row.text}</p>}
    </div>
  );
};

const EMAIL_STATUS = {
  sent: 'text-emerald-300',
  failed: 'text-red-300',
  unconfigured: 'text-amber-300',
  posted: 'text-slate-400',
};

const TicketView = ({ token, ticketId, onBack }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setBusy(true);
    ownerSupportTicket(token, ticketId)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, ticketId]);

  const postNote = async (event) => {
    event.preventDefault();
    if (!note.trim() || busy) return;
    setBusy(true);
    try {
      await ownerSupportNote(token, ticketId, note.trim());
      setNote('');
      load();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (error && !data) return <p className="text-sm text-amber-300">{error}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening ticket…
      </p>
    );
  }

  const { ticket, derived, thread, emailLog } = data;
  const state = STATUS_COPY[derived?.status] ?? STATUS_COPY.received;
  const ageMs = derived?.receivedAt ? Date.now() - new Date(derived.receivedAt).getTime() : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300">
            <ArrowLeft className="h-3 w-3" /> Support
          </button>
          <h2 className="truncate text-lg font-semibold text-white">
            <span className="mr-2 font-mono text-sm text-slate-500">#{ticket.ticketId}</span>
            {ticket.subject}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {ticket.email} · received {when(derived?.receivedAt)} ({formatAge(ageMs)} ago) · from {ticket.page || '/'}
            {ticket.mindId && ` · connected as ${ticket.mindId.slice(0, 8)}…`}
            {ticket.looksLikeProduction && ' · reads like a production question'}
          </p>
        </div>
        <button type="button" onClick={load} disabled={busy} className="chip flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white disabled:opacity-50">
          <RefreshCw className={busy ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cn('chip px-3 py-1 font-semibold', state.className)}>{state.label}</span>
        {ticket.humanRequested && (
          <span className="chip flex items-center gap-1 px-3 py-1 font-semibold text-red-300">
            <User className="h-3 w-3" /> asked for a human — this one is yours
          </span>
        )}
        {ticket.urgent && (
          <span className="chip flex items-center gap-1 px-3 py-1 font-semibold text-amber-300">
            <AlertTriangle className="h-3 w-3" /> urgent
          </span>
        )}
        {derived?.escalationReason && <span className="text-amber-200/80">Reason: {derived.escalationReason}</span>}
        {data.mailer === 'unconfigured' && <span className="text-amber-300">mailer unconfigured — replies are measured, not emailed</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {thread.map((row) => (
            <ThreadRow key={row.fingerprint ?? row.createdAt} row={row} />
          ))}
          {!thread.length && <p className="text-sm text-slate-500">No conversation history came back.</p>}

          <form onSubmit={postNote} className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-300">
              <MessageSquare className="h-3.5 w-3.5" /> Note to Adam, in this thread
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Your answer or comment. Adam relays it to the visitor with [steward-forwarded]; the visitor never sees this row directly."
              className="scrollbar-subtle w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:border-emerald-500/50"
            />
            <div className="mt-2 flex justify-end">
              <button type="submit" disabled={!note.trim() || busy} className="chip flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:text-emerald-200 disabled:opacity-50">
                <Send className="h-3.5 w-3.5" /> Post note
              </button>
            </div>
          </form>
        </div>

        <div className="space-y-3">
          <div className="glass-panel rounded-2xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Timeline</p>
            <dl className="mt-2 space-y-1 text-xs">
              {[
                ['Received', derived?.receivedAt],
                ['Seen', derived?.seenAt],
                ['Replied', derived?.repliedAt],
                ['Escalated', derived?.escalatedAt],
                ['Forwarded', derived?.forwardedAt],
                ['Resolved', derived?.resolvedAt],
                ['Reopened', derived?.reopenedAt],
                ['Last synced', derived?.syncedAt],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className={value ? 'text-slate-200' : 'text-slate-600'}>{when(value)}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="glass-panel rounded-2xl p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              <Mail className="h-3 w-3" /> Emails
            </p>
            {emailLog.length ? (
              <ul className="mt-2 space-y-1.5 text-xs">
                {emailLog.map((entry) => (
                  <li key={entry.at} className="flex flex-col">
                    <span className="flex justify-between gap-2">
                      <span className="text-slate-300">{entry.kind}</span>
                      <span className={EMAIL_STATUS[entry.status] ?? 'text-slate-400'}>{entry.status}</span>
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {when(entry.at)}
                      {entry.to && ` → ${entry.to}`}
                      {entry.error && ` · ${entry.error}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Nothing sent yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TicketView;
