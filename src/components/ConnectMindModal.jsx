import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Sparkles, X } from 'lucide-react';
import { useMindChatContext } from '../context/mindChat';

const STATUS_COPY = {
  pending: {
    title: 'Waiting for approval',
    body: "Your Mind has been messaged. Reply APPROVE from its own chat, Telegram, or email — this page will pick it up automatically.",
  },
  denied: {
    title: 'Connection denied',
    body: 'Your Mind declined the connection. Try again once you’ve had a chance to approve it on that side.',
  },
  expired: {
    title: 'Request expired',
    body: 'That connection attempt timed out without a response. Try again whenever you’re ready.',
  },
  error: {
    title: 'Something went wrong',
    body: null,
  },
};

const ConnectMindModal = () => {
  const { isModalOpen, closeModal, connect, state, error, session } = useMindChatContext();
  const [mindId, setMindId] = useState('');

  const submit = (event) => {
    event.preventDefault();
    const trimmed = mindId.trim();
    if (!trimmed || state === 'pending') return;
    connect(trimmed);
  };

  const showForm = state === 'idle' || state === 'denied' || state === 'expired' || state === 'error';
  const statusInfo = STATUS_COPY[state];

  return (
    <AnimatePresence>
      {isModalOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 280, damping: 28 }}
            role="dialog"
            aria-modal="true"
            aria-label="Connect Mind"
            className="glass-panel relative w-full max-w-md rounded-2xl border border-white/10 bg-slate-950/95 p-6 shadow-2xl"
          >
            <button
              type="button"
              onClick={closeModal}
              aria-label="Close"
              className="absolute right-4 top-4 rounded-full bg-white/10 p-1.5 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2 text-purple-400">
              <Sparkles className="h-5 w-5" />
              <h2 className="text-lg font-semibold text-white">Connect Mind</h2>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Bring your own Hello Minds Mind in as the Producer — it becomes the one you're
              talking to across the site, from here on.
            </p>

            {session && state !== 'pending' ? (
              <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                Connected · {session.mindId.slice(0, 8)}…
              </div>
            ) : showForm ? (
              <form onSubmit={submit} className="mt-6 space-y-3">
                <label className="block text-xs uppercase tracking-widest text-slate-500">
                  Your Mind ID
                </label>
                <input
                  type="text"
                  value={mindId}
                  onChange={(event) => setMindId(event.target.value)}
                  placeholder="e.g. 240b453e-f36b-1410-8466-00039ce7df11"
                  autoFocus
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:border-purple-500/50"
                />
                {statusInfo?.body && (
                  <p className="text-xs text-amber-300/90">{statusInfo.body}</p>
                )}
                {state === 'error' && error && (
                  <p className="text-xs text-red-300/90">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={!mindId.trim()}
                  className="sticker sticker-hover w-full rounded-xl bg-purple-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-purple-600/40 disabled:text-white/50"
                >
                  Connect
                </button>
              </form>
            ) : (
              <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-6 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
                <p className="text-sm font-medium text-white">{statusInfo?.title}</p>
                <p className="text-xs text-slate-400">{statusInfo?.body}</p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ConnectMindModal;
