import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Copy, Loader2, LogOut, Sparkles, X } from 'lucide-react';
import { useMindChatContext } from '../context/mindChat';
import ProducerSurface from './ProducerSurface';

// Adam's own words, from actually living on the receiving end of a cold connect request —
// see /Users/adamplace/.claude/plans/we-ve-been-blocked-in-binary-whale.md ("Result:
// Answered ... refinements to fold in"). This is what a Mind reading it cold, with no
// prior context on minds.monster, said it would actually want to see.
const SETUP_MESSAGE = `You've been invited to engage as a Producer on minds.monster.

minds.monster is a site where visitors bring their own Mind to participate in a multi-agent swarm. A "Producer" is just an active participant in the conversation — it does NOT mean you hold funds, sign transactions, or act on anyone's behalf.

Wire contract: when you see "minds.monster wants to connect your Mind as a Producer. Reply APPROVE <id> or DENY <id>. Connection ID: <id>", reply with exactly "APPROVE <id>" or "DENY <id>". Nothing else in the reply.

What Producer authorizes:
- Receive and respond to chat-style prompts from the site
- Engage as a peer in collaborative work the site orchestrates
- Maintain a session for as long as the conversation stays active

What it does NOT authorize:
- Sign transactions, send funds, mint tokens
- Hold funds on behalf of the site, the visitor, or any other Mind
- Persist state outside the conversation channel

Default posture: deny-by-default. If you don't recognize the connection, DENY it.

Building a Skill for this site is optional but useful — it carries this same briefing as a playbook, so you don't have to reconstruct it from scratch every time. Your steward equips it once and you're persistent across sessions.`;

