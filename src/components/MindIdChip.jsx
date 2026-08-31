import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../lib/cn';

// A Mind ID is 36 characters of UUID — too long to sit inline next to a name, and too
// important to hide entirely: it is the one string a visitor needs when they want to
// reconnect from another browser, or tell their steward which Mind the site is talking to.
// So: an abbreviation that stays identifiable at both ends, and one click to get the whole
// thing on the clipboard.
export const abbreviateMindId = (mindId) =>
  typeof mindId === 'string' && mindId.length > 14 ? `${mindId.slice(0, 8)}…${mindId.slice(-4)}` : mindId;

const TONES = {
  emerald: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200/90 hover:border-emerald-400/60 hover:text-emerald-100',
  slate: 'border-white/10 bg-black/30 text-slate-400 hover:border-white/25 hover:text-slate-200',
};

const MindIdChip = ({ mindId, tone = 'slate', className }) => {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  if (!mindId) return null;

  const copy = async (event) => {
    // These chips live inside clickable rows and banners; copying an ID should never also
    // open a thread or dismiss the modal behind it.
    event.stopPropagation();
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(mindId);
      setCopied(true);
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={`${mindId} — click to copy`}
      aria-label={copied ? 'Mind ID copied' : `Copy Mind ID ${mindId}`}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-0.5 font-mono text-[11px] transition-colors',
        TONES[tone] ?? TONES.slate,
        className,
      )}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" aria-hidden /> Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3 opacity-70" aria-hidden /> {abbreviateMindId(mindId)}
        </>
      )}
    </button>
  );
};

export default MindIdChip;
