import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * The primary input of the whole site: describe a film, press return.
 * `suggestions` fill the field on click so a first-time visitor never faces a
 * blank box.
 */
const PromptBar = ({
  onSubmit,
  value,
  onValueChange,
  placeholder = 'Describe your film…',
  suggestions = [],
  busy = false,
  disabled = false,
  autoFocus = false,
  size = 'lg',
  className,
}) => {
  const [internal, setInternal] = useState('');
  const inputRef = useRef(null);

  // Controlled when a `value` is passed (the Studio pre-fills from the hero),
  // uncontrolled otherwise.
  const isControlled = value !== undefined;
  const text = isControlled ? value : internal;
  const setText = (next) => (isControlled ? onValueChange?.(next) : setInternal(next));

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const submit = (event) => {
    event?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy || disabled) return;
    onSubmit?.(trimmed);
    setText('');
  };

  return (
    <div className={cn('w-full', className)}>
      <motion.form
        onSubmit={submit}
        className="w-full relative group"
        whileHover={disabled ? undefined : { scale: 1.005 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        <div className="absolute -inset-1 bg-gradient-to-r from-purple-700 to-purple-500 rounded-2xl blur opacity-25 group-hover:opacity-50 group-focus-within:opacity-60 transition duration-700" />
        <div
          className={cn(
            'relative glass-panel rounded-2xl flex items-center',
            size === 'lg' ? 'p-2' : 'p-1.5',
          )}
        >
          <div className={cn('text-purple-400', size === 'lg' ? 'p-3' : 'p-2')}>
            <Sparkles className={size === 'lg' ? 'w-6 h-6' : 'w-5 h-5'} />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className={cn(
              'flex-1 bg-transparent border-none outline-none text-white placeholder-slate-500 min-w-0',
              size === 'lg' ? 'text-lg px-2 py-3' : 'text-base px-2 py-2',
            )}
            disabled={disabled}
          />
          <button
            type="submit"
            disabled={busy || disabled || !text.trim()}
            aria-label="Generate"
            className={cn(
              'bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/40 disabled:text-white/50',
              // The page's primary action, so it carries the logo's own device: a hard
              // keyline plus a solid offset shadow, growing on hover. White on brand
              // purple measures 5.55:1, so the icon stays AA at this size.
              'sticker sticker-hover text-white rounded-xl transition-colors flex items-center justify-center shrink-0',
              size === 'lg' ? 'p-3' : 'p-2.5',
            )}
          >
            {busy ? (
              <Loader2 className={cn('animate-spin', size === 'lg' ? 'w-6 h-6' : 'w-5 h-5')} />
            ) : (
              <Send className={size === 'lg' ? 'w-6 h-6' : 'w-5 h-5'} />
            )}
          </button>
        </div>
      </motion.form>

      {suggestions.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-slate-500 mr-1">Try</span>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => {
                setText(suggestion);
                inputRef.current?.focus();
              }}
              className="chip px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default PromptBar;
