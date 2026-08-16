import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Check, Clock, Loader2, Search, X } from 'lucide-react';
import NftCard from '../NftCard';
import { artRatio } from '../../data/brands';
import { useAvailableNfts } from '../../lib/unavailableMedia';
import { pickDiverseCast } from '../../lib/diversity';
import { candidateKey } from '../../lib/assetKey';
import { parseContractInput } from '../../lib/contractInput';
import { recentCollections } from '../../lib/recentCollections';
import { chainLabel, hasAlchemyKey, resolveNftName } from '../../services/alchemy';
import { cn } from '../../lib/cn';

// Module scope keeps the reference stable across renders.
const selectCandidateNft = (candidate) => candidate.nft;

// Enough to browse without mounting dozens of hover-video elements at once.
const SAMPLE = 18;
const MAX_RESULTS = 24;
const RECENTS = 6;

const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * The "what else is available" sheet, in add or swap mode.
 *
 * Two sources feed the grid. By default it's the curated pool, shown as a *diverse*
 * sample rather than the head of the pool — otherwise the grid is the first six
 * collections in registry order, which is all fashion. Paste a contract into the search
 * box and it switches to that collection instead: one piece for a token id, a page of
 * them for a bare contract.
 *
 * The pasted view is owned by useCanvasComposer, not by this component, so it outlives
 * the picker closing — choose a piece, reopen, and the same collection is still here.
 */
