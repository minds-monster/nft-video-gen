import { useMemo, useState } from 'react';
import { ArrowDownAZ, ArrowUpAZ } from 'lucide-react';
import { resolveNftThumb } from '../../../../services/alchemy';
import { artRatio } from '../../../../data/brands';
import { cn } from '../../../../lib/cn';

const SORT = {
  AZ: 'az',
  ZA: 'za',
};

const CollectionRow = ({ collection, candidate, onBrowseCollection }) => {
  const thumb = resolveNftThumb(candidate.nft);
  const ratio = artRatio(collection);

  return (
    <button
      type="button"
      onClick={() => onBrowseCollection?.(collection)}
      className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-white/5"
    >
      <div
        className="shrink-0 overflow-hidden rounded-md border border-white/10 bg-slate-900"
        style={{ width: 48, aspectRatio: ratio }}
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[9px] text-slate-600">
            ?
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-200">{collection.name}</p>
        <p className="truncate text-[10px] text-slate-500">{collection.brand?.name}</p>
      </div>
    </button>
  );
};

/**
 * All collections as a small-icon scrollable list. Clicking a collection browses it.
 */
const CollectionListView = ({ pool, onBrowseCollection }) => {
  const [sort, setSort] = useState(SORT.AZ);

  const collections = useMemo(() => {
    const byKey = new Map();
    for (const candidate of pool) {
      const key = `${candidate.collection.chain}:${candidate.collection.address}`.toLowerCase();
      if (!byKey.has(key)) {
        byKey.set(key, { collection: candidate.collection, candidate });
      }
    }
    return [...byKey.values()].sort((a, b) => {
      const nameA = a.collection.name.toLowerCase();
      const nameB = b.collection.name.toLowerCase();
      return sort === SORT.AZ ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
    });
  }, [pool, sort]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => setSort(SORT.AZ)}
          aria-label="Sort A-Z"
          className={cn(
            'rounded p-1 transition-colors',
            sort === SORT.AZ ? 'bg-white/10 text-white' : 'text-slate-600 hover:text-white',
          )}
        >
          <ArrowDownAZ className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setSort(SORT.ZA)}
          aria-label="Sort Z-A"
          className={cn(
            'rounded p-1 transition-colors',
            sort === SORT.ZA ? 'bg-white/10 text-white' : 'text-slate-600 hover:text-white',
          )}
        >
          <ArrowUpAZ className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto -mx-2 px-2">
        {collections.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">No collections available.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {collections.map(({ collection, candidate }) => (
              <CollectionRow
                key={`${collection.chain}:${collection.address}`}
                collection={collection}
                candidate={candidate}
                onBrowseCollection={onBrowseCollection}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CollectionListView;
