import { useMemo, useState } from 'react';
import { Search, Shuffle } from 'lucide-react';
import NftCard from '../../../NftCard';
import { pickDiverseCast } from '../../../../lib/diversity';
import { candidateKey } from '../../../../lib/assetKey';
import { useAvailableNfts } from '../../../../lib/unavailableMedia';
import { resolveNftName } from '../../../../services/alchemy';
import { artRatio } from '../../../../data/brands';
import { cn } from '../../../../lib/cn';

const SAMPLE = 18;
const MAX_RESULTS = 24;

const RandomAssetView = ({ pool, castKeys, isMock, onPreview }) => {
  const [query, setQuery] = useState('');
  const [sample, setSample] = useState(() => pickDiverseCast(pool, SAMPLE));
  const [sampledFrom, setSampledFrom] = useState(pool);
  if (sampledFrom !== pool) {
    setSampledFrom(pool);
    setSample(pickDiverseCast(pool, SAMPLE));
  }

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sample;
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
  }, [pool, sample, query]);

  const available = useAvailableNfts(results, (candidate) => candidate.nft);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pieces…"
            aria-label="Search available pieces"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={cn(
              'w-full rounded-lg border border-white/10 bg-white/[0.03] py-1.5 pl-7 pr-2 text-xs text-white',
              'placeholder-slate-600 outline-none transition-colors',
              'focus:border-purple-400/50 focus:bg-white/[0.06]',
            )}
          />
        </div>
        {!query && (
          <button
            type="button"
            onClick={() => setSample(pickDiverseCast(pool, SAMPLE))}
            className="chip shrink-0 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-slate-400 transition-colors hover:text-white"
          >
            <Shuffle className="inline h-3 w-3" />
          </button>
        )}
      </div>

      <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto">
        {available.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">
            {query ? `Nothing matches “${query}”.` : 'No assets available.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {available.map((candidate) => {
              const key = candidateKey(candidate);
              const selected = castKeys.has(key);
              return (
                <NftCard
                  key={key}
                  nft={candidate.nft}
                  brand={candidate.collection.brand}
                  ratio={artRatio(candidate.collection)}
                  isMock={isMock}
                  selected={selected}
                  actionLabel="Preview"
                  onOpen={() => onPreview?.(candidate)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default RandomAssetView;