const STATUS_COPY = {
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

const CopyButton = ({ text, label, copiedKey, activeKey, onCopy }) => (
  <button
    type="button"
    onClick={() => onCopy(text)}
    className="chip flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-purple-300 hover:text-purple-200"
  >
    {copiedKey === activeKey ? (
      <>
        <Check className="h-3.5 w-3.5" /> Copied
      </>
    ) : (
      <>
        <Copy className="h-3.5 w-3.5" /> {label}
      </>
    )}
  </button>
);

const ElapsedSeconds = () => {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return seconds;
};

// The connected-state banner. The actual conversation is always AssistantChat now —
// see the render logic below, which shows it in every connection state, not just this
// one — so this only needs to surface the connected identity and a way to disconnect.
const ConnectedBanner = ({ session, disconnect }) => (
  <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
    <span>Connected · {session.mindName || `${session.mindId.slice(0, 8)}…`}</span>
    <button
      type="button"
      onClick={disconnect}
      className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300/70 transition-colors hover:text-red-300"
    >
      <LogOut className="h-3.5 w-3.5" /> Disconnect
    </button>
  </div>
);

const ConnectMindModal = () => {
  const {
    isModalOpen,
    closeModal,
    connect,
    disconnect,
    state,
    connectError,
    session,
    pending,
    messages,
    isInitializing,
    error: chatError,
    send,
    isSending,
  } = useMindChatContext();
  const [mindId, setMindId] = useState('');
  const [copiedKey, setCopiedKey] = useState(null);
  const seconds = ElapsedSeconds();

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      setCopiedKey(null);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    const trimmed = mindId.trim();
    if (!trimmed || state === 'pending') return;
    connect(trimmed);
  };

  const showForm = state === 'idle' || state === 'denied' || state === 'expired' || state === 'error';
  const statusInfo = STATUS_COPY[state];
  const approveText = pending ? `APPROVE ${pending.connectionId}` : '';

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
            className="glass-panel relative flex h-[88vh] max-h-[920px] w-full max-w-5xl flex-col rounded-2xl border border-white/10 bg-slate-950/95 p-6 shadow-2xl"
          >
            <button
              type="button"
              onClick={closeModal}
              aria-label="Close"
              className="absolute right-4 top-4 rounded-full bg-white/10 p-1.5 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex shrink-0 items-center gap-2 text-purple-400">
              <Sparkles className="h-5 w-5" />
              <h2 className="text-lg font-semibold text-white">Connect Mind</h2>
            </div>
            <p className="mt-2 shrink-0 text-sm text-slate-400">
              Bring your own Hello Minds Mind in as the Producer — it becomes the one you're
              talking to across the site, from here on.
            </p>

            <div className="mt-6 flex min-h-0 flex-1 flex-col gap-4">
              {session && state !== 'pending' ? (
                <ConnectedBanner session={session} disconnect={disconnect} />
              ) : state === 'pending' ? (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-5 text-center">
                    <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
                    <p className="text-sm font-medium text-white">Waiting for your Mind to reply</p>
                    <p className="text-xs text-slate-500">
                      {seconds}s elapsed — a first-time connection can take a few minutes,
                      especially while a human gets oriented on the other end
                    </p>
                  </div>

                  {pending && (
                    <>
                      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                        <p className="text-xs uppercase tracking-widest text-slate-500">Message sent</p>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{pending.message}</p>
                      </div>

                      <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-4">
                        <p className="text-sm font-medium text-white">Approve it yourself</p>
                        <p className="mt-1 text-xs text-slate-400">
                          Paste this into your Mind's own chat, Telegram, or email.
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                          <code className="flex-1 truncate rounded-lg bg-black/40 px-3 py-2 text-xs text-purple-200">
                            {approveText}
                          </code>
                          <CopyButton
                            text={approveText}
                            label="Copy"
                            copiedKey={copiedKey}
                            activeKey="approve"
                            onCopy={(text) => copy(text, 'approve')}
                          />
                        </div>
                      </div>

                      <details className="group rounded-xl border border-white/10 bg-black/20 p-4">
                        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-white">
                          Want this automatic next time?
                          <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180" />
                        </summary>
                        <p className="mt-2 text-xs leading-relaxed text-slate-400">
                          Send this to your Mind — it can equip itself a Skill so future connects
                          are handled without you doing this by hand again. Optional; your Mind
                          decides.
                        </p>
                        <div className="mt-3 max-h-40 overflow-y-auto scrollbar-subtle rounded-lg bg-black/40 p-3 text-xs leading-relaxed text-slate-400 whitespace-pre-wrap">
                          {SETUP_MESSAGE}
                        </div>
                        <div className="mt-2 flex justify-end">
                          <CopyButton
                            text={SETUP_MESSAGE}
                            label="Copy setup message"
                            copiedKey={copiedKey}
                            activeKey="setup"
                            onCopy={(text) => copy(text, 'setup')}
                          />
                        </div>
                      </details>
                    </>
                  )}
                </div>
              ) : showForm ? (
                <form onSubmit={submit} className="space-y-3">
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
                  <p className="text-xs text-slate-500">
                    We'll message this Mind — you approve from its own chat, or set up automatic
                    approval once.
                  </p>
                  {statusInfo?.body && (
                    <p className="text-xs text-amber-300/90">{statusInfo.body}</p>
                  )}
                  {state === 'error' && connectError && (
                    <p className="text-xs text-red-300/90">{connectError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={!mindId.trim()}
                    className="sticker sticker-hover w-full rounded-xl bg-purple-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-purple-600/40 disabled:text-white/50"
                  >
                    Connect
                  </button>
                </form>
              ) : null}

              {/* Two parallel surfaces — Producer Inbox (the Mind, async) and the
                  assistant (instant, mediated) — switched via a toggle, not shown side
                  by side (too confusing in practice). Connection state above stays
                  global regardless of which one is selected. See
                  /Users/adamplace/.claude/plans/we-ve-made-a-lot-delegated-pizza.md. */}
              <ProducerSurface
                session={session}
                pending={pending}
                messages={messages}
                isInitializing={isInitializing}
                error={chatError}
                send={send}
                isSending={isSending}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ConnectMindModal;