const AssetPicker = ({
  pool,
  castKeys,
  mode,
  onChoose,
  onClose,
  isMock,
  pastedView,
  onLoadContract,
  onShufflePasted,
  onClearPasted,
  resolving,
  error,
}) => {
  const [query, setQuery] = useState('');

  // The unsearched sample is drawn once and only redrawn on demand, so the grid doesn't
  // reshuffle itself under the user's cursor on every render. Resampling when the pool
  // identity changes happens during render rather than in an effect — an effect with a
  // random pick inside would draw twice under StrictMode.
  const [sample, setSample] = useState(() => pickDiverseCast(pool, SAMPLE));
  const [sampledFrom, setSampledFrom] = useState(pool);
  if (sampledFrom !== pool) {
    setSampledFrom(pool);
    setSample(pickDiverseCast(pool, SAMPLE));
  }

  // Parse-only, so it costs nothing per keystroke; the network probe waits for submit.
  const parsed = query.trim() ? parseContractInput(query) : null;
  const contractMode = Boolean(parsed) && hasAlchemyKey;

  // Read straight through on the renders that actually show the row — a JSON.parse of at
  // most 24 entries, and no memo to go stale when a load appends to it. Deliberately not
  // read while typing or while a pasted collection is on screen, where it isn't rendered.
  const showRecents = !pastedView && !query.trim();
  const recents = showRecents ? recentCollections(RECENTS) : [];

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    return pool
      .filter((candidate) => {
        const brand = candidate.collection.brand;
        return (
          brand?.name.toLowerCase().includes(q) ||
          brand?.sector.toLowerCase().includes(q) ||
          candidate.collection.name.toLowerCase().includes(q) ||
          resolveNftName(candidate.nft).toLowerCase().includes(q)
        );
      })
      .slice(0, MAX_RESULTS);
  }, [pool, query]);

  // Typing takes precedence over the pasted view, so text search still reaches the
  // curated pool while a collection is loaded.
  const showingPasted = Boolean(pastedView) && !query.trim();
  const allResults = showingPasted ? pastedView.candidates : query.trim() ? searchResults : sample;
  // A piece whose artwork is gone must not be choosable for the cast either.
  const results = useAvailableNfts(allResults, selectCandidateNft);
  const origin = showingPasted ? 'pasted' : 'curated';
  const mock = showingPasted ? pastedView.isMock : isMock;

  const submit = async (event) => {
    event.preventDefault();
    if (!contractMode || resolving) return;
    const ok = await onLoadContract(query);
    if (ok) setQuery('');
  };

  const loadRecent = (entry) => onLoadContract(entry.address);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      // No rounding of its own: the panel it fills already clips to the right radius,
      // and rounding here would cut the corners twice.
      className="absolute inset-0 z-30 flex flex-col bg-slate-950/97"
    >
      <div className="flex items-center gap-3 border-b border-white/10 p-4">
        <form onSubmit={submit} className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search brands, collections, pieces — or paste a contract"
            aria-label="Search available pieces, or paste a contract address"
            // iOS will happily autocapitalise and autocorrect a hex address into garbage.
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={cn(
              'w-full rounded-full border border-white/10 bg-white/[0.03] py-2 pl-9 text-sm text-white',
              'placeholder-slate-600 outline-none transition-colors',
              'focus:border-purple-400/50 focus:bg-white/[0.06]',
              contractMode ? 'pr-28 font-mono text-xs' : 'pr-3',
            )}
          />

          {contractMode && (
            <button
              type="submit"
              disabled={resolving}
              className={cn(
                'absolute right-1 top-1/2 -translate-y-1/2 rounded-full px-3 py-1.5',
                'font-mono text-[10px] font-bold uppercase tracking-widest transition-colors',
                'bg-purple-600 text-white hover:bg-purple-500',
                'disabled:bg-white/5 disabled:text-slate-600',
              )}
            >
              {resolving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : parsed.tokenId != null ? (
                `Load #${parsed.tokenId}`
              ) : (
                'Load'
              )}
            </button>
          )}
        </form>

        {!query && (showingPasted ? pastedView.tokenId == null : true) && (
          <button
            type="button"
            onClick={
              showingPasted ? onShufflePasted : () => setSample(pickDiverseCast(pool, SAMPLE))
            }
            disabled={resolving}
            className="chip shrink-0 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-400 transition-colors hover:text-white disabled:opacity-50"
          >
            Shuffle
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Close the piece picker"
          className="shrink-0 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ------------------------------------------------------------ status line */}
      <div className="px-4 pt-3 font-mono text-[10px] uppercase tracking-widest">
        {error ? (
          <p className="flex items-center gap-1.5 text-amber-300">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span className="normal-case tracking-wide">{error}</span>
          </p>
        ) : showingPasted ? (
          <p className="flex flex-wrap items-center gap-2 text-slate-500">
            <span className="text-purple-300">{pastedView.collection.name}</span>
            <span className="text-slate-600">
              {chainLabel(pastedView.chain)}
              {pastedView.tokenId == null && ` · ${results.length} of ${pastedView.total}`}
            </span>
            <button
              type="button"
              onClick={onClearPasted}
              className="rounded-full border border-white/10 px-2 py-0.5 uppercase tracking-widest text-slate-400 transition-colors hover:text-white"
            >
              Back to brands
            </button>
          </p>
        ) : contractMode ? (
          <p className="text-emerald-300/80">
            {parsed.tokenId != null
              ? `Press enter to load token #${parsed.tokenId}`
              : 'Press enter to browse this collection'}
          </p>
        ) : parsed ? (
          // A contract, but there's no key to resolve it with. Same copy as the dock.
          <p className="normal-case tracking-wide text-slate-600">
            Set VITE_ALCHEMY_API_KEY to open contracts by address.
          </p>
        ) : (
          <p className="text-slate-500">
            {mode === 'swap' ? 'Choose a replacement' : 'Choose a piece to add'}
            <span className="ml-2 text-slate-600">· Esc to cancel</span>
          </p>
        )}
      </div>

      {/* ---------------------------------------------------------------- recents */}
      {recents.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
          <Clock className="h-3 w-3 shrink-0 text-slate-600" />
          {recents.map((entry) => (
            <button
              key={`${entry.chain}:${entry.address}`}
              type="button"
              onClick={() => loadRecent(entry)}
              disabled={resolving}
              title={`${entry.address} · ${chainLabel(entry.chain)}`}
              className="chip px-2.5 py-1 font-mono text-[10px] text-slate-400 transition-colors hover:border-purple-400/50 hover:text-purple-200 disabled:opacity-50"
            >
              {entry.name ?? shortAddress(entry.address)}
            </button>
          ))}
        </div>
      )}

      <div className="scrollbar-subtle overscroll-contain-y min-h-0 flex-1 overflow-y-auto p-4">
        {resolving && results.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reaching that contract…
          </p>
        ) : results.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-500">
            {parsed ? 'Nothing loaded yet.' : `Nothing matches “${query}”.`}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {results.map((candidate) => {
              const key = candidateKey(candidate);
              return (
                <NftCard
                  key={key}
                  nft={candidate.nft}
                  brand={candidate.collection.brand}
                  ratio={artRatio(candidate.collection)}
                  isMock={mock}
                  selected={castKeys.has(key)}
                  actionLabel={mode === 'swap' ? 'Swap in' : 'Add'}
                  actionIcon={Check}
                  onOpen={() => onChoose(candidate, origin, mock)}
                />
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default AssetPicker;
