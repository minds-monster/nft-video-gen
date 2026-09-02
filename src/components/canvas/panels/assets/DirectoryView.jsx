import { useMemo, useState } from 'react';
import { ChevronRight, Folder, FolderOpen, Image } from 'lucide-react';
import { resolveNftName } from '../../../../services/alchemy';
import { cn } from '../../../../lib/cn';

const ROW = 'flex w-full items-center gap-1.5 md:gap-2 rounded-lg px-1.5 md:px-2 py-1 md:py-1.5 text-left transition-colors hover:bg-white/5';
const LABEL = 'truncate text-[11px] md:text-xs text-slate-300';

const AssetRow = ({ candidate, onPreview }) => (
  <button type="button" onClick={() => onPreview?.(candidate)} className={cn(ROW, 'pl-6 md:pl-7')}>
    <Image className="h-3 w-3 md:h-3.5 md:w-3.5 shrink-0 text-slate-500" />
    <span className={LABEL}>{resolveNftName(candidate.nft)}</span>
  </button>
);

const CollectionRow = ({ collection, assets, onPreview, onBrowseCollection }) => {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(ROW, 'pl-3 md:pl-4')}
      >
        <ChevronRight className={cn('h-3 w-3 md:h-3.5 md:w-3.5 shrink-0 text-slate-500 transition-transform', open && 'rotate-90')} />
        <span className={cn(LABEL, 'font-medium text-slate-200')}>{collection.name}</span>
        <span className="ml-auto shrink-0 font-mono text-[9px] md:text-[10px] text-slate-600">{assets.length}</span>
      </button>
      {open && (
        <div className="mt-0.5 flex flex-col">
          {assets.map((candidate, index) => (
            <AssetRow key={index} candidate={candidate} onPreview={onPreview} />
          ))}
          <button
            type="button"
            onClick={() => onBrowseCollection?.(collection)}
            className={cn(ROW, 'pl-6 md:pl-7 text-slate-500 hover:text-purple-300')}
          >
            <span className="text-[11px] md:text-xs">Browse collection →</span>
          </button>
        </div>
      )}
    </div>
  );
};

const BrandRow = ({ brand, collections, onPreview, onBrowseCollection }) => {
  const [open, setOpen] = useState(false);
  const Icon = open ? FolderOpen : Folder;
  return (
    <div className="border-b border-white/5 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={ROW}
      >
        <Icon className="h-3.5 w-3.5 md:h-4 md:w-4 shrink-0 text-purple-400" />
        <span className={cn(LABEL, 'font-semibold text-slate-200')}>{brand?.name ?? 'Unknown brand'}</span>
        <span className="ml-auto shrink-0 font-mono text-[9px] md:text-[10px] text-slate-600">{collections.length}</span>
      </button>
      {open && (
        <div className="mt-0.5 flex flex-col pb-1">
          {collections.map(({ collection, assets }) => (
            <CollectionRow
              key={`${collection.chain}:${collection.address}`}
              collection={collection}
              assets={assets}
              onPreview={onPreview}
              onBrowseCollection={onBrowseCollection}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Hierarchical directory: brand → collection → asset.
 */
const DirectoryView = ({ pool, onPreview, onBrowseCollection }) => {
  const tree = useMemo(() => {
    const byBrand = new Map();
    for (const candidate of pool) {
      const brand = candidate.collection.brand;
      const slug = brand?.slug ?? 'unknown';
      if (!byBrand.has(slug)) {
        byBrand.set(slug, { brand, collections: new Map() });
      }
      const node = byBrand.get(slug);
      const key = `${candidate.collection.chain}:${candidate.collection.address}`.toLowerCase();
      if (!node.collections.has(key)) {
        node.collections.set(key, { collection: candidate.collection, assets: [] });
      }
      node.collections.get(key).assets.push(candidate);
    }
    return [...byBrand.values()].sort((a, b) => (a.brand?.name ?? '').localeCompare(b.brand?.name ?? ''));
  }, [pool]);

  if (tree.length === 0) {
    return <p className="py-6 text-center text-xs text-slate-500">No brands available.</p>;
  }

  return (
    <div className="scrollbar-subtle -mx-3 flex h-full flex-col overflow-y-auto px-3">
      {tree.map(({ brand, collections }) => (
        <BrandRow
          key={brand?.slug ?? 'unknown'}
          brand={brand}
          collections={[...collections.values()].sort((a, b) => a.collection.name.localeCompare(b.collection.name))}
          onPreview={onPreview}
          onBrowseCollection={onBrowseCollection}
        />
      ))}
    </div>
  );
};

export default DirectoryView;
