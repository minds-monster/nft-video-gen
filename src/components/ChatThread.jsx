import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Film, Loader2, MessageSquare } from 'lucide-react';
import { extractMedia, messageTextWithoutMedia } from '../lib/media';
import { messageToText } from '../lib/text';
import { cn } from '../lib/cn';

// mind.js waits up to 120s for a reply. Silent bouncing dots for two minutes reads
// as broken, so we count the wait out loud.
const ElapsedNotice = () => {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-start">
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
        The mind
      </span>
      <div className="bg-white/5 border border-white/10 text-slate-200 rounded-2xl rounded-tl-sm px-5 py-4 flex items-center gap-3">
        <div className="flex space-x-1">
          <span className="w-2 h-2 rounded-full bg-purple-500 animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 rounded-full bg-purple-500 animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 rounded-full bg-purple-500 animate-bounce [animation-delay:300ms]" />
        </div>
        <span className="text-sm text-slate-400">
          Generating your film… {seconds}s
          {seconds > 45 && <span className="text-slate-500"> · this can take up to two minutes</span>}
        </span>
      </div>
    </motion.div>
  );
};

const MediaBlock = ({ media }) => (
  <div className="mt-4 rounded-xl overflow-hidden bg-black/50 border border-white/10">
    {media.kind === 'video' ? (
      <video src={media.url} controls autoPlay loop muted playsInline className="w-full" />
    ) : (
      <img src={media.url} alt="Generated result" className="w-full" />
    )}
    <a
      href={media.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 px-4 py-2 text-xs text-slate-400 hover:text-white transition-colors"
    >
      <Film className="w-3.5 h-3.5" /> Open original
    </a>
  </div>
);

/**
 * The conversation with the mind. Message state is owned by MindChatProvider —
 * this component only renders it.
 */
const ChatThread = ({ messages, isSending, isInitializing, error, className, emptyHint }) => {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isSending]);

  if (isInitializing) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-3 py-10', className)}>
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
        <p className="text-slate-400 text-sm">Waking the mind…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-3 py-10 text-center px-6',
          className,
        )}
      >
        <AlertCircle className="w-9 h-9 text-amber-400" />
        <p className="text-amber-200 text-sm font-medium">{error}</p>
        <p className="text-slate-500 text-xs max-w-sm">
          Browsing and licensing still work — connect your Mind to generate video.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('scrollbar-subtle overflow-y-auto pr-2 space-y-6', className)}>
      {messages.length === 0 && !isSending ? (
        <div className="h-full min-h-40 flex flex-col items-center justify-center text-slate-500 gap-3 text-center px-6">
          <MessageSquare className="w-10 h-10 opacity-40" />
          <p className="text-sm">{emptyHint ?? 'Describe the film you want and the mind will make it.'}</p>
        </div>
      ) : (
        messages.map((msg, idx) => {
          const isHuman = msg.senderType === 1;
          const media = isHuman ? null : extractMedia(msg);
          const text = messageToText(
            media ? messageTextWithoutMedia(msg, media) : msg.messageText,
          );

          return (
            <motion.div
              key={msg.fingerprint || idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn('flex flex-col', isHuman ? 'items-end' : 'items-start')}
            >
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                {isHuman ? 'You' : 'The mind'}
              </span>
              <div
                className={cn(
                  'max-w-[85%] min-w-0 rounded-2xl px-5 py-3',
                  isHuman
                    ? 'bg-gradient-to-br from-purple-700 to-purple-500 text-white shadow-lg shadow-purple-600/25 rounded-tr-sm'
                    : 'bg-white/5 border border-white/10 text-slate-200 rounded-tl-sm',
                  msg.isError && 'border-red-500/50 bg-red-500/10',
                )}
              >
                {/* break-words: contract addresses in the prompt are long unbroken strings. */}
                {text && (
                  <p className="whitespace-pre-wrap break-words leading-relaxed">{text}</p>
                )}
                {media && <MediaBlock media={media} />}
              </div>
            </motion.div>
          );
        })
      )}

      {isSending && <ElapsedNotice />}
      <div ref={endRef} />
    </div>
  );
};

export default ChatThread;
