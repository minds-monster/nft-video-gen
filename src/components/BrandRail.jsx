import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { SECTORS, hasLiveCollection, searchBrands } from '../data/brands';
import {
  SEARCH_CHAINS,
  chainLabel,
  hasAlchemyKey,
  isContractAddress,
  searchCollections,
} from '../services/alchemy';
import { cn } from '../lib/cn';

const ALL = 'All';

/**
 * Brand navigation: sector filters, a searchable brand rail, and an escape hatch —
 * any collection on any supported chain can be opened by name or contract address,
 * so the curated wall never becomes a ceiling.
 */
const BrandRail = ({ sector, onSectorChange, query, onQueryChange, onOpenContract }) => {
  const [remote, setRemote] = useState({ results: [], loading: false, ran: false });

  const matches = useMemo(() => searchBrands(query), [query]);
  const visible = useMemo(
    () => (sector === ALL ? matches : matches.filter((brand) => brand.sector === sector)),
    [matches, sector],
  );

  const looksLikeAddress = isContractAddress(query);

  // Only reach for Alchemy's contract search when the registry has nothing to show.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3 || matches.length > 0 || looksLikeAddress || !hasAlchemyKey) {
      setRemote({ results: [], loading: false, ran: false });
      return;
    }

    let active = true;
    setRemote({ results: [], loading: true, ran: true });
    const timer = setTimeout(async () => {
      const results = await searchCollections(q);
      if (active) setRemote({ results: results.slice(0, 8), loading: false, ran: true });
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, matches.length, looksLikeAddress]);

  return (
    <>
      {/* Only the filter row sticks — and it must be a direct child of <main> for
          `sticky` to hold across the page. Two sticky rows under a 96px header would
          eat a third of a laptop viewport and crowd whatever section you land on.
          `top-24` must track the header's `h-24`. */}
      <section
        id="brands"
        className="sticky top-24 z-30 border-b border-white/10 bg-slate-950/85 backdrop-blur-xl"
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
            {[ALL, ...SECTORS].map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onSectorChange(option)}
                className={cn(
                  'whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                  option === sector
                    ? 'border-purple-400/40 bg-purple-500/20 text-white'
                    : 'border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/10 hover:text-white',
                )}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search brands or paste a contract…"
              aria-label="Search brands or paste a contract address"
              className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-9 text-sm text-white placeholder-slate-500 outline-none focus:border-purple-400/40"
            />
            {query && (
              <button
                type="button"
                onClick={() => onQueryChange('')}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-6 py-4">
        {/* Brand chips — jump straight to a section. */}
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {visible.map((brand) => (
            <a
              key={brand.slug}
              href={`#brand-${brand.slug}`}
              className="chip group flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: hasLiveCollection(brand) ? brand.accent : 'transparent',
                  border: hasLiveCollection(brand) ? undefined : '1px solid currentColor',
                }}
              />
              {brand.name}
            </a>
          ))}
          {!visible.length && (
            <span className="py-1.5 text-xs text-slate-500">
              No brand in the registry matches “{query}”.
            </span>
          )}
        </div>

        {/* Escape hatch: a pasted contract address. */}
        {looksLikeAddress && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-purple-400/20 bg-purple-500/10 px-4 py-3 text-sm">
            <span className="text-slate-300">Open contract</span>
            <code className="rounded bg-black/30 px-2 py-0.5 text-xs text-purple-200">
              {query.trim().slice(0, 10)}…{query.trim().slice(-6)}
            </code>
            <span className="text-slate-500">on</span>
            {SEARCH_CHAINS.map((chain) => (
              <button
                key={chain}
                type="button"
                onClick={() =>
                  onOpenContract({ chain, address: query.trim(), name: 'Custom collection' })
                }
                className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20"
              >
                {chainLabel(chain)}
              </button>
            ))}
          </div>
        )}

        {/* Anything ever minted: live contract search when the registry misses. */}
        {remote.ran && !looksLikeAddress && (
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-slate-500">
              {remote.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
              Collections on-chain
            </p>
            {!remote.loading && !remote.results.length ? (
              <p className="text-xs text-slate-500">No collections found for “{query}”.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {remote.results.map((contract) => (
                  <button
                    key={`${contract.chain}-${contract.address}`}
                    type="button"
                    onClick={() =>
                      onOpenContract({
                        chain: contract.chain,
                        address: contract.address,
                        name: contract.name,
                      })
                    }
                    className="chip px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
                  >
                    {contract.name}
                    <span className="ml-2 text-slate-500">{chainLabel(contract.chain)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export const SECTOR_ALL = ALL;
export default BrandRail;
