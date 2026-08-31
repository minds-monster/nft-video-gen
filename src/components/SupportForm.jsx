import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, LifeBuoy, Loader2, X } from 'lucide-react';
import { useMindChatContext } from '../context/mindChat';
import { submitSupport } from '../services/support';
import { track } from '../services/analytics';
import { cn } from '../lib/cn';

// The same words worker/support.js flags. Adam's #2, the one he called load-bearing: "If a
// visitor writes 'my film is broken on beat 3,' that's a Producer conversation, not a support
// ticket." A connected visitor whose message reads like production gets asked — asked, never
// silently re-routed — whether it belongs with their Producer instead.
const PRODUCTION_WORDS = /\b(film|video|storyboard|beat|cast|render|take|screenplay|shoot)\b/i;

const MESSAGE_MIN = 20;

const ERROR_COPY = {
  invalid_email: 'That email address does not look right.',
  message_too_short: `A little more detail helps — at least ${MESSAGE_MIN} characters.`,
  message_too_long: 'That is longer than a ticket can hold. Could you trim it?',
  rate_limited: 'That is a lot of tickets in a short time. Your open ticket is the place to add to.',
  not_configured: 'Support is not switched on right now. Please try again later.',
};

const field =
  'w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:border-purple-500/50 disabled:opacity-50';

/**
 * The contact form. Kept plain on purpose: email and message required, a subject if they
 * want one, and one line about when to expect a reply. The ticket machinery, the markers and
 * the owner area sit behind it unseen. Deliberately NO "speak to a human" control here — the
 * owner's call, to keep the form simple and not invite abuse; a human still gets notified
 * when a Mind escalates.
 */
const SupportForm = ({ onClose }) => {
  const { session, send: sendToProducer } = useMindChatContext();
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [hp, setHp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  // null | 'asking' | 'support' | 'producer'
  const [routing, setRouting] = useState(null);

  const looksLikeProduction = Boolean(session) && PRODUCTION_WORDS.test(message);

  const submit = async ({ humanRequested = false } = {}) => {
    if (submitting) return;
    if (looksLikeProduction && routing !== 'support' && !humanRequested) {
      setRouting('asking');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const data = await submitSupport({ email, subject, message, humanRequested, hp });
      setResult({ ...data, humanRequested });
    } catch (err) {
      setError(ERROR_COPY[err.code] ?? 'Could not send that. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const sendToProducerInstead = () => {
    sendToProducer(message, { subject: subject.trim(), isReply: false });
    track('support_opened', { routed: 'producer' });
    setRouting('producer');
  };

  if (routing === 'producer') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-6 text-center">
        <Check className="h-6 w-6 text-emerald-400" />
        <p className="text-sm font-semibold text-white">Sent to your Producer</p>
        <p className="text-xs text-slate-400">
          It is in your Producer Inbox now, where {session?.mindName || 'your Mind'} has the context of your film.
        </p>
        <button type="button" onClick={onClose} className="chip mt-2 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white">
          Done
        </button>
      </div>
    );
  }

  if (result) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-6">
        <div className="flex items-center gap-2 text-emerald-300">
          <Check className="h-5 w-5" />
          <p className="text-sm font-semibold text-white">
            {result.merged ? `Added to your open message #${result.ticketId}` : `Message #${result.ticketId} received`}
          </p>
        </div>
        <p className="text-xs leading-relaxed text-slate-300">Thanks — we have it, and we will reply to {email} as soon as we can.</p>
        {result.mailer === 'unconfigured' && (
          <p className="text-xs text-amber-300/90">Keep the link below to see the reply.</p>
        )}
        {result.ticketUrl && (
          <a href={result.ticketUrl} className="text-xs text-purple-300 underline decoration-purple-500/50 underline-offset-4 hover:text-purple-200">
            See your message
          </a>
        )}
        <button type="button" onClick={onClose} className="chip mt-1 self-start px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white">
          Done
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-3"
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Your email"
        disabled={submitting}
        className={field}
      />
      <input
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        maxLength={60}
        placeholder="Subject (optional)"
        disabled={submitting}
        className={field}
      />
      <textarea
        required
        value={message}
        onChange={(e) => {
          setMessage(e.target.value);
          if (routing === 'asking') setRouting(null);
        }}
        minLength={MESSAGE_MIN}
        rows={6}
        placeholder="Your message"
        disabled={submitting}
        className={cn(field, 'scrollbar-subtle resize-none')}
      />
      {/* The honeypot: hidden from people, filled by things that fill every field. */}
      <input
        type="text"
        value={hp}
        onChange={(e) => setHp(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />


      <AnimatePresence>
        {routing === 'asking' && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-4 text-xs text-slate-300"
          >
            <p className="font-semibold text-white">This sounds like a question for your Producer.</p>
            <p className="mt-1 leading-relaxed">
              Film, storyboard and cast questions belong with {session?.mindName || 'your Mind'}, who has the context. Send it there instead?
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={sendToProducerInstead} className="chip px-3 py-1.5 font-semibold text-purple-300 hover:text-purple-200">
                Send to my Producer
              </button>
              <button
                type="button"
                onClick={() => {
                  setRouting('support');
                }}
                className="chip px-3 py-1.5 font-semibold text-slate-300 hover:text-white"
              >
                No, it is a site issue
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={submitting || !email || message.trim().length < MESSAGE_MIN}
        className="sticker sticker-hover flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-purple-600/40 disabled:text-white/50"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LifeBuoy className="h-4 w-4" />}
        {submitting ? 'Sending…' : 'Send'}
      </button>

      <p className="text-[11px] leading-relaxed text-slate-500">
        Answered by our support Mind, by email — usually within a few hours.
      </p>

    </form>
  );
};

/** The form in a modal, opened by `#/support`. */
export const SupportModal = ({ open, onClose }) => (
  <AnimatePresence>
    {open && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 280, damping: 28 }}
          role="dialog"
          aria-modal="true"
          aria-label="Support"
          className="glass-panel relative w-full max-w-lg rounded-2xl border border-white/10 bg-slate-950/95 p-6 shadow-2xl"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-1.5 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 text-purple-400">
            <LifeBuoy className="h-5 w-5" />
            <h2 className="text-lg font-semibold text-white">Contact us</h2>
          </div>
          <p className="mt-2 text-sm text-slate-400">Questions, ideas, or something not quite right — drop us a line.</p>
          <div className="mt-5">
            <SupportForm onClose={onClose} />
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

export default SupportForm;
