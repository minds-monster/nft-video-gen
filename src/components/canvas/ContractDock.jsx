import { useState } from 'react';
import { AlertCircle, Loader2, Plug, RefreshCw } from 'lucide-react';
import { hasAlchemyKey } from '../../services/alchemy';
import { parseContractInput } from '../../lib/contractInput';
import { cn } from '../../lib/cn';

/**
 * Paste a contract address, an `address/tokenId`, or a marketplace link.
 *
 * Its own <form>, and a *sibling* of the prompt form — never a descendant. Nested forms
 * are invalid and the browser silently drops the inner one, which would take Enter-to-add
 * with it.
 *
 * The live preview is parse-only, so it costs nothing; the network probe happens on
 * submit. Debouncing a resolve per keystroke would spend up to five metadata requests
 * per burst for a field where "add this" is a discrete commit.
 */
const ContractDock = ({ onResolve, resolving, error, onReshuffle }) => {
  const [value, setValue] = useState('');

  const parsed = value.trim() ? parseContractInput(value) : null;
  const preview = parsed
    ? parsed.tokenId != null
      ? `Token #${parsed.tokenId}`
      : 'Random piece from the collection'
    : null;

  const submit = async (event) => {
    event.preventDefault();
    if (!value.trim() || resolving) return;
    const ok = await onResolve(value);
    if (ok) setValue('');
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <form onSubmit={submit} className="group relative flex-1">
          <Plug className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />

          <input
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Paste a contract address, 0x…/123, or an NFT link"
            aria-label="Add a piece by contract address or NFT link"
            // iOS will happily autocapitalise and autocorrect a hex address into garbage.
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={!hasAlchemyKey}
            className={cn(
              'w-full rounded-full border border-white/10 bg-white/[0.03] py-2 pl-9 pr-24',
              'font-mono text-xs text-white placeholder-slate-600 outline-none transition-colors',
              'focus:border-purple-400/50 focus:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50',
            )}
          />

          <button
            type="submit"
            disabled={!value.trim() || resolving || !hasAlchemyKey}
            className={cn(
              'absolute right-1 top-1/2 -translate-y-1/2 rounded-full px-3 py-1.5',
              'font-mono text-[10px] font-bold uppercase tracking-widest transition-colors',
              'bg-purple-600 text-white hover:bg-purple-500',
              'disabled:bg-white/5 disabled:text-slate-600',
            )}
          >
            {resolving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
          </button>
        </form>

        <button
          type="button"
          onClick={onReshuffle}
          aria-label="Re-roll the suggested pieces"
          title="Re-roll the suggested pieces"
          className="chip shrink-0 p-2 text-slate-400 transition-colors hover:border-purple-400/50 hover:text-purple-300"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <p aria-live="polite" className="min-h-4 px-3 font-mono text-[10px] tracking-wide">
        {error ? (
          <span className="flex items-center gap-1.5 text-amber-300">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {error}
          </span>
        ) : !hasAlchemyKey ? (
          <span className="text-slate-600">
            Set VITE_ALCHEMY_API_KEY to open contracts by address.
          </span>
        ) : preview ? (
          <span className="text-emerald-300/80">{preview}</span>
        ) : (
          <span className="text-slate-600">
            Add your own character or items to the cast. Individual asset or whole collection.
          </span>
        )}
      </p>
    </div>
  );
};

export default ContractDock;
